import type { SyncSourceTransaction } from "@/lib/actual/transport";
import type { Anchor, LedgerEvent, LoanModelSnapshot } from "@/lib/financial-models/loan/model";
import { simulate } from "@/lib/financial-models/loan/projection";
import { contractSchedule, planTracking, type TrackingInput } from "./plan";

/**
 * Tracking edge cases found in review, on the French mortgage of feedback #399 (203,353.10 at 3.6% over 276 months,
 * principal growing 0.34592411% per repayment) and its level-payment twin.
 */
const PROFILE = {
  amortization: "progressive-principal", rateQuote: "nominal-simple-periodic", dayCount: "actual-365-fixed", accrual: "per-period", chargeFrequency: "at-repayment", chargeDay: null,
  capitalization: "at-charge", repaymentFrequency: "monthly", repaymentDerivation: "annuity-at-payment-frequency", recast: "never", rateEffectiveTiming: "from-next-charge-period",
  repaymentEffectiveTiming: "transaction-date",
  rounding: { paymentRounding: "half-up", interestPostingRounding: "half-up", intermediateScale: { mode: "full" }, intermediateRounding: "half-even", balancePrecision: "round-each-posting" },
  eventOrder: { timing: "start-of-day" }, finalPayment: "true-up-to-zero", shortMonth: "clamp-to-last-calendar-day", negativeAmortizationAllowed: false,
  interestOnlyRepayment: "charged-interest-outstanding", presetId: null,
};
const TERMS = { openingDate: "2026-09-30", openingPrincipalMinor: 203_353_10, maturityDate: null, contractualTermMonths: 276, amortizationTermMonths: 276, contractualPaymentMinor: null, creditLimitMinor: null, firstPaymentDate: "2026-10-30", firstInterestChargeDate: null };
const DAILY = { accrual: "daily-simple", rateEffectiveTiming: "on-accrual-effective-date", eventOrder: { timing: "end-of-day" } };

function loan(over: Partial<LoanModelSnapshot> = {}, profile: Record<string, unknown> = {}): LoanModelSnapshot {
  return {
    debtId: "fr", revision: 1, currency: { code: "EUR", minorDigits: 2 }, behaviorClass: "term-loan", lenderPattern: "embedded-interest",
    terms: TERMS, profile: { ...PROFILE, ...profile }, rates: [{ accrualEffectiveFrom: "2026-09-30", annualRateDecimal: "0.036" }],
    phases: [], offsets: [], components: [], paymentRecasts: [], assumptions: [], revolving: null,
    progressive: { growthPerRepaymentDecimal: "0.0034592411" }, ...over,
  } as LoanModelSnapshot;
}
const level = (over: Partial<LoanModelSnapshot> = {}, profile: Record<string, unknown> = {}) => loan({ progressive: null, ...over }, { amortization: "level-payment", ...profile });

let seq = 0;
const tx = (t: Partial<SyncSourceTransaction> & Pick<SyncSourceTransaction, "accountId" | "date" | "amount">): SyncSourceTransaction => ({ id: `r${++seq}`, payeeId: null, payeeName: null, categoryId: null, categoryName: null, notes: null, cleared: true, reconciled: false, importedId: null, importedPayee: null, transferId: null, isParent: false, isChild: false, parentId: null, splitLines: [], ...t });
function transfer(date: string, amount: number) {
  const bank = tx({ accountId: "checking", date, amount: -amount });
  const loanSide = tx({ accountId: "loan", date, amount, transferId: bank.id });
  bank.transferId = loanSide.id;
  return { bank, loan: loanSide };
}
function plan(m: LoanModelSnapshot, rows: ReturnType<typeof transfer>[], today: string, over: Partial<TrackingInput> = {}) {
  const received = transfer(m.terms.openingDate, -m.terms.openingPrincipalMinor);
  const all = [received, ...rows];
  const r = planTracking({
    debt: { id: "d1", budgetSyncId: "b1", liabilityAccountId: "loan", trackingStartDueDate: "2026-10-30", representation: "split", loanPaymentCategoryId: "c", interestCategoryId: "ci", feeCategoryId: null, principalNoteSuffix: "", interestNoteSuffix: "#i", toleranceMinor: 100, missingGraceDays: 5 },
    model: m, today, accounts: [{ id: "loan", name: "L", offBudget: true, closed: false }, { id: "checking", name: "C", offBudget: false, closed: false }],
    transferPayeeByAccount: { loan: "pl", checking: "pc" }, loanRows: all.map((x) => x.loan), bankRows: all.map((x) => x.bank), entries: [], rules: [], ...over,
  });
  if (!r.ok) throw new Error(r.message);
  return r;
}
function engine(m: LoanModelSnapshot, events: LedgerEvent[] = [], to = "2027-06-30", anchor: Partial<Anchor> = {}) {
  const r = simulate({ model: m, anchor: { date: m.terms.openingDate, principalMinor: m.terms.openingPrincipalMinor, accruedInterestMinor: 0, source: "opening", ...anchor }, events, to });
  if (!r.ok) throw new Error(r.blocked.map((b) => `${b.code}: ${b.message}`).join("; "));
  return r.events.filter((e) => e.type === "repayment" || e.type === "final-payment");
}
/** The projection a tracked loan continues with, from its restart. */
function projection(m: LoanModelSnapshot, tracked: ReturnType<typeof plan>, to = "2027-06-30") {
  const a = tracked.anchor;
  return engine(m, a.events, to, { date: a.restartDate, principalMinor: a.principalMinor, accruedInterestMinor: a.accruedInterestMinor, unpaidInterestMinor: a.unpaidInterestMinor ?? null, corrections: a.corrections ?? null, progressiveBasis: a.progressiveBasis ?? null, scheduledPaymentMinor: a.scheduledPaymentMinor, source: "tracked" });
}
const extra = (date: string, amountMinor: number): LedgerEvent => ({ kind: "extra-repayment", date, amountMinor, ref: { source: "actual", id: `x-${date}` } });
const at = (rows: ReturnType<typeof engine>, date: string) => rows.find((e) => e.date === date)!;

