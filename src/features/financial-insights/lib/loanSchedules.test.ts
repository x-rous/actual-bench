import type { SyncSourceTransaction } from "@/lib/actual/transport";
import { contractSchedule, planTracking, trackingAgrees, type TrackingInput } from "@/lib/assets-debt/tracking/plan";
import { addDays, addMonths } from "@/lib/financial-models/calendar/dates";
import { sim } from "@/features/assets-debt/lib/simulatorTestKit";
import { simulationToModel } from "@/features/assets-debt/lib/simulatorModel";
import { summarizeLoanEvents } from "@/lib/assets-debt/services/loanSummaryEvents";
import { trackedLoanEvents, type TrackedLoan } from "@/features/assets-debt/lib/trackedLoan";
import { monthlyRepayment, recordedCostRows, scheduleFromLoan } from "./loanSchedules";

/**
 * Against the real Loans engine: a 48-month loan tracked in Actual, 36 installments paid, the 36th a day before it falls
 * due. The Loans page says "36 of 48 paid, 12 left", and so must this.
 */
const state = sim({ principalMinor: 35_000_000, termMonths: 48, startDate: "2023-10-25", firstPaymentDate: "2023-12-01" }, "0.0699");
const built = simulationToModel(state);
if (!built.ok) throw new Error("the sample loan does not calculate");
const { model } = built;
const schedule = contractSchedule(model, "2030-01-01");
if (!schedule.ok) throw new Error(schedule.message);
const dues = schedule.dues;

const tx = (fields: Partial<SyncSourceTransaction> & Pick<SyncSourceTransaction, "id" | "accountId" | "date" | "amount">): SyncSourceTransaction => ({
  payeeId: null, payeeName: null, categoryId: null, categoryName: null, notes: null, cleared: true, reconciled: false,
  importedId: null, importedPayee: null, transferId: null, isParent: false, isChild: false, parentId: null, splitLines: [], ...fields,
});

/** Installments 1..count recorded as Bench records them: a principal transfer into the loan account and an interest line. */
function plan(count: number, paidOn: (index: number) => string, today: string, skip: number[] = [], interestOf: Record<number, number> = {}) {
  const loanRows = [tx({ id: "opening", accountId: "loan", date: model.terms.openingDate, amount: -model.terms.openingPrincipalMinor, payeeName: "Starting Balance" })];
  const bankRows: SyncSourceTransaction[] = [];
  dues.slice(0, count).forEach((due, i) => {
    if (skip.includes(i)) return;
    const paid = paidOn(i);
    // The payment is always the scheduled amount; an early one carries the interest accrued to the day it was paid.
    const interest = interestOf[i] ?? due.interestMinor;
    const principal = due.scheduledMinor - interest;
    loanRows.push(tx({ id: `loan-${i}`, accountId: "loan", date: paid, amount: principal, transferId: `principal-${i}` }));
    bankRows.push(tx({ id: `payment-${i}`, accountId: "bank", date: paid, amount: -due.scheduledMinor, isParent: true, splitLines: [
      { id: `principal-${i}`, amount: -principal, transferId: `loan-${i}`, payeeId: null, payeeName: null, categoryId: null, categoryName: null, notes: null },
      { id: `interest-${i}`, amount: -interest, transferId: null, payeeId: null, payeeName: null, categoryId: "interest", categoryName: null, notes: null },
    ] }));
  });
  const input: TrackingInput = {
    debt: { id: "d", budgetSyncId: "b", liabilityAccountId: "loan", trackingStartDueDate: dues[0].date, representation: "split", loanPaymentCategoryId: null, interestCategoryId: "interest", feeCategoryId: null, principalNoteSuffix: "", interestNoteSuffix: "", toleranceMinor: 100, missingGraceDays: 5 },
    model, today, accounts: [], transferPayeeByAccount: {}, loanRows, bankRows, entries: [], rules: [],
  };
  const result = planTracking(input);
  if (!result.ok) throw new Error(result.message);
  return { debt: input.debt, simulation: state, plan: result, agrees: trackingAgrees(result, 100) } satisfies TrackedLoan;
}

