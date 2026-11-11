import type { SyncSourceTransaction } from "@/lib/actual/transport";
import type { LoanModelSnapshot } from "@/lib/financial-models/loan/model";
import { simulate } from "@/lib/financial-models/loan/projection";
import { SIMULATOR_DEFAULT_PROFILE } from "@/features/assets-debt/lib/simulatorModel";
import { planTracking, type TrackingInput } from "./plan";

/**
 * Tracking a loan whose interest is worked out per repayment period (design 06 §1.3): 500,000 at 5.4% (0.45% a month)
 * over 20 years, level payment 3,411.26.
 */
const PER_PERIOD = { ...SIMULATOR_DEFAULT_PROFILE, accrual: "per-period", chargeFrequency: "at-repayment", chargeDay: null, capitalization: "at-charge", rateQuote: "nominal-simple-periodic", repaymentDerivation: "annuity-at-payment-frequency", recast: "never" } as const;

function model(o: { opening?: string; first?: string; amortization?: LoanModelSnapshot["profile"]["amortization"] } = {}): LoanModelSnapshot {
  const opening = o.opening ?? "2024-01-15";
  return {
    debtId: "d1", revision: 1, currency: { code: "USD", minorDigits: 2 }, behaviorClass: "term-loan", lenderPattern: "embedded-interest",
    terms: { openingDate: opening, openingPrincipalMinor: 500_000_00, maturityDate: null, contractualTermMonths: 240, amortizationTermMonths: 240, contractualPaymentMinor: null, creditLimitMinor: null, firstPaymentDate: o.first ?? "2024-02-15", firstInterestChargeDate: null },
    profile: { ...PER_PERIOD, amortization: o.amortization ?? "level-payment", repaymentDerivation: o.amortization === "constant-principal" ? "contractual-fixed" : "annuity-at-payment-frequency" },
    rates: [{ accrualEffectiveFrom: opening, annualRateDecimal: "0.054" }],
    phases: [], offsets: [], components: [], paymentRecasts: [], assumptions: [], revolving: null,
  } as unknown as LoanModelSnapshot;
}

let seq = 0;
function tx(t: Partial<SyncSourceTransaction> & Pick<SyncSourceTransaction, "accountId" | "date" | "amount">): SyncSourceTransaction {
  return { id: `p${++seq}`, payeeId: null, payeeName: null, categoryId: null, categoryName: null, notes: null, cleared: true, reconciled: false, importedId: null, importedPayee: null, transferId: null, isParent: false, isChild: false, parentId: null, splitLines: [], ...t };
}
function transfer(date: string, amount: number) {
  const bank = tx({ accountId: "checking", date, amount: -amount, payeeId: "p-loan", payeeName: "Mortgage" });
  const loan = tx({ accountId: "loan", date, amount, payeeId: "p-checking", payeeName: "checking", transferId: bank.id });
  bank.transferId = loan.id;
  return { bank, loan };
}
function plan(m: LoanModelSnapshot, rows: ReturnType<typeof transfer>[], today: string, start: string) {
  const received = transfer(m.terms.openingDate, -m.terms.openingPrincipalMinor);
  const all = [received, ...rows];
  const input: TrackingInput = {
    debt: { id: "d1", budgetSyncId: "b1", liabilityAccountId: "loan", trackingStartDueDate: start, representation: "split", loanPaymentCategoryId: "cat-loan", interestCategoryId: "cat-interest", feeCategoryId: null, principalNoteSuffix: "", interestNoteSuffix: "#interest", toleranceMinor: 100, missingGraceDays: 5 },
    model: m, today, accounts: [{ id: "loan", name: "Mortgage", offBudget: true, closed: false }, { id: "checking", name: "Checking", offBudget: false, closed: false }],
    transferPayeeByAccount: { loan: "p-loan", checking: "p-checking" }, loanRows: all.map((r) => r.loan), bankRows: all.map((r) => r.bank), entries: [], rules: [],
  };
  const result = planTracking(input);
  if (!result.ok) throw new Error(result.message);
  return result;
}
const month = (balanceMinor: number) => Math.round(balanceMinor * 0.0045);

