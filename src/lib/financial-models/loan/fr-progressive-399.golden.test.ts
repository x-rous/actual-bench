import type { LoanModelSnapshot, ModelEvent } from "./model";
import { simulate } from "./projection";
import { levelPayment, progressiveFirstPrincipal, solveProgressiveGrowth } from "./repayment";
import { dec, toMinor } from "../money/kernel";

/**
 * Feedback #399: a French mortgage whose principal repaid grows by a fixed share each month (progressive principal).
 * 203,353.10 owed after instalment 025, 3.6% a year charged at 0.3% a month on the balance, 276 instalments left
 * (026 on 30 Oct 2026 to 301 on 30 Sep 2049). Bench numbers this remaining loan's instalments from 1, so the bank's
 * instalment N is Bench's N − 25.
 */
const GROWTH = "0.0034592411";

function model(over: Partial<LoanModelSnapshot> = {}, profile: Partial<LoanModelSnapshot["profile"]> = {}): LoanModelSnapshot {
  return {
    debtId: "fr399", revision: 1, currency: { code: "EUR", minorDigits: 2 }, behaviorClass: "term-loan", lenderPattern: "embedded-interest",
    terms: { openingDate: "2026-09-30", openingPrincipalMinor: 203_353_10, maturityDate: null, contractualTermMonths: 276, amortizationTermMonths: 276, contractualPaymentMinor: null, creditLimitMinor: null, firstPaymentDate: "2026-10-30", firstInterestChargeDate: null },
    profile: {
      amortization: "progressive-principal", rateQuote: "nominal-simple-periodic", dayCount: "actual-365-fixed", accrual: "per-period", chargeFrequency: "at-repayment", chargeDay: null,
      capitalization: "at-charge", repaymentFrequency: "monthly", repaymentDerivation: "annuity-at-payment-frequency", recast: "never", rateEffectiveTiming: "from-next-charge-period",
      repaymentEffectiveTiming: "transaction-date",
      rounding: { paymentRounding: "half-up", interestPostingRounding: "half-up", intermediateScale: { mode: "full" }, intermediateRounding: "half-even", balancePrecision: "round-each-posting" },
      eventOrder: { timing: "start-of-day" }, finalPayment: "true-up-to-zero", shortMonth: "clamp-to-last-calendar-day", negativeAmortizationAllowed: false,
      interestOnlyRepayment: "charged-interest-outstanding", presetId: null, ...profile,
    },
    rates: [{ accrualEffectiveFrom: "2026-09-30", annualRateDecimal: "0.036" }],
    phases: [], offsets: [], components: [], paymentRecasts: [], assumptions: [], revolving: null,
    progressive: { growthPerRepaymentDecimal: GROWTH },
    ...over,
  } as LoanModelSnapshot;
}

function run(m: LoanModelSnapshot, events: { date: string; amountMinor: number }[] = []): ModelEvent[] {
  const result = simulate({
    model: m,
    anchor: { date: m.terms.openingDate, principalMinor: m.terms.openingPrincipalMinor, accruedInterestMinor: 0, source: "opening" },
    events: events.map((e, i) => ({ kind: "extra-repayment" as const, date: e.date, amountMinor: e.amountMinor, ref: { source: "actual" as const, id: `x${i}` } })),
    to: "2049-12-31",
  });
  if (!result.ok) throw new Error(result.blocked[0].message);
  return result.events;
}
const instalments = (events: ModelEvent[]) => events.filter((e) => e.type === "repayment" || e.type === "final-payment");
const row = (events: ModelEvent[], bankNo: number) => instalments(events)[bankNo - 26];
const figures = (e: ModelEvent) => ({ interest: e.interestMinor, principal: -e.principalMovementMinor, payment: -e.cashMovementMinor, balance: e.balanceAfterMinor });

/** The bank's rows: [instalment, due date, interest, principal, payment, balance after], minor units. */
const BANK: [number, string, number, number, number, number][] = [
  [26, "2026-10-30", 610_06, 441_38, 1_051_44, 202_911_72],
  [27, "2026-11-30", 608_74, 442_91, 1_051_65, 202_468_81],
  [28, "2026-12-30", 607_41, 444_44, 1_051_85, 202_024_37],
  [29, "2027-01-30", 606_07, 445_99, 1_052_06, 201_578_38],
  [30, "2027-02-28", 604_74, 447_53, 1_052_27, 201_130_85],
  [31, "2027-03-30", 603_39, 449_08, 1_052_47, 200_681_77],
  [32, "2027-04-30", 602_05, 450_62, 1_052_67, 200_231_15],
  [33, "2027-05-30", 600_69, 452_20, 1_052_89, 199_778_95],
  [297, "2049-05-30", 16_99, 1_125_23, 1_142_22, 4_538_60],
  [298, "2049-06-30", 13_62, 1_129_12, 1_142_74, 3_409_48],
  [299, "2049-07-30", 10_23, 1_133_02, 1_143_25, 2_276_46],
  [300, "2049-08-30", 6_83, 1_136_94, 1_143_77, 1_139_52],
];