describe("a tracked loan's repayments, from the real loan engine", () => {
  const dueOf36 = dues[35];
  const today = addDays(dueOf36.date, -1);
  const paidEarly = (i: number) => (i === 35 ? today : dues[i].date);
  // What the calculation itself charges up to the early day: the interest a lender working by the day would record.
  const earlyInterest = plan(36, paidEarly, today).plan.installments[35].calculatedInterestMinor;

  it("does not count an installment already paid, even when it was paid before its due date", () => {
    const tracked = plan(36, paidEarly, today, [], { 35: earlyInterest });
    expect(dueOf36.date > today).toBe(true);
    expect(tracked.agrees).toBe(true);
    const result = scheduleFromLoan("loan", tracked, today);
    if (result.state !== "ready") throw new Error(result.reason);

    // Installments 37 to 48 are left, 12 of them; the 36th is in Actual's balance already, so it is not due again.
    // Twelve months from today end the day before the 48th falls due, so 37 to 47 are in the window.
    const remaining = dues.slice(36);
    expect(remaining).toHaveLength(12);
    const left = remaining.filter((d) => d.date <= addMonths(today, 12));
    expect(left.map((d) => d.no)).toEqual(Array.from({ length: 11 }, (_, i) => 37 + i));
    expect(result.payments).toBe(11);
    // The full cash payment, principal and interest. Nothing caps it: the principal in the whole schedule is exactly what is owed.
    expect(result.totalMinor).toBe(left.reduce((sum, d) => sum + d.scheduledMinor, 0));
    expect(remaining.reduce((sum, d) => sum + d.principalMinor, 0)).toBe(dueOf36.balanceAfterMinor);
    // Spread over the twelve months of the window, since the loan goes on past it.
    expect(result.monthlyMinor).toBe(Math.round(result.totalMinor / 12));
    expect(result.monthlyMinor).toBeGreaterThan(0);
    // The principal due is the part of those installments that lowers the debt, from the schedule the Loans page composes (it
    // differs from the contract's by the interest the early payment changed, so it is compared with the page's own rows).
    const composed = trackedLoanEvents(tracked, today);
    if (!composed.ok) throw new Error(composed.reason);
    const pageRows = composed.events.filter((e) => (e.eventType === "repayment" || e.eventType === "final-payment") && e.date > today && e.date <= addMonths(today, 12));
    expect(pageRows).toHaveLength(11);
    expect(result.principalNext12Minor).toBe(pageRows.reduce((sum, e) => sum - e.principalMovementMinor, 0));
    expect(Math.abs(result.principalNext12Minor - left.reduce((sum, d) => sum + d.principalMinor, 0))).toBeLessThan(10_000);
    expect(result.costNext12Minor).toBe(pageRows.reduce((sum, e) => sum + e.interestMinor + e.feesMinor, 0));
    expect(result.principalNext12Minor + result.costNext12Minor).toBe(result.totalMinor);
    expect(result.principalNext12Minor).toBeLessThan(result.totalMinor);
    expect(result.principalNext12Minor).toBeLessThanOrEqual(dueOf36.balanceAfterMinor);
  });

  it("counts the installment while it lasts, not diluted over twelve months, when the loan ends sooner", () => {
    const ending = plan(43, (i) => dues[i].date, dues[42].date);
    const result = scheduleFromLoan("loan", ending, dues[42].date);
    if (result.state !== "ready") throw new Error(result.reason);
    const left = dues.slice(43);
    expect(left).toHaveLength(5);
    expect(result.payments).toBe(5);
    expect(result.monthlyMinor).toBe(Math.round(left.reduce((sum, d) => sum + d.scheduledMinor, 0) / 5));
  });

  it("is unavailable, not estimated, when a payment is missing from Actual", () => {
    const tracked = plan(36, paidEarly, today, [29], { 35: earlyInterest });
    const result = scheduleFromLoan("loan", tracked, today);
    expect(tracked.agrees).toBe(false);
    expect(result).toEqual({ accountId: "loan", state: "unavailable", reason: "Its schedule does not agree with the loan account in Actual; review it in Loans" });
  });
});

describe("a tracked loan, as the Loans list shows it", () => {
  const today = addDays(dues[35].date, -1);
  const paidEarly = (i: number) => (i === 35 ? today : dues[i].date);
  const earlyInterest = plan(36, paidEarly, today).plan.installments[35].calculatedInterestMinor;
  const tracked = plan(36, paidEarly, today, [], { 35: earlyInterest });

  it("counts an installment paid before its due date as paid, not as still to come", () => {
    const composed = trackedLoanEvents(tracked, today);
    if (!composed.ok) throw new Error(composed.reason);
    const summary = summarizeLoanEvents(composed.events, { today, forecastFrom: dues[0].date, paidOffOn: null, startingPrincipalMinor: model.terms.openingPrincipalMinor });
    // 36 of 48 paid and 12 left, as the Loans page says; not 35 paid and 13 left.
    expect([summary.paymentsMade, summary.totalPayments - summary.paymentsMade, summary.totalPayments]).toEqual([36, 12, 48]);
    expect(summary.next).toEqual({ date: dues[36].date, amountMinor: dues[36].scheduledMinor });
    expect(summary.calculatedBalanceMinor).toBe(tracked.plan.figures.owedInActualMinor);
    // What is due soon is what is really still to pay: the 36th, already paid, is not in it.
    expect(summary.dueSoonMinor).toBe(dues.slice(36).filter((d) => d.date <= addDays(today, 30)).reduce((sum, d) => sum + d.scheduledMinor, 0));
    expect(summary.dueSoonCount).toBe(dues.slice(36).filter((d) => d.date <= addDays(today, 30)).length);
    // Interest to date is what was recorded, not what the contract schedule says.
    expect(summary.interestToDateMinor).toBeGreaterThan(0);
  });

  it("identifies a loan's own recorded interest lines, and nothing else", () => {
    const ids = recordedCostRows(tracked.plan, "loan").map((r) => r.id);
    expect(ids).toHaveLength(36);
    expect(new Set(ids)).toEqual(new Set(Array.from({ length: 36 }, (_, i) => `interest-${i}`)));
  });
});