describe("tracking a per-period loan", () => {
  it("charges each installment on the tracked balance at the start of its period, and keeps a level payment", () => {
    const m = model();
    const level = 3_411_26;
    const without = plan(m, [transfer("2024-02-15", level), transfer("2024-03-15", level)], "2024-03-20", "2024-02-15");
    const withExtra = plan(m, [transfer("2024-02-15", level), transfer("2024-02-20", 20_000_00), transfer("2024-03-15", level)], "2024-03-20", "2024-02-15");
    const first = withExtra.installments[0];
    expect(first.interestMinor).toBe(2_250_00);
    // The period 15 Feb–15 Mar opened before the extra on 20 Feb, so installment 2's interest is unchanged...
    expect(withExtra.installments[1].interestMinor).toBe(without.installments[1].interestMinor);
    // ...and installment 3 (upcoming, 15 Apr) is the first on the lower balance: 20,000 × 0.45% = 90.00 less.
    expect(without.installments[2].interestMinor - withExtra.installments[2].interestMinor).toBe(90_00);
    // A level payment stays the payment in force.
    expect(withExtra.installments.map((i) => i.scheduledMinor).slice(0, 3)).toEqual([level, level, level]);
  });

  it("a late installment with an extra repayment before it: 30 Jan due, 31 Jan extra, 2 Feb paid", () => {
    const m = model({ opening: "2023-12-30", first: "2024-01-30" });
    const level = 3_411_26;
    const late = transfer("2024-02-02", level);
    const extra = transfer("2024-01-31", 10_000_00);
    const result = plan(m, [late, extra], "2024-02-10", "2024-01-30");

    // The late payment pays installment 1, keeps its own date, and its interest is the period's (on 500,000).
    const first = result.installments[0];
    expect(first).toMatchObject({ no: 1, dueDate: "2024-01-30", status: "unrecorded" });
    expect(first.payment).toMatchObject({ date: "2024-02-02", amountMinor: level });
    expect(first.interestMinor).toBe(2_250_00);
    const afterFirst = 500_000_00 - (level - 2_250_00);
    // The extra is extra principal on 31 Jan, counted once.
    expect(result.events).toEqual([expect.objectContaining({ kind: "extra-principal", date: "2024-01-31", amountMinor: 10_000_00 })]);
    expect(result.figures.calculatedMinor).toBe(afterFirst - 10_000_00);

    // The projection restarts at the contractual due date with the balance then; the extra is replayed on its own
    // date, and the late payment is not replayed.
    expect(result.anchor).toMatchObject({ date: "2024-02-02", restartDate: "2024-01-30", principalMinor: afterFirst, accruedInterestMinor: 0 });
    expect(result.anchor.events).toEqual([expect.objectContaining({ kind: "extra-repayment", date: "2024-01-31", amountMinor: 10_000_00 })]);

    const projected = simulate({ model: m, anchor: { date: result.anchor.restartDate, principalMinor: result.anchor.principalMinor, accruedInterestMinor: 0, scheduledPaymentMinor: result.anchor.scheduledPaymentMinor, source: "tracked" }, events: result.anchor.events, to: "2024-05-01" });
    if (!projected.ok) throw new Error(projected.blocked[0].message);
    const repayments = projected.events.filter((e) => e.type === "repayment");
    // 29 Feb: the period opened on 30 Jan before the extra, so interest is on the balance after installment 1.
    expect(repayments[0]).toMatchObject({ date: "2024-02-29", interestMinor: month(afterFirst), balanceBeforeMinor: afterFirst - 10_000_00 });
    // 30 Mar: the first period that opens after the extra.
    expect(repayments[1]).toMatchObject({ date: "2024-03-30", interestMinor: month(repayments[0].balanceAfterMinor) });
    // The projection and tracking agree on the upcoming installment.
    expect(result.installments.find((i) => i.no === 2)).toMatchObject({ status: "upcoming", interestMinor: repayments[0].interestMinor });
  });

  it("carries interest a short payment didn't cover to the next installment, and keeps the Check", () => {
    const m = model();
    const result = plan(m, [transfer("2024-02-15", 2_000_00), transfer("2024-03-15", 3_411_26)], "2024-03-20", "2024-02-15");
    expect(result.installments[0]).toMatchObject({ status: "check", checkKind: "short", interestMinor: 2_000_00, principalMinor: 0 });
    // Nothing was repaid, so period 2 opens on 500,000: 2,250.00 plus the 250.00 carried.
    expect(result.installments[1].interestMinor).toBe(2_500_00);
  });

  it("expects constant principal plus interest on the tracked balance after an extra repayment", () => {
    const m = model({ amortization: "constant-principal" });
    const principal = Math.round(500_000_00 / 240);
    const result = plan(m, [transfer("2024-02-15", principal + 2_250_00), transfer("2024-02-15", 50_000_00)], "2024-03-01", "2024-02-15");
    const next = result.installments.find((i) => i.no === 2)!;
    const balance = 500_000_00 - principal - 50_000_00;
    expect(next).toMatchObject({ status: "upcoming", scheduledMinor: principal + month(balance), interestMinor: month(balance), principalMinor: principal });
    expect(result.figures.nextPayment).toMatchObject({ no: 2, amountMinor: principal + month(balance) });
  });
});