describe("feedback #399: French progressive principal mortgage", () => {
  const events = run(model());

  it("works the growth out from one row of the bank's table", () => {
    expect(solveProgressiveGrowth(203_353_10, 441_38, 276, 2)).toEqual({ ok: true, growthDecimal: GROWTH });
    expect(solveProgressiveGrowth(203_353_10, 736_79, 276, 2)).toEqual({ ok: true, growthDecimal: "0" });
    expect(solveProgressiveGrowth(203_353_10, 800_00, 276, 2)).toEqual({ ok: false, reason: "shrinking" });
    expect(solveProgressiveGrowth(203_353_10, 1, 276, 2)).toEqual({ ok: false, reason: "too-fast" });
  });

  it("reproduces rows 026–028 to the cent", () => {
    for (const [no, date, interest, principal, payment, balance] of BANK.slice(0, 3)) {
      expect(row(events, no).date).toBe(date);
      expect(figures(row(events, no))).toEqual({ interest, principal, payment, balance });
    }
  });

  // The bank's consecutive principal ratios vary between 1.003429 and 1.003506, so its intermediate rounding is not one
  // exact geometric series; no exact series can match every row. Early rows stay within 0.02, late balances within 2.00.
  it("stays within the documented tolerances on rows 026–033 and 297–300", () => {
    for (const [no, date, , principal, , balance] of BANK.slice(0, 8)) {
      const e = row(events, no);
      expect(e.date).toBe(date);
      expect(Math.abs(figures(e).principal - principal)).toBeLessThanOrEqual(2);
      expect(Math.abs(e.balanceAfterMinor - balance)).toBeLessThanOrEqual(10);
    }
    for (const [no, date, , , , balance] of BANK.slice(8)) {
      const e = row(events, no);
      expect(e.date).toBe(date);
      expect(Math.abs(e.balanceAfterMinor - balance)).toBeLessThanOrEqual(2_00);
    }
  });

  it("clears the loan with the final instalment on 30 Sep 2049", () => {
    const last = instalments(events).at(-1)!;
    expect(instalments(events)).toHaveLength(276);
    expect(last).toMatchObject({ date: "2049-09-30", type: "final-payment", balanceAfterMinor: 0 });
  });

  it("reduces to constant principal at zero growth, and to the level annuity when growth equals the monthly rate", () => {
    expect(toMinor(progressiveFirstPrincipal(dec("203353.10"), dec("0"), 276), 2, "half-up")).toBe(736_79);
    const asAnnuity = instalments(run(model({ progressive: { growthPerRepaymentDecimal: "0.003" } }))).slice(0, -1);
    const level = toMinor(levelPayment(dec("203353.10"), dec("0.003"), 276), 2, "half-up");
    expect(level).toBe(1_084_48);
    for (const e of asAnnuity) expect(Math.abs(-e.cashMovementMinor - level)).toBeLessThanOrEqual(1);
  });

  it("V1: an extra 10,000 on 30 Jan 2027 keeps the principal series and ends the loan sooner", () => {
    const v1 = run(model(), [{ date: "2027-01-30", amountMinor: 10_000_00 }]);
    expect(figures(row(v1, 30))).toMatchObject({ principal: 447_52, interest: 574_74, payment: 1_022_26 });
    expect(instalments(v1).at(-1)).toMatchObject({ date: "2049-01-30", balanceAfterMinor: 0 });
    expect(v1.filter((e) => e.type === "recast")).toEqual([]);
  });

  it("V2: the same extra, then a contract recast dated 31 Jan 2027, starts a new series at instalment 030 (28 Feb 2027)", () => {
    const v2 = run(model({ paymentRecasts: [{ date: "2027-01-31" }] }, { recast: "on-contract-date" }), [{ date: "2027-01-30", amountMinor: 10_000_00 }]);
    expect(row(v2, 30)).toMatchObject({ date: "2027-02-28" });
    expect(figures(row(v2, 30)).principal).toBe(425_32);
    expect(v2.find((e) => e.type === "recast")).toMatchObject({ date: "2027-02-28", diagnostics: expect.objectContaining({ reasons: "contract-date", progressiveBasisStartNo: 5 }) });
    expect(instalments(v2).at(-1)).toMatchObject({ date: "2049-09-30", balanceAfterMinor: 0 });
  });

  it("V3: a recast dated 30 Jan 2027 applies to instalment 029, on the balance before that day's payments", () => {
    const v3 = run(model({ paymentRecasts: [{ date: "2027-01-30" }] }, { recast: "on-contract-date" }), [{ date: "2027-01-30", amountMinor: 10_000_00 }]);
    expect(v3.find((e) => e.type === "recast")).toMatchObject({ date: "2027-01-30", balanceBeforeMinor: row(events, 28).balanceAfterMinor });
    // Nothing had changed before it, so the new series is the old one; the extra after it still shortens the loan.
    expect(figures(row(v3, 29)).principal).toBe(figures(row(events, 29)).principal);
    expect(instalments(v3).at(-1)!.date < "2049-09-30").toBe(true);
  });

  it("V4: an extra 10,000 on 15 Feb 2027, between due dates, lowers interest from instalment 031", () => {
    const v4 = run(model(), [{ date: "2027-02-15", amountMinor: 10_000_00 }]);
    expect(row(v4, 30).interestMinor).toBe(row(events, 30).interestMinor);
    expect(row(events, 31).interestMinor - row(v4, 31).interestMinor).toBe(30_00);
    expect(figures(row(v4, 31)).principal).toBe(figures(row(events, 31)).principal);
  });

  it("V5: a rate change from the next period changes interest only", () => {
    const v5 = run(model({ rates: [{ accrualEffectiveFrom: "2026-09-30", annualRateDecimal: "0.036" }, { accrualEffectiveFrom: "2027-03-15", annualRateDecimal: "0.042" }] }));
    for (const no of [30, 31, 32, 33]) expect(figures(row(v5, no)).principal).toBe(figures(row(events, no)).principal);
    expect(row(v5, 32).interestMinor).toBeGreaterThan(row(events, 32).interestMinor);
    expect(row(v5, 31).interestMinor).toBe(row(events, 31).interestMinor);
  });
});

