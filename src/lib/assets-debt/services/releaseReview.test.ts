import { apiRequest } from "@/lib/api/client";
import { resetAppDbForTests } from "@/lib/app-db/connection";
import { acquirePostingLease, hasPostingLease, recoverAbandonedPostings, renewPostingLease } from "@/lib/app-db/debtPostingLeaseRepository";
import { getFinancialPosting } from "@/lib/app-db/financialPostingRepository";
import { HARNESS_MODES } from "../testing/transportHarness";
import { ACCOUNTS, byKind, createScenario } from "../testing/postingScenario";
import { approveAndBeginApply, proposeReversal, recordApplyOutcome } from "./postingWorkflowService";
import { archiveDebtConfiguration, getDebtDetail } from "./debtConfigService";
import { recordExtraPayment } from "./extraPaymentService";
import { previewDebtPostings } from "./proposalService";
import { recoverCreate } from "./recovery";
import { summarizeStoredLoan } from "./loanSummaryService";

jest.mock("@/lib/api/client", () => ({ apiRequest: jest.fn() }));
const mockApiRequest = apiRequest as unknown as jest.Mock;
afterEach(() => resetAppDbForTests());
const window = { from: "2024-02-01", to: "2024-02-29", today: "2024-02-29" };

describe.each(HARNESS_MODES)("release recovery and structural reads (%s)", (mode) => {
  const scenario = () => createScenario({ mode, apiRequestMock: mockApiRequest, pattern: "separate-interest" });
  it.each([{ offsetHistories: undefined }, { offsetHistories: [] }])("refreshes a loan without offsets when optional histories are $offsetHistories", async ({ offsetHistories }) => {
    const s = scenario();
    expect(getDebtDetail(s.db, s.debtId)!.offsets).toEqual([]);
    const request = { comparison: { comparisonDate: window.today, actualBalanceMinor: 100_000_000 }, offsetHistories, loanAccountRows: undefined };
    const first = await s.preview(window, request);
    expect(first.reconciliation).toMatchObject({ ok: true, comparison: { modelMinor: expect.any(Number) } });
    // A repeated refresh exercises planning and final reconciliation without optional observation data.
    const again = await s.preview(window, request);
    expect(again.reconciliation).toEqual(first.reconciliation);
    expect(s.fake.writes()).toEqual([]);
  });

  it("expires an abandoned applying ticket without starting another Actual write", async () => {
    const s = scenario();
    const [charge] = byKind((await s.preview(window)).postings, "interest-charge");
    const ticket = approveAndBeginApply(s.db, charge.id, { fresh: [], decidedAt: "2024-06-01T00:00:00.000Z" });
    expect(() => acquirePostingLease(s.db, charge.id, "2024-06-01T00:01:00.000Z")).toThrow(/already running/);
    renewPostingLease(s.db, charge.id, ticket.executionToken!, "2024-06-01T00:04:00.000Z");
    recoverAbandonedPostings(s.db, s.debtId, "2024-06-01T00:06:00.000Z");
    expect(getFinancialPosting(s.db, charge.id)?.status).toBe("applying");
    expect(hasPostingLease(s.db, charge.id, "2024-06-01T00:06:00.000Z")).toBe(true);
    recoverAbandonedPostings(s.db, s.debtId, "2024-06-01T00:10:00.000Z");
    expect(getFinancialPosting(s.db, charge.id)).toMatchObject({ status: "indeterminate", error: { stage: "execution-interrupted" } });
    expect(s.fake.writes()).toEqual([]);
    expect(() => recordApplyOutcome(s.db, charge.id, { status: "applied", actualIds: ["old-owner"], appliedAt: "2024-06-01T00:10:01.000Z" }, "2024-06-01T00:10:01.000Z", ticket.executionToken)).toThrow(/no longer owns/);
  });

  it.each([
    { field: "amount", value: -1 }, { field: "date", value: "2023-01-01" },
    { field: "account", value: ACCOUNTS.checking }, { field: "payee", value: "another-payee" },
    { field: "notes", value: "Changed in Actual" }, { field: "cleared", value: true },
  ])("keeps a changed marked create in review when $field differs", async ({ field, value }) => {
    const s = scenario();
    const [charge] = byKind((await s.preview(window)).postings, "interest-charge");
    s.fake.crashOn({ op: "insert", phase: "after-write" });
    const interrupted = (await s.apply(charge)).posting;
    const row = s.fake.rows().find((row) => row.imported_id === charge.idempotencyMarker)!;
    s.fake.editInActual(row.id, { [field]: value });
    const writes = s.fake.writes().length;
    expect(await s.recover(interrupted)).toMatchObject({ status: "indeterminate", error: { stage: "recovery-review", code: "created-row-changed" } });
    expect(s.fake.writes()).toHaveLength(writes);
  });

  it("reports a partial create as review rather than an absent write", async () => {
    const s = scenario();
    const [charge] = byKind((await s.preview(window)).postings, "interest-charge");
    s.fake.crashOn({ op: "insert", phase: "after-write" });
    await s.apply(charge);
    if (charge.output.kind !== "create") throw new Error("Expected create");
    const partial = { ...charge.output, operations: [...charge.output.operations, { ...charge.output.operations[0], importedId: "missing-second-operation" }] };
    expect(await recoverCreate(partial, s.transport)).toMatchObject({ status: "review", reason: { code: "partial-create" } });
  });

  it("finds a moved repayment by identity outside the original narrow date range", async () => {
    const s = scenario();
    const id = s.seedPayment("2024-02-01");
    s.fake.editInActual(id, { date: "2024-06-01" });
    expect(await s.transport.queryTransactionsForSync!({ ids: [id], resolveNames: false })).toEqual([expect.objectContaining({ id, date: "2024-06-01", accountId: ACCOUNTS.checking })]);
    expect(await s.transport.queryTransactionsForSync!({ ranges: [{ accountId: ACCOUNTS.checking, from: "2024-02-01", to: "2024-02-03" }], resolveNames: false })).toEqual([]);
  });
});