describe("tracking per-period loans: edge cases", () => {
  it("charges an installment on its own period whatever order the installments were paid in", () => {
    const m = level();
    const contract = contractSchedule(m, "2027-03-01");
    if (!contract.ok) throw new Error(contract.message);
    const pay = contract.dues[0].scheduledMinor;
    const pinned = (first: ReturnType<typeof transfer>, second: ReturnType<typeof transfer>) => [
      { actualTransactionId: first.loan.id, actualAccountId: "loan", entryType: "principal-repayment" as const, installmentDueDate: "2026-10-30", revision: 1, updatedAt: "x" },
      { actualTransactionId: second.loan.id, actualAccountId: "loan", entryType: "principal-repayment" as const, installmentDueDate: "2026-11-30", revision: 1, updatedAt: "x" },
    ];
    const a = transfer("2026-11-28", pay), b = transfer("2026-11-29", pay);
    const inOrder = plan(m, [a, b], "2026-12-05", { entries: pinned(a, b) });
    const c = transfer("2026-11-28", pay), d = transfer("2026-11-29", pay);
    // Installment 2 is paid a day before installment 1.
    const swapped = plan(m, [c, d], "2026-12-05", { entries: pinned(d, c) });
    expect(inOrder.installments[1].interestMinor).toBe(contract.dues[1].interestMinor);
    expect(swapped.installments[1].interestMinor).toBe(contract.dues[1].interestMinor);
    expect(swapped.installments[0].interestMinor).toBe(contract.dues[0].interestMinor);
  });

  it("keeps the remainder under carry-full-precision, as the contract does", () => {
    const m = level({ rates: [{ accrualEffectiveFrom: "2026-09-30", annualRateDecimal: "0.0357" }] }, { rounding: { ...PROFILE.rounding, balancePrecision: "carry-full-precision" } });
    const contract = contractSchedule(m, "2028-12-31");
    if (!contract.ok) throw new Error(contract.message);
    const tracked = plan(m, contract.dues.slice(0, 24).map((x) => transfer(x.date, x.scheduledMinor)), "2028-10-30");
    expect(tracked.installments.slice(0, 24).map((x) => x.interestMinor)).toEqual(contract.dues.slice(0, 24).map((x) => x.interestMinor));
  });

  it("carries the interest a short payment left unpaid into the projection", () => {
    const m = loan();
    const tracked = plan(m, [transfer("2026-10-30", 1_051_44), transfer("2026-11-30", 500_00)], "2026-12-05");
    const next = tracked.installments.find((i) => i.dueDate === "2026-12-30")!;
    const projected = at(projection(m, tracked), "2026-12-30");
    expect(tracked.anchor.unpaidInterestMinor).toBeGreaterThan(0);
    expect(projected.interestMinor).toBe(next.interestMinor);
    expect(-projected.cashMovementMinor).toBe(next.scheduledMinor);
  });

  it("projects on from a higher balance accepted between due dates, counting it from the next period", () => {
    const m = loan();
    const tracked = plan(m, [transfer("2026-10-30", 1_051_44)], "2026-11-20", { anchors: [{ date: "2026-11-10", principalMinor: 203_000_00 }] });
    const rows = projection(m, tracked);
    const nov = at(rows, "2026-11-30");
    // November's period opened before the correction: its interest is on the balance after the October installment...
    expect(nov.interestMinor).toBe(tracked.installments.find((i) => i.dueDate === "2026-11-30")!.interestMinor);
    // ...and December's is on the accepted balance less November's principal.
    expect(at(rows, "2026-12-30").interestMinor).toBe(Math.round((203_000_00 + nov.principalMovementMinor) * 0.003));
  });

  it("expects only interest in a second interest-only phase after the series changed", () => {
    const m = loan({ phases: [{ kind: "interest-only", from: "2026-09-30", to: "2026-11-30", recastAtEnd: "never" }, { kind: "interest-only", from: "2027-03-01", to: "2027-05-31", recastAtEnd: "never" }] });
    const contract = engine(m);
    const paid = contract.filter((e) => e.date <= "2027-02-28").map((e) => transfer(e.date, -e.cashMovementMinor));
    const tracked = plan(m, paid, "2027-03-05");
    const io = tracked.installments.find((i) => i.dueDate === "2027-03-30")!;
    expect(io.scheduledMinor).toBe(-at(contract, "2027-03-30").cashMovementMinor);
    expect(io.principalMinor).toBe(0);
  });
});