describe("progressive principal with daily interest (bench-daily)", () => {
  const perPeriod = instalments(run(model()));
  const daily = (profile: Partial<LoanModelSnapshot["profile"]>, over: Partial<LoanModelSnapshot> = {}) =>
    instalments(run(model(over, { accrual: "daily-simple", dayCount: "actual-365-fixed", rateEffectiveTiming: "on-accrual-effective-date", ...profile })));

  it("repays the same principal series; only the interest follows the days", () => {
    const rows = daily({});
    for (let i = 0; i < 12; i++) expect(-rows[i].principalMovementMinor).toBe(-perPeriod[i].principalMovementMinor);
    // 28 Feb 2027 closes a 29-day period: less interest than the flat 0.3% a month.
    expect(rows[4].interestMinor).toBeLessThan(perPeriod[4].interestMinor);
    expect(rows).toHaveLength(276);
    expect(rows.at(-1)).toMatchObject({ date: "2049-09-30", balanceAfterMinor: 0 });
  });

  it("with interest charged on its own day, an instalment pays what was charged since the previous one plus its principal", () => {
    const result = simulate({ model: model({ terms: { ...model().terms, firstInterestChargeDate: "2026-10-01" } }, { accrual: "daily-simple", chargeFrequency: "monthly", chargeDay: 1, rateEffectiveTiming: "on-accrual-effective-date" }), anchor: { date: "2026-09-30", principalMinor: 203_353_10, accruedInterestMinor: 0, source: "opening" }, events: [], to: "2027-03-31" });
    if (!result.ok) throw new Error(result.blocked[0].message);
    const charges = result.events.filter((e) => e.type === "interest-charge");
    const repayments = result.events.filter((e) => e.type === "repayment");
    const charged = charges.filter((c) => c.date > repayments[1].date && c.date <= repayments[2].date).reduce((sum, c) => sum + c.interestMinor, 0);
    expect(-repayments[2].cashMovementMinor).toBe(charged + 444_44);
  });

  it("an offset lowers the interest and leaves the principal series alone", () => {
    const withOffset = simulate({
      model: model({ offsets: [{ id: "o", accountId: "savings", effectiveFrom: "2026-09-30", effectiveTo: null, percentageBps: 10_000, basis: "total", capMinor: null }] }, { accrual: "daily-simple", rateEffectiveTiming: "on-accrual-effective-date" }),
      anchor: { date: "2026-09-30", principalMinor: 203_353_10, accruedInterestMinor: 0, source: "opening" },
      events: [{ kind: "offset-balance", date: "2026-09-30", accountId: "savings", balanceMinor: 20_000_00, clearedBalanceMinor: 20_000_00 }],
      to: "2027-06-30",
    });
    if (!withOffset.ok) throw new Error(withOffset.blocked[0].message);
    const rows = withOffset.events.filter((e) => e.type === "repayment");
    const plain = daily({});
    for (let i = 0; i < 6; i++) {
      expect(-rows[i].principalMovementMinor).toBe(-plain[i].principalMovementMinor);
      expect(rows[i].interestMinor).toBeLessThan(plain[i].interestMinor);
    }
  });
});
