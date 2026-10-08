import { apiRequest } from "@/lib/api/client";
import { resetAppDbForTests } from "@/lib/app-db/connection";
import { getFinancialPosting } from "@/lib/app-db/financialPostingRepository";
import { HARNESS_MODES } from "../testing/transportHarness";
import { ACCOUNTS, byKind, createScenario } from "../testing/postingScenario";
import { executeApprovedPosting } from "./applyService";
import { PostingNotApproved } from "./postingErrors";
import { approveAndBeginApply, beginCompleteLink, PreflightRefused, proposeReversal, recordApplyOutcome } from "./postingWorkflowService";
import { postingView } from "./proposalService";

jest.mock("@/lib/api/client", () => ({ apiRequest: jest.fn() }));
const mockApiRequest = apiRequest as unknown as jest.Mock;
afterEach(() => resetAppDbForTests());

describe.each(HARNESS_MODES)("apply service (%s)", (mode) => {
  const scenario = (pattern: "separate-interest" | "embedded-interest", lenderFeed = false) => createScenario({ mode, apiRequestMock: mockApiRequest, pattern, lenderFeed });

  it("T125: the create path writes one marked row; a rerun creates nothing new", async () => {
    const s = scenario("separate-interest");
    const [charge] = byKind((await s.preview({ from: "2024-02-01", to: "2024-02-29" })).postings, "interest-charge");
    const { posting } = await s.apply(charge);
    expect(posting).toMatchObject({ status: "applied", decidedAt: "2024-06-02T00:00:00.000Z" });
    const marked = s.fake.rows().filter((r) => r.imported_id === charge.idempotencyMarker);
    expect(marked).toEqual([expect.objectContaining({ account: ACCOUNTS.mortgage, amount: -387857, category: null })]);
    // A rerun of the same period: nothing is proposed again, and executing a forged second ticket finds the marker.
    expect(byKind((await s.preview({ from: "2024-02-01", to: "2024-02-29" })).postings, "interest-charge")).toHaveLength(0);
    const replay = await executeApprovedPosting({ posting: { ...posting, status: "applying", decidedAt: posting.decidedAt }, mode: "apply" }, { transport: s.transport, transferPayeeByAccount: s.transferPayees, offBudgetAccountIds: s.offBudgetIds, liabilityAccountId: ACCOUNTS.mortgage });
    expect(replay).toMatchObject({ status: "applied", recovered: true });
    expect(s.fake.rows().filter((r) => r.imported_id === charge.idempotencyMarker)).toHaveLength(1);
  });

  it("SC-018: the executor throws PostingNotApproved for any posting without the user's recorded decision", async () => {
    const s = scenario("separate-interest");
    const [charge] = byKind((await s.preview({ from: "2024-02-01", to: "2024-02-29" })).postings, "interest-charge");
    const ctx = { transport: s.transport, transferPayeeByAccount: s.transferPayees, offBudgetAccountIds: s.offBudgetIds, liabilityAccountId: ACCOUNTS.mortgage };
    await expect(executeApprovedPosting({ posting: charge, mode: "apply" }, ctx)).rejects.toBeInstanceOf(PostingNotApproved);
    await expect(executeApprovedPosting({ posting: { ...charge, status: "applying", decidedAt: null }, mode: "apply" }, ctx)).rejects.toBeInstanceOf(PostingNotApproved);
    await expect(executeApprovedPosting({ posting: { ...charge, status: "approved", decidedAt: null }, mode: "apply" }, ctx)).rejects.toBeInstanceOf(PostingNotApproved);
    expect(s.fake.writes()).toEqual([]);
    // The database itself refuses a forced applying row without a decision.
    expect(() => s.db.prepare("UPDATE financial_postings SET status = 'applying' WHERE id = ?").run(charge.id)).toThrow(/CHECK constraint/);
  });

  it("T126: the restructure path splits exactly, with one liability-side row, and never touches a reconciled row", async () => {
    const s = scenario("embedded-interest");
    const payment = s.seedPayment("2024-02-01");
    const [split] = byKind((await s.preview({ from: "2024-02-01", to: "2024-02-29" })).postings, "repayment-split");
    const { posting, outcome } = await s.apply(split);
    expect(outcome.status).toBe("applied");
    expect(posting.status).toBe("applied");
    const parent = s.fake.accountRows(ACCOUNTS.checking).find((r) => r.id === payment)!;
    const children = parent.subtransactions as Array<Record<string, unknown>>;
    expect(children.reduce((sum, c) => sum + (c.amount as number), 0)).toBe(-242915);
    expect(s.fake.accountRows(ACCOUNTS.mortgage).filter((r) => r.transfer_id === children[0].id)).toHaveLength(1);
  });

  it("server preflight refuses and supersedes when Actual changed after preview; nothing is written", async () => {
    const s = scenario("embedded-interest");
    const payment = s.seedPayment("2024-02-01");
    const [split] = byKind((await s.preview({ from: "2024-02-01", to: "2024-02-29" })).postings, "repayment-split");
    s.fake.editInActual(payment, { notes: "changed by the user" });
    const writes = s.fake.writes().length;
    await expect(s.apply(split)).rejects.toBeInstanceOf(PreflightRefused);
    expect(getFinancialPosting(s.db, split.id)?.status).toBe("superseded");
    expect(s.fake.writes().length).toBe(writes);
  });

  it.each(["exact", "wrong-date", "wrong-account", "duplicate"])("keeps split verification intact with %s settled read-back", async (receipt) => {
    const s = createScenario({ mode, apiRequestMock: mockApiRequest, pattern: "embedded-interest", repaymentAnyPayee: true });
    const payment = s.seedPayment("2024-02-01");
    s.fake.editInActual(payment, { payee: s.fake.transferPayeeId(ACCOUNTS.mortgage) });
    const [split] = byKind((await s.preview({ from: "2024-02-01", to: "2024-02-29" })).postings, "repayment-split");
    const restructure = s.transport.restructureTransactionAsSplit!.bind(s.transport);
    const list = s.transport.listTransactionsForSync.bind(s.transport);
    s.transport.restructureTransactionAsSplit = async (input) => {
      const result = await restructure(input);
      const rows = await list({ accountId: ACCOUNTS.mortgage, startDate: "2024-02-01", endDate: "2024-02-01", resolveNames: false });
      result.settledVerification = {
        accountId: receipt === "wrong-account" ? ACCOUNTS.checking : ACCOUNTS.mortgage, date: receipt === "wrong-date" ? "2024-02-02" : "2024-02-01",
        rows: receipt === "duplicate" ? [...rows, { ...rows[0], id: "duplicate" }] : rows,
      };
      return result;
    };
    const reads = jest.spyOn(s.transport, "listTransactionsForSync");
    const { outcome } = await s.apply(split);
    const verificationReads = reads.mock.calls.filter(([input]) => input.accountId === ACCOUNTS.mortgage && input.endDate === "2024-02-01");
    expect(verificationReads).toHaveLength(receipt === "wrong-date" || receipt === "wrong-account" ? 1 : 0);
    if (receipt === "duplicate") {
      expect(outcome).toMatchObject({ status: "failed", error: { stage: "verify", written: true, issues: [expect.objectContaining({ kind: "liability-rows" })] } });
    } else {
      expect(outcome.status).toBe("applied");
    }
  });

  it("T127: the link path keeps the lender row's imported id and leaves exactly one liability-side row", async () => {
    const s = scenario("embedded-interest", true);
    s.seedPayment("2024-02-01");
    const [split] = byKind((await s.preview({ from: "2024-02-01", to: "2024-02-29" })).postings, "repayment-split");
    if (split.output.kind !== "restructure") throw new Error("restructure");
    const lender = s.seedLenderRow("2024-02-01", -split.output.expectedPostState.children[0].amountMinor);
    await s.apply(split);
    const [link] = byKind((await s.preview({ from: "2024-02-01", to: "2024-02-29" })).postings, "repayment-link");
    const before = s.fake.accountRows(ACCOUNTS.mortgage).length;
    const { posting } = await s.apply(link);
    expect(posting.status).toBe("applied");
    expect(s.fake.accountRows(ACCOUNTS.mortgage).length).toBe(before);
    expect(s.fake.row(lender)).toMatchObject({ imported_id: expect.stringMatching(/^lender:/), transfer_id: expect.any(String) });
  });

  it("T129: a crash after the create write is indeterminate; recovery finds the marker and adopts it (zero duplicates)", async () => {
    const s = scenario("separate-interest");
    const [charge] = byKind((await s.preview({ from: "2024-02-01", to: "2024-02-29" })).postings, "interest-charge");
    s.fake.crashOn({ op: "insert", phase: "after-write" });
    const { posting } = await s.apply(charge);
    expect(posting.status).toBe("indeterminate");
    const recovered = await s.recover(posting);
    expect(recovered).toMatchObject({ status: "applied" });
    expect(s.fake.rows().filter((r) => r.imported_id === charge.idempotencyMarker)).toHaveLength(1);
  });

  it("T129: a crash before the write is not found by recovery: back to proposed, Review, needing a fresh decision", async () => {
    const s = scenario("separate-interest");
    const [charge] = byKind((await s.preview({ from: "2024-02-01", to: "2024-02-29" })).postings, "interest-charge");
    s.fake.crashOn({ op: "insert", phase: "before-write" });
    const { posting } = await s.apply(charge);
    expect(posting.status).toBe("indeterminate");
    expect(await s.recover(posting)).toMatchObject({ status: "proposed", classification: "review", decidedAt: null });
    expect(s.fake.rows().filter((r) => r.imported_id === charge.idempotencyMarker)).toHaveLength(0);
  });

  it("T130: an interrupted split is adopted only on an exact match; an altered child goes to Review; never a second split", async () => {
    const s = scenario("embedded-interest");
    s.seedPayment("2024-02-01");
    const [split] = byKind((await s.preview({ from: "2024-02-01", to: "2024-02-29" })).postings, "repayment-split");
    s.fake.crashOn({ op: "update", phase: "after-write" });
    const { posting } = await s.apply(split);
    expect(posting.status).toBe("indeterminate");
    expect(await s.recover(posting)).toMatchObject({ status: "applied" });

    const t = scenario("embedded-interest");
    const payment = t.seedPayment("2024-02-01");
    const [tsplit] = byKind((await t.preview({ from: "2024-02-01", to: "2024-02-29" })).postings, "repayment-split");
    t.fake.crashOn({ op: "update", phase: "after-write" });
    const interrupted = (await t.apply(tsplit)).posting;
    const interest = (t.fake.accountRows(ACCOUNTS.checking).find((r) => r.id === payment)!.subtransactions as Array<Record<string, unknown>>)[1];
    t.fake.editInActual(interest.id as string, { amount: interest.amount, category: "cat-other", payee: interest.payee, notes: interest.notes });
    const updatesBefore = t.fake.writes().filter((w) => w.op === "update").length;
    expect(await t.recover(interrupted)).toMatchObject({ status: "indeterminate", error: { stage: "recovery-review" } });
    expect(t.fake.writes().filter((w) => w.op === "update").length).toBe(updatesBefore);
  });

  it("T131: a crash between the two link calls is detected read-only; only the explicit completion finishes it", async () => {
    const s = scenario("embedded-interest", true);
    s.seedPayment("2024-02-01");
    const [split] = byKind((await s.preview({ from: "2024-02-01", to: "2024-02-29" })).postings, "repayment-split");
    if (split.output.kind !== "restructure") throw new Error("restructure");
    s.seedLenderRow("2024-02-01", -split.output.expectedPostState.children[0].amountMinor);
    await s.apply(split);
    const [link] = byKind((await s.preview({ from: "2024-02-01", to: "2024-02-29" })).postings, "repayment-link");
    s.fake.crashOn({ op: "update", phase: "after-write" });
    const { posting } = await s.apply(link);
    expect(posting.status).toBe("indeterminate");
    const writes = s.fake.writes().length;
    expect(await s.recover(posting)).toMatchObject({ status: "needs-completion" });
    expect(s.fake.writes().length).toBe(writes);
    const ticket = beginCompleteLink(s.db, posting.id);
    const outcome = await executeApprovedPosting(ticket, { transport: s.transport, transferPayeeByAccount: s.transferPayees, offBudgetAccountIds: s.offBudgetIds, liabilityAccountId: ACCOUNTS.mortgage });
    expect(outcome.status).toBe("applied");
    expect(recordApplyOutcome(s.db, posting.id, outcome).status).toBe("applied");
  });

  it("T132: Undo only creates a reversal proposal; once the user applies it, a correction gets g2 and recovery ignores g1", async () => {
    const s = scenario("separate-interest");
    const [charge] = byKind((await s.preview({ from: "2024-02-01", to: "2024-02-29" })).postings, "interest-charge");
    await s.apply(charge);
    const writes = s.fake.writes().length;
    const reversal = proposeReversal(s.db, charge.id, { accountDirectory: s.directory, transferPayees: s.transferPayees, today: "2024-06-03" });
    expect(reversal).toMatchObject({ status: "proposed", classification: "review", reversalOf: charge.id });
    expect(s.fake.writes().length).toBe(writes);
    expect(getFinancialPosting(s.db, charge.id)?.status).toBe("applied");
    await s.apply(reversal);
    expect(getFinancialPosting(s.db, charge.id)?.status).toBe("reversed");
    const [corrected] = byKind((await s.preview({ from: "2024-02-01", to: "2024-02-29" })).postings, "interest-charge");
    expect(corrected.idempotencyMarker).toMatch(/:g2$/);
    const { posting } = await s.apply(corrected);
    expect(posting.status).toBe("applied");
    expect(s.fake.rows().filter((r) => r.imported_id === corrected.idempotencyMarker)).toHaveLength(1);
    expect(s.fake.rows().filter((r) => r.imported_id === charge.idempotencyMarker)).toHaveLength(1);
  });

  it("approval refuses a Blocked proposal and a posting that is not proposed", async () => {
    const s = scenario("embedded-interest");
    s.seedPayment("2024-02-01", -242915, { reconciled: true });
    const [split] = byKind((await s.preview({ from: "2024-02-01", to: "2024-02-29" })).postings, "repayment-split");
    expect(() => approveAndBeginApply(s.db, split.id, { fresh: [], decidedAt: "2024-06-02T00:00:00.000Z" })).toThrow(/blocked/);
    expect(postingView(getFinancialPosting(s.db, split.id)!).status).toBe("proposed");
  });
});
