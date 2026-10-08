import { apiRequest } from "@/lib/api/client";
import { resetAppDbForTests } from "@/lib/app-db/connection";
import { insertDebtObservation } from "@/lib/app-db/debtObservationRepository";
import { ACCOUNTS, byKind, createScenario } from "../testing/postingScenario";
import { declinePosting } from "./postingWorkflowService";
import { reconcileDebt } from "./reconciliationService";
import { recordExtraPayment } from "./extraPaymentService";

jest.mock("@/lib/api/client", () => ({ apiRequest: jest.fn() }));
const mockApiRequest = apiRequest as unknown as jest.Mock;
afterEach(() => resetAppDbForTests());

/** A lender statement is compared on its own date (owner decision 2026-10-07). */
describe("lender statements compared on their own date", () => {
  const window = { from: "2024-02-01", to: "2024-02-29", today: "2024-02-29" };

  async function loan() {
    const s = createScenario({ mode: "http", apiRequestMock: mockApiRequest, pattern: "embedded-interest" });
    // The loan as Actual holds it: the opening balance, then the February repayment split.
    s.fake.seed({ account: ACCOUNTS.mortgage, date: "2024-01-01", amount: -40_000_000, payee: null, notes: "Opening balance" });
    s.seedPayment("2024-02-01");
    const [split] = byKind((await s.preview(window)).postings, "repayment-split");
    expect((await s.apply(split)).posting.status).toBe("applied");
    const rows = async () => (await s.transport.listTransactionsForSync({ accountId: ACCOUNTS.mortgage })).map((r) => ({ date: r.date, amountMinor: r.amount }));
    const actualNow = async () => -(await rows()).reduce((sum, r) => sum + r.amountMinor, 0);
    const statement = (principalMinor: number, recordedAt = "2024-02-06T00:00:00Z") =>
      insertDebtObservation(s.db, { debtId: s.debtId, observedOn: "2024-02-05", recordedAt, principalMinor, accruedInterestMinor: 0, source: "manual-statement", supersedesObservationId: null, note: null }, recordedAt);
    const modelOn = (date: string) => {
      const rec = reconcileDebt(s.db, { debtId: s.debtId, comparisonDate: date, actualBalanceMinor: 0 });
      if (!rec.ok) throw new Error("reconcile");
      return rec.comparison.modelMinor;
    };
    return { s, rows, actualNow, statement, modelOn };
  }

  it("an extra payment after the statement is not a difference from the lender, and no adjustment is proposed", async () => {
    const { s, rows, actualNow, statement, modelOn } = await loan();
    statement(modelOn("2024-02-05"));
    // 20,000.00 paid on Feb 10, after the statement: counted as an extra payment.
    const extra = s.fake.seed({ account: ACCOUNTS.mortgage, date: "2024-02-10", amount: 2_000_000, payee: s.fake.transferPayeeId(ACCOUNTS.checking), notes: "Extra" });
    // The user explicitly confirms the extra before it changes the loan assumptions.
    recordExtraPayment(s.db, s.debtId, { actualTransactionId: extra, date: "2024-02-10", amountMinor: 2_000_000 });
    await s.preview(window);
    const comparison = { comparisonDate: "2024-02-29", actualBalanceMinor: await actualNow() };
    const loanAccountRows = await rows();
    const rec = reconcileDebt(s.db, { debtId: s.debtId, ...comparison, loanAccountRows });
    if (!rec.ok) throw new Error("reconcile");
    expect(rec.comparison.lenderAsOf).toMatchObject({ date: "2024-02-05" });
    expect(Math.abs(rec.comparison.actualVsLenderMinor!)).toBeLessThanOrEqual(100);
    expect(rec.drift).toBe("in-sync");
    // Without the loan account's rows, Actual is taken to have moved as the calculation did.
    const fallback = reconcileDebt(s.db, { debtId: s.debtId, ...comparison });
    if (!fallback.ok) throw new Error("reconcile");
    expect(Math.abs(fallback.comparison.actualVsLenderMinor!)).toBeLessThanOrEqual(100);
    const result = await s.preview(window, { comparison, loanAccountRows: (await s.transport.listTransactionsForSync({ accountId: ACCOUNTS.mortgage })).map((r) => ({ id: r.id, date: r.date, amountMinor: r.amount })) });
    expect(byKind(result.postings, "reconciliation-adjustment")).toEqual([]);
  });

  it("a real difference on the statement's date is proposed at that size; Not now keeps it away until the statement changes", async () => {
    const { s, actualNow, statement, modelOn } = await loan();
    statement(modelOn("2024-02-05") + 50_000);
    const comparison = { comparisonDate: "2024-02-29", actualBalanceMinor: await actualNow() };
    const loanAccountRows = (await s.transport.listTransactionsForSync({ accountId: ACCOUNTS.mortgage })).map((r) => ({ id: r.id, date: r.date, amountMinor: r.amount }));
    const [adjustment] = byKind((await s.preview(window, { comparison, loanAccountRows })).postings, "reconciliation-adjustment");
    expect(adjustment.output).toMatchObject({ kind: "create", components: [expect.objectContaining({ amountMinor: expect.any(Number) })] });
    if (adjustment.output.kind !== "create") throw new Error("create");
    expect(Math.abs(adjustment.output.components[0].amountMinor - 50_000)).toBeLessThanOrEqual(100);
    declinePosting(s.db, adjustment.id, "2024-02-29T00:00:00Z");
    expect(byKind((await s.preview(window, { comparison, loanAccountRows })).postings, "reconciliation-adjustment").filter((p) => p.status === "proposed")).toEqual([]);
    // A corrected statement: proposed again.
    statement(modelOn("2024-02-05") + 70_000, "2024-02-07T00:00:00Z");
    expect(byKind((await s.preview(window, { comparison, loanAccountRows })).postings, "reconciliation-adjustment").filter((p) => p.status === "proposed")).toHaveLength(1);
  });
});