describe("tracking a progressive principal loan (feedback #399)", () => {
  const fr = (over: Partial<LoanModelSnapshot> = {}, profile: Partial<LoanModelSnapshot["profile"]> = {}): LoanModelSnapshot => ({
    ...model({ opening: "2026-09-30", first: "2026-10-30" }),
    terms: { openingDate: "2026-09-30", openingPrincipalMinor: 203_353_10, maturityDate: null, contractualTermMonths: 276, amortizationTermMonths: 276, contractualPaymentMinor: null, creditLimitMinor: null, firstPaymentDate: "2026-10-30", firstInterestChargeDate: null },
    profile: { ...PER_PERIOD, amortization: "progressive-principal", rounding: { ...PER_PERIOD.rounding }, ...profile } as LoanModelSnapshot["profile"],
    rates: [{ accrualEffectiveFrom: "2026-09-30", annualRateDecimal: "0.036" }],
    progressive: { growthPerRepaymentDecimal: "0.0034592411" },
    ...over,
  });

  it("expects the bank's instalments, then contract principal plus lower interest after an extra repayment", () => {
    const m = fr();
    const result = plan(m, [transfer("2026-10-30", 1_051_44), transfer("2026-11-10", 10_000_00), transfer("2026-11-30", 1_051_65)], "2026-12-05", "2026-10-30");
    expect(result.installments.slice(0, 2).map((i) => [i.status, i.scheduledMinor, i.interestMinor, i.principalMinor])).toEqual([
      ["unrecorded", 1_051_44, 610_06, 441_38],
      // The period 30 Oct–30 Nov opened before the 10 Nov extra: same interest, same scheduled principal.
      ["unrecorded", 1_051_65, 608_74, 442_91],
    ]);
    // 30 Dec: scheduled principal 444.44 plus 0.3% of (202,468.81 − 10,000).
    expect(result.installments[2]).toMatchObject({ status: "upcoming", principalMinor: 444_44, interestMinor: 577_41, scheduledMinor: 1_021_85 });
    expect(result.figures.nextPayment).toMatchObject({ no: 3, amountMinor: 1_021_85 });
    // The projection restarts at 30 Nov with the extra inside the balance before it.
    expect(result.anchor).toMatchObject({ restartDate: "2026-11-30", principalMinor: 202_468_81 - 10_000_00, events: [] });
  });

  it("after a contract recast that follows the extra, expects and projects the lender's new, smaller series", () => {
    const m = fr({ paymentRecasts: [{ date: "2026-12-01" }] }, { recast: "on-contract-date" });
    const result = plan(m, [transfer("2026-10-30", 1_051_44), transfer("2026-11-10", 10_000_00), transfer("2026-11-30", 1_051_65), transfer("2026-12-30", 1_000_00)], "2027-01-05", "2026-10-30");
    const third = result.installments[2];
    // A new series from 192,468.81 over the 274 instalments left: a smaller principal than the contract's 444.44.
    expect(third.scheduledMinor - third.interestMinor).toBeLessThan(444_44);
    expect(result.anchor.progressiveBasis).toMatchObject({ startNo: 3 });
    const projected = simulate({ model: m, anchor: { date: result.anchor.restartDate, principalMinor: result.anchor.principalMinor, accruedInterestMinor: 0, progressiveBasis: result.anchor.progressiveBasis, source: "tracked" }, events: result.anchor.events, to: "2027-03-31" });
    if (!projected.ok) throw new Error(projected.blocked[0].message);
    const next = projected.events.find((e) => e.type === "repayment")!;
    expect(next.date).toBe("2027-01-30");
    expect(next.diagnostics).toMatchObject({ installmentNo: 4, progressiveBasis: "anchor" });
    expect(result.installments[3]).toMatchObject({ status: "upcoming", principalMinor: -next.principalMovementMinor, interestMinor: next.interestMinor });
  });
});