describe("release bookkeeping guards", () => {
  it.each([-2_000_000, 0])("removes a confirmed extra assumption when its direction no longer reduces debt (%s)", async (amount) => {
    const s = createScenario({ mode: "http", apiRequestMock: mockApiRequest, pattern: "embedded-interest" });
    const id = s.fake.seed({ account: ACCOUNTS.mortgage, date: "2024-02-10", amount: 2_000_000 });
    recordExtraPayment(s.db, s.debtId, { actualTransactionId: id, date: "2024-02-10", amountMinor: 2_000_000 });
    s.fake.editInActual(id, { amount });
    expect((await s.preview(window)).followedExtraPayments).toContainEqual(expect.objectContaining({ transactionId: id, change: "direction" }));
    expect(getDebtDetail(s.db, s.debtId)!.assumptions).toEqual([]);
  });

  it("rejects a different budget before following extras or changing revisions", async () => {
    const s = createScenario({ mode: "http", apiRequestMock: mockApiRequest, pattern: "embedded-interest" });
    const id = s.fake.seed({ account: ACCOUNTS.mortgage, date: "2024-02-10", amount: 2_000_000 });
    recordExtraPayment(s.db, s.debtId, { actualTransactionId: id, date: "2024-02-10", amountMinor: 2_000_000 });
    const before = getDebtDetail(s.db, s.debtId);
    expect(() => previewDebtPostings(s.db, s.debtId, { ...window, snapshots: [], accountDirectory: { ...s.directory, budgetSyncId: "another-budget" }, transferPayees: s.transferPayees, capabilities: { canRestructure: true, canVerifyTransferLinks: true }, loanAccountRows: [] })).toThrow(/budget/);
    expect(getDebtDetail(s.db, s.debtId)).toEqual(before);
  });

  it("refuses Apply and Undo for archived loans while retaining their historical audit", async () => {
    const s = createScenario({ mode: "http", apiRequestMock: mockApiRequest, pattern: "separate-interest" });
    const [charge] = byKind((await s.preview(window)).postings, "interest-charge");
    await s.apply(charge);
    archiveDebtConfiguration(s.db, s.debtId);
    expect(() => proposeReversal(s.db, charge.id, { accountDirectory: s.directory, transferPayees: s.transferPayees, today: window.today })).toThrow(/read-only/);
    expect(() => approveAndBeginApply(s.db, charge.id, { fresh: [], decidedAt: new Date().toISOString() })).toThrow(/read-only/);
    expect(getFinancialPosting(s.db, charge.id)?.status).toBe("applied");
  });

  it("returns no recorded payments from a schedule without confirmed Actual history", () => {
    const s = createScenario({ mode: "http", apiRequestMock: mockApiRequest, pattern: "embedded-interest" });
    const result = summarizeStoredLoan(s.db, s.debtId, { today: "2025-12-31" });
    expect(result).toMatchObject({ ok: true, summary: { paymentsMade: 0, interestToDateMinor: 0 } });
    if (result.ok) expect(result.summary.totalPayments).toBeGreaterThan(0);
  });

  it("stops the summary forecast after confirmed payoff and resumes it when that payment is removed", async () => {
    const s = createScenario({ mode: "http", apiRequestMock: mockApiRequest, pattern: "embedded-interest", repaymentAnyPayee: true });
    s.seedPayment("2024-01-29");
    const wide = { from: "2024-01-01", to: "2024-06-30", today: "2024-06-30" };
    const [feb] = byKind((await s.preview(wide)).postings, "repayment-split");
    await s.apply(feb);
    if (feb.output.kind !== "restructure") throw new Error("Expected repayment split");
    const owed = feb.output.closing!.principalMinor;
    const lender = s.fake.seed({ account: ACCOUNTS.mortgage, date: "2024-02-20", amount: owed + 200_000, payee: s.fake.transferPayeeId(ACCOUNTS.checking) });
    const payment = s.seedPayment("2024-02-20", -(owed + 200_000), { payee: s.fake.transferPayeeId(ACCOUNTS.mortgage), transfer_id: lender });
    s.fake.row(lender)!.transfer_id = payment;
    const [payoff] = byKind((await s.preview(wide)).postings, "repayment-split").filter((posting) => posting.status === "proposed");
    await s.apply(payoff);
    const result = summarizeStoredLoan(s.db, s.debtId, { today: "2024-02-20" });
    expect(result).toMatchObject({ ok: true, summary: { next: null, dueSoonMinor: 0, dueSoonCount: 0, calculatedBalanceMinor: 0, payoffDate: "2024-02-20" } });
    if (!result.ok) throw new Error("Expected summary");
    expect(result.summary.totalPayments).toBe(result.summary.paymentsMade);
    expect(result.summary.totalInterestMinor).toBe(result.summary.interestToDateMinor);
    await s.transport.deleteTransactionForSync({ transactionId: payment });
    await s.preview(wide);
    const reopened = summarizeStoredLoan(s.db, s.debtId, { today: "2024-02-20" });
    if (!reopened.ok) throw new Error("Expected reopened summary");
    expect(reopened.summary.next).not.toBeNull();
    expect(reopened.summary.totalPayments).toBeGreaterThan(reopened.summary.paymentsMade);
  });
});
