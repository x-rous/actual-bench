import { apiRequest } from "@/lib/api/client";
import { resetAppDbForTests } from "@/lib/app-db/connection";
import { listDebtTransactionLinks } from "@/lib/app-db/debtTransactionLinkRepository";
import { ACCOUNTS, byKind, createScenario } from "../testing/postingScenario";
import { getDebtDetail } from "./debtConfigService";
import { dismissExtraPayment, recordExtraPayment, removeExtraPayment, undismissExtraPayment } from "./extraPaymentService";

jest.mock("@/lib/api/client", () => ({ apiRequest: jest.fn() }));
const mockApiRequest = apiRequest as unknown as jest.Mock;
afterEach(() => resetAppDbForTests());

/** Extra payments found in Actual (owner decision 2026-10-05): list, record (link + event), remove. */
describe("payments into the loan that are not scheduled repayments", () => {
  const window = { from: "2024-02-01", to: "2024-02-29" };

  async function withExtra() {
    const s = createScenario({ mode: "http", apiRequestMock: mockApiRequest, pattern: "embedded-interest" });
    s.seedPayment("2024-02-01");
    const [split] = byKind((await s.preview(window)).postings, "repayment-split");
    expect((await s.apply(split)).posting.status).toBe("applied");
    const extra = s.fake.seed({ account: ACCOUNTS.mortgage, date: "2024-02-10", amount: 2_000_000, payee: s.fake.transferPayeeId(ACCOUNTS.checking), notes: "Extra" });
    return { s, extra };
  }

  it("suggests a newly discovered extra without changing the loan until confirmation", async () => {
    const { s, extra } = await withExtra();
    const revision = getDebtDetail(s.db, s.debtId)!.debt.currentRevision;
    const first = await s.preview(window);
    expect(first.unscheduled).toEqual([expect.objectContaining({ id: extra, recorded: false })]);
    expect(getDebtDetail(s.db, s.debtId)!.debt.currentRevision).toBe(revision);
    expect(getDebtDetail(s.db, s.debtId)!.assumptions).toEqual([]);
    recordExtraPayment(s.db, s.debtId, { actualTransactionId: extra, date: "2024-02-10", amountMinor: 2_000_000 });
    expect((await s.preview(window)).unscheduled).toEqual([expect.objectContaining({ id: extra, recorded: true, inSchedule: true })]);
    dismissExtraPayment(s.db, s.debtId, extra, "2024-02-10");
    expect((await s.preview(window)).unscheduled).toEqual([expect.objectContaining({ id: extra, dismissed: true })]);
    undismissExtraPayment(s.db, s.debtId, extra);
    expect((await s.preview(window)).unscheduled).toEqual([expect.objectContaining({ id: extra, recorded: false })]);
  });

  it("recording links it and adds the extra payment to Terms & Schedule; removing undoes both", async () => {
    const { s, extra } = await withExtra();
    const before = getDebtDetail(s.db, s.debtId)!.debt.currentRevision;
    const detail = recordExtraPayment(s.db, s.debtId, { actualTransactionId: extra, date: "2024-02-10", amountMinor: 2_000_000 });
    expect(detail.debt.currentRevision).toBe(before + 1);
    expect(detail.assumptions).toEqual([expect.objectContaining({ assumptionKind: "extra-repayment", effectiveFrom: "2024-02-10", amountMinor: 2_000_000 })]);
    expect(listDebtTransactionLinks(s.db, s.debtId).filter((l) => l.role === "extra-repayment").map((l) => l.actualTransactionId)).toEqual([extra]);
    expect((await s.preview(window)).unscheduled).toEqual([expect.objectContaining({ id: extra, recorded: true, inSchedule: true })]);
    // Recording again is harmless: no second link, no second event.
    expect(recordExtraPayment(s.db, s.debtId, { actualTransactionId: extra, date: "2024-02-10", amountMinor: 2_000_000 }).assumptions).toHaveLength(1);
    const removed = removeExtraPayment(s.db, s.debtId, extra);
    expect(removed.assumptions).toEqual([]);
    expect(listDebtTransactionLinks(s.db, s.debtId).filter((l) => l.role === "extra-repayment")).toEqual([]);
  });

  it("a recorded payment whose date or amount is changed in Actual moves the extra payment automatically on the next refresh", async () => {
    const { s, extra } = await withExtra();
    recordExtraPayment(s.db, s.debtId, { actualTransactionId: extra, date: "2024-02-10", amountMinor: 2_000_000 });
    const revision = getDebtDetail(s.db, s.debtId)!.debt.currentRevision;
    // Moved a month earlier in Actual: outside the period shown, but followed because it is linked.
    s.fake.editInActual(extra, { date: "2024-01-10" });
    const moved = await s.preview(window);
    expect(moved.followedExtraPayments).toEqual([{ transactionId: extra, change: "moved", from: { date: "2024-02-10", amountMinor: 2_000_000 }, to: { date: "2024-01-10", amountMinor: 2_000_000 } }]);
    expect(moved.unscheduled).toEqual([expect.objectContaining({ id: extra, date: "2024-01-10", recorded: true, inSchedule: true, changed: false })]);
    const detail = getDebtDetail(s.db, s.debtId)!;
    expect(detail.debt.currentRevision).toBe(revision + 1);
    expect(detail.assumptions).toEqual([expect.objectContaining({ assumptionKind: "extra-repayment", effectiveFrom: "2024-01-10", amountMinor: 2_000_000 })]);
    expect(listDebtTransactionLinks(s.db, s.debtId).find((l) => l.role === "extra-repayment")?.periodKey).toBe("2024-01-10");
    // Nothing more to follow: a second refresh saves no new revision.
    expect((await s.preview(window)).followedExtraPayments).toEqual([]);
    expect(getDebtDetail(s.db, s.debtId)!.debt.currentRevision).toBe(revision + 1);
    // An amount change is followed the same way.
    s.fake.editInActual(extra, { amount: 2_500_000 });
    await s.preview(window);
    expect(getDebtDetail(s.db, s.debtId)!.assumptions).toEqual([expect.objectContaining({ effectiveFrom: "2024-01-10", amountMinor: 2_500_000 })]);
    // Removing still finds the moved event.
    expect(removeExtraPayment(s.db, s.debtId, extra).assumptions).toEqual([]);
  });

  it("an extra payment changed in Actual to at least what is owed pays the loan off: out of Terms & Schedule, taken as the payoff with the interest (owner decision 2026-10-07)", async () => {
    const s = createScenario({ mode: "http", apiRequestMock: mockApiRequest, pattern: "embedded-interest", repaymentAnyPayee: true });
    s.seedPayment("2024-01-29");
    const wide = { from: "2024-01-01", to: "2024-06-30", today: "2024-06-30" };
    const [feb] = byKind((await s.preview(wide)).postings, "repayment-split");
    await s.apply(feb);
    const owed = feb.output.kind === "restructure" ? feb.output.closing!.principalMinor : 0;
    // A 20,000.00 transfer from the bank: counted as an extra payment, the loan stays open.
    const loanSide = s.fake.seed({ account: ACCOUNTS.mortgage, date: "2024-02-20", amount: 2_000_000, payee: s.fake.transferPayeeId(ACCOUNTS.checking) });
    const paid = s.seedPayment("2024-02-20", -2_000_000, { payee: s.fake.transferPayeeId(ACCOUNTS.mortgage), transfer_id: loanSide });
    s.fake.row(loanSide)!.transfer_id = paid;
    expect((await s.preview(wide)).recordedExtraPayments ?? []).toEqual([]);
    recordExtraPayment(s.db, s.debtId, { actualTransactionId: loanSide, date: "2024-02-20", amountMinor: 2_000_000 });
    expect(getDebtDetail(s.db, s.debtId)!.assumptions).toEqual([expect.objectContaining({ assumptionKind: "extra-repayment", amountMinor: 2_000_000 })]);
    // Raised in Actual to the principal owed plus the interest for the period (and a little more).
    const payoffAmount = owed + 200_000;
    s.fake.editInActual(loanSide, { amount: payoffAmount });
    s.fake.editInActual(paid, { amount: -payoffAmount });
    const result = await s.preview(wide);
    expect(result.followedExtraPayments).toEqual([expect.objectContaining({ transactionId: loanSide, change: "payoff" })]);
    expect(getDebtDetail(s.db, s.debtId)!.assumptions).toEqual([]);
    expect(listDebtTransactionLinks(s.db, s.debtId).filter((l) => l.role === "extra-repayment")).toEqual([]);
    expect(result.unscheduled.map((p) => p.id)).not.toContain(loanSide);
    const [payoff] = byKind(result.postings, "repayment-split").filter((p) => p.status === "proposed");
    expect(payoff.output).toMatchObject({ before: expect.objectContaining({ id: paid }), payoff: expect.objectContaining({ paidDate: "2024-02-20" }) });
    // A second refresh records nothing again.
    expect((await s.preview(wide)).recordedExtraPayments ?? []).toEqual([]);
    expect(getDebtDetail(s.db, s.debtId)!.assumptions).toEqual([]);
  });

  it("a payoff below Bench's interest to that day is still the payoff, with the lender's interest, for Review; no later due date is missed", async () => {
    const s = createScenario({ mode: "http", apiRequestMock: mockApiRequest, pattern: "embedded-interest", repaymentAnyPayee: true });
    s.seedPayment("2024-01-29");
    const wide = { from: "2024-01-01", to: "2024-06-30", today: "2024-06-30" };
    const [feb] = byKind((await s.preview(wide)).postings, "repayment-split");
    await s.apply(feb);
    const owed = feb.output.kind === "restructure" ? feb.output.closing!.principalMinor : 0;
    // 100.00 above the principal: less than the interest Bench works out for those days.
    const loanSide = s.fake.seed({ account: ACCOUNTS.mortgage, date: "2024-02-20", amount: owed + 10_000, payee: s.fake.transferPayeeId(ACCOUNTS.checking) });
    const paid = s.seedPayment("2024-02-20", -(owed + 10_000), { payee: s.fake.transferPayeeId(ACCOUNTS.mortgage), transfer_id: loanSide });
    s.fake.row(loanSide)!.transfer_id = paid;
    const result = await s.preview(wide);
    const [payoff] = byKind(result.postings, "repayment-split").filter((p) => p.status === "proposed");
    expect(payoff.classification).toBe("review");
    expect(payoff.reasons.find((r) => r.code === "payoff-figures")?.text).toMatch(/the lender's own figure, so taken off the interest: interest 100\.00/);
    if (payoff.output.kind !== "restructure") throw new Error("restructure");
    expect(payoff.output.expectedPostState.children.map((c) => Math.abs(c.amountMinor)).sort((a, b) => a - b)).toEqual([10_000, owed]);
    expect(result.unscheduled.map((p) => p.id)).not.toContain(loanSide);
    expect(result.notices.filter((n) => n.periodKey > "2024-02-20" && n.code === "repayment-missing")).toEqual([]);
  });

  it("a payoff of exactly the principal is recorded as it is (no one-part split), and a failed earlier attempt is closed once it is applied", async () => {
    const s = createScenario({ mode: "http", apiRequestMock: mockApiRequest, pattern: "embedded-interest", repaymentAnyPayee: true });
    s.seedPayment("2024-01-29");
    const wide = { from: "2024-01-01", to: "2024-06-30", today: "2024-06-30" };
    const [feb] = byKind((await s.preview(wide)).postings, "repayment-split");
    await s.apply(feb);
    const owed = feb.output.kind === "restructure" ? feb.output.closing!.principalMinor : 0;
    const loanSide = s.fake.seed({ account: ACCOUNTS.mortgage, date: "2024-02-20", amount: owed + 10_000, payee: s.fake.transferPayeeId(ACCOUNTS.checking) });
    const paid = s.seedPayment("2024-02-20", -(owed + 10_000), { payee: s.fake.transferPayeeId(ACCOUNTS.mortgage), transfer_id: loanSide });
    s.fake.row(loanSide)!.transfer_id = paid;
    // A first attempt that failed (as an older version could leave it).
    const [first] = byKind((await s.preview(wide)).postings, "repayment-split").filter((p) => p.status === "proposed");
    const repo = await import("@/lib/app-db/financialPostingRepository");
    repo.decidePosting(s.db, first.id, "approved", "2024-06-30T00:00:00Z");
    repo.beginApplyingPosting(s.db, first.id, "2024-06-30T00:00:01Z");
    repo.markPostingFailed(s.db, first.id, { message: "A split needs at least two children." }, "2024-06-30T00:00:02Z");
    // Changed in Actual to exactly the principal owed.
    s.fake.editInActual(loanSide, { amount: owed });
    s.fake.editInActual(paid, { amount: -owed });
    const [payoff] = byKind((await s.preview(wide)).postings, "repayment-split").filter((p) => p.status === "proposed");
    expect(payoff.output).toMatchObject({ kind: "claim", rows: [expect.objectContaining({ id: paid })], payoff: expect.objectContaining({ paidDate: "2024-02-20" }) });
    expect(payoff.classification).toBe("review");
    const writes = s.fake.writes().length;
    expect((await s.apply(payoff)).posting.status).toBe("applied");
    expect(s.fake.writes().length).toBe(writes);
    await s.preview(wide);
    expect(repo.getFinancialPosting(s.db, first.id)).toMatchObject({ status: "superseded", error: { superseded: "replaced-by-applied" } });
  });

  it("a payment at least the principal owed is never recorded as an extra payment", async () => {
    const { s } = await withExtra();
    const detail = getDebtDetail(s.db, s.debtId)!;
    expect(() => recordExtraPayment(s.db, s.debtId, { actualTransactionId: "tx-big", date: "2024-02-10", amountMinor: 50_000_000 })).toThrow(/pays the loan off/);
    expect(getDebtDetail(s.db, s.debtId)!.debt.currentRevision).toBe(detail.debt.currentRevision);
    expect(listDebtTransactionLinks(s.db, s.debtId).filter((l) => l.actualTransactionId === "tx-big")).toEqual([]);
  });

  it("an extra payment already saved in Terms & Schedule that pays the loan off is taken out on the next refresh", async () => {
    const { s, extra } = await withExtra();
    // As an older version saved it: straight into Terms & Schedule, more than the loan owed.
    s.fake.editInActual(extra, { amount: 50_000_000 });
    const detail = getDebtDetail(s.db, s.debtId)!;
    const { saveBaselineAssumptions } = await import("./debtConfigService");
    const { insertDebtTransactionLink } = await import("@/lib/app-db/debtTransactionLinkRepository");
    insertDebtTransactionLink(s.db, { debtId: s.debtId, budgetSyncId: detail.debt.budgetSyncId, actualTransactionId: extra, role: "extra-repayment", periodKey: "2024-02-10", linkSource: "user" });
    saveBaselineAssumptions(s.db, s.debtId, [{ kind: "extra-repayment", effectiveFrom: "2024-02-10", recurrence: null, amountMinor: 50_000_000, feeTreatment: null, offsetAccountId: null, note: "Extra payment recorded from Actual" }], "test");
    const result = await s.preview(window);
    expect(result.followedExtraPayments).toEqual([expect.objectContaining({ transactionId: extra, change: "payoff" })]);
    expect(getDebtDetail(s.db, s.debtId)!.assumptions).toEqual([]);
  });

  it("a recorded payment deleted in Actual is removed from Terms & Schedule with its link, judged only from the whole loan account", async () => {
    const { s, extra } = await withExtra();
    recordExtraPayment(s.db, s.debtId, { actualTransactionId: extra, date: "2024-02-10", amountMinor: 2_000_000 });
    const loanAccountRows = async () => (await s.transport.listTransactionsForSync({ accountId: ACCOUNTS.mortgage })).map((t) => ({ id: t.id, date: t.date, amountMinor: t.amount }));
    // Still there: nothing changes.
    expect((await s.preview(window, { loanAccountRows: await loanAccountRows() })).followedExtraPayments).toEqual([]);
    await s.transport.deleteTransactionForSync({ transactionId: extra });
    // Without the whole loan account, a missing row is not evidence of a deletion.
    expect((await s.preview(window)).followedExtraPayments).toEqual([]);
    expect(getDebtDetail(s.db, s.debtId)!.assumptions).toHaveLength(1);
    const result = await s.preview(window, { loanAccountRows: await loanAccountRows() });
    expect(result.followedExtraPayments).toEqual([{ transactionId: extra, change: "removed", from: { date: "2024-02-10", amountMinor: 2_000_000 } }]);
    expect(getDebtDetail(s.db, s.debtId)!.assumptions).toEqual([]);
    expect(listDebtTransactionLinks(s.db, s.debtId).filter((l) => l.role === "extra-repayment")).toEqual([]);
    expect(result.unscheduled).toEqual([]);
  });

  it("money taken out of the loan account that nothing explains is listed too, as 'out', with nothing to record", async () => {
    const { s, extra } = await withExtra();
    const out = s.fake.seed({ account: ACCOUNTS.mortgage, date: "2024-02-15", amount: -604_356, payee: s.fake.transferPayeeId(ACCOUNTS.checking), notes: "Wrong way round" });
    const { unscheduled } = await s.preview(window);
    expect(unscheduled).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: out, date: "2024-02-15", amountMinor: 604_356, direction: "out", recorded: false }),
      expect.objectContaining({ id: extra, direction: "in" }),
    ]));
  });

  it("while Terms & Schedule has unsaved edits, a changed extra payment is shown as changed, not moved", async () => {
    const { s, extra } = await withExtra();
    recordExtraPayment(s.db, s.debtId, { actualTransactionId: extra, date: "2024-02-10", amountMinor: 2_000_000 });
    const revision = getDebtDetail(s.db, s.debtId)!.debt.currentRevision;
    s.fake.editInActual(extra, { date: "2024-02-12" });
    const result = await s.preview(window, { followExtraPayments: false });
    expect(result.followedExtraPayments).toEqual([]);
    expect(getDebtDetail(s.db, s.debtId)!.debt.currentRevision).toBe(revision);
    expect(result.unscheduled).toEqual([expect.objectContaining({ id: extra, changed: true, recordedAs: { date: "2024-02-10", amountMinor: 2_000_000 } })]);
  });

  it("refuses a non-positive amount", async () => {
    const { s, extra } = await withExtra();
    expect(() => recordExtraPayment(s.db, s.debtId, { actualTransactionId: extra, date: "2024-02-10", amountMinor: 0 })).toThrow(/positive/);
  });
});