describe("tracking daily-interest progressive loans: edge cases", () => {
  it("expects the engine's repayment when interest is charged on its own day", () => {
    const m = loan({ terms: { ...TERMS, firstInterestChargeDate: "2026-10-01" } }, { ...DAILY, chargeFrequency: "monthly", chargeDay: 1 });
    const contract = engine(m, [], "2026-12-31");
    const before = plan(m, [], "2026-10-05");
    expect(before.installments[0].scheduledMinor).toBe(-at(contract, "2026-10-30").cashMovementMinor);
    const after = plan(m, [transfer("2026-10-30", -at(contract, "2026-10-30").cashMovementMinor)], "2026-11-05");
    expect(after.installments.find((i) => i.dueDate === "2026-11-30")!.scheduledMinor).toBe(-at(contract, "2026-11-30").cashMovementMinor);
  });

  it("keeps the tracked series after a contract recast", () => {
    const m = loan({ paymentRecasts: [{ date: "2027-01-31" }] }, { ...DAILY, recast: "on-contract-date" });
    const events = [extra("2027-01-15", 10_000_00)];
    const contract = engine(m, events);
    const paid = contract.filter((e) => e.date <= "2027-01-30").map((e) => transfer(e.date, -e.cashMovementMinor));
    const tracked = plan(m, [...paid, transfer("2027-01-15", 10_000_00)], "2027-02-05");
    const feb = tracked.installments.find((i) => i.dueDate === "2027-02-28")!;
    expect(feb.principalMinor).toBe(-at(contract, "2027-02-28").principalMovementMinor);
    expect(-at(projection(m, tracked), "2027-02-28").principalMovementMinor).toBe(feb.principalMinor);
  });

  it("carries the interest owed since the last repayment across a restart between a charge and a repayment", () => {
    const m = loan({ terms: { ...TERMS, firstInterestChargeDate: "2026-10-01" } }, { ...DAILY, chargeFrequency: "monthly", chargeDay: 1 });
    // 1,100 paid for the 30 Oct installment (it covers the 601.70 tracked since the opening), then an extra 5,000 on
    // 10 Nov: the projection restarts on 10 Nov.
    const first = transfer("2026-10-30", 1_100_00);
    const tracked = plan(m, [first, transfer("2026-11-10", 5_000_00)], "2026-11-12", { entries: [{ actualTransactionId: first.loan.id, actualAccountId: "loan", entryType: "principal-repayment", installmentDueDate: "2026-10-30", revision: 1, updatedAt: "x" }] });
    expect(tracked.installments[0].interestMinor).toBe(601_70);
    const balance = tracked.anchor.principalMinor + 5_000_00;
    const day = balance * 0.036 / 365;
    expect(tracked.anchor.restartDate).toBe("2026-11-10");
    // Charged on 1 Nov: 30 and 31 Oct. Still accruing: 1–9 Nov.
    expect(tracked.anchor.unpaidInterestMinor).toBe(Math.round(day * 2));
    expect(tracked.anchor.unpaidInterestMinor! + tracked.anchor.accruedInterestMinor).toBe(Math.round(day * 11));
    const nov = at(projection(m, tracked, "2026-12-31"), "2026-11-30");
    expect(-nov.cashMovementMinor).toBe(tracked.anchor.unpaidInterestMinor! + (nov.diagnostics.scheduledPrincipalMinor as number));
  });
});