describe("the monthly amount of a repayment schedule", () => {
  const pay = (date: string, amount: number, principal = amount) => ({ eventType: "repayment", date, cashMovementMinor: -amount, principalMovementMinor: -principal, interestMinor: amount - principal, feesMinor: 0 });

  it("spreads the cash due over the months in which a payment falls, and follows a payment that changes", () => {
    const events = [pay("2026-12-01", 100_000), pay("2027-01-01", 100_000), pay("2027-02-01", 130_000), { ...pay("2027-03-01", 130_000), eventType: "final-payment" }, { eventType: "interest-charge", date: "2027-03-01", cashMovementMinor: 0, principalMovementMinor: 0 }];
    expect(monthlyRepayment(events, "2027-11-01")).toEqual({ monthlyMinor: 115_000, payments: 4, totalMinor: 460_000, principalNext12Minor: 460_000, costNext12Minor: 0 });
  });

  it("spreads a quarterly or yearly payment over the months, not as a whole installment every month", () => {
    const quarterly = [pay("2026-12-01", 300_000), pay("2027-03-01", 300_000), pay("2027-06-01", 300_000), pay("2027-09-01", 300_000)];
    expect(monthlyRepayment(quarterly, "2027-11-01")).toMatchObject({ monthlyMinor: 100_000, payments: 4, totalMinor: 1_200_000 });
    expect(monthlyRepayment([pay("2027-05-01", 1_200_000)], "2027-11-01")).toMatchObject({ monthlyMinor: 100_000 });
  });

  it("ignores what falls after the window, and is zero for a loan with nothing left to pay", () => {
    expect(monthlyRepayment([pay("2026-12-01", 100_000), pay("2027-12-01", 100_000)], "2027-11-01")).toMatchObject({ payments: 1 });
    expect(monthlyRepayment([], "2027-11-01")).toEqual({ monthlyMinor: 0, payments: 0, totalMinor: 0, principalNext12Minor: 0, costNext12Minor: 0 });
  });

  it("counts an overdue installment the calculation still expects, as the cash buffer does", () => {
    // Only the end of the window cuts events off: an installment dated before today is still due until Actual records it.
    const events = [pay("2026-10-01", 100_000, 70_000), pay("2026-12-01", 100_000, 71_000)];
    expect(monthlyRepayment(events, "2027-11-01")).toMatchObject({ payments: 2, principalNext12Minor: 141_000, costNext12Minor: 59_000 });
  });

  it("takes the principal out of each installment, and never counts a negative one", () => {
    const events = [pay("2026-12-01", 100_000, 70_000), pay("2027-01-01", 100_000, 72_000), { ...pay("2027-02-01", 100_000), principalMovementMinor: 5_000 }];
    expect(monthlyRepayment(events, "2027-11-01").principalNext12Minor).toBe(142_000);
  });

  it("counts a weekly loan by the month, not by the payment", () => {
    const events = ["2026-12-04", "2026-12-11", "2026-12-18", "2026-12-25"].map((d, i, all) => ({ ...pay(d, 25_000), eventType: i === all.length - 1 ? "final-payment" : "repayment" }));
    expect(monthlyRepayment(events, "2027-11-01").monthlyMinor).toBe(100_000);
  });
});

describe("the cost rows of a loan whose lender charges interest as its own transaction", () => {
  const plan = { installments: [], ledger: [
    { row: { id: "interest-1", transferId: null }, type: "interest-charged", benchMade: false },
    { row: { id: "fee-1", transferId: null }, type: "fee", benchMade: false },
    { row: { id: "draw-1", transferId: "other" }, type: "interest-charged", benchMade: false },
    { row: { id: "posted", transferId: null }, type: "interest-charged", benchMade: true },
    { row: { id: "payment", transferId: null }, type: "principal-repayment", benchMade: false },
  ] } as never;

  it("are the interest charged and fee rows of the loan account, never a transfer or a row Bench posted", () => {
    expect(recordedCostRows(plan, "").map((r) => r.id).sort()).toEqual(["fee-1", "interest-1"]);
  });

  it("carry no kind, so a charge added to the loan is taken out of spending but is not counted as interest or fees paid", () => {
    const tags = recordedCostRows(plan, "loan");
    expect(tags.map((t) => [t.id, t.loanAccountId, t.kind])).toEqual([["interest-1", "loan", undefined], ["fee-1", "loan", undefined]]);
  });
});
