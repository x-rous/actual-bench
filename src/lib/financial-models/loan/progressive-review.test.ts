import type { Anchor, LedgerEvent, LoanModelSnapshot } from "./model";
import { simulate } from "./projection";
import { simulateDaily } from "./daily-engine";
import { solveProgressiveGrowth } from "./repayment";

/**
 * Edge cases of per-period and progressive principal loans found in review. The loan is the French mortgage of
 * feedback #399: 203,353.10 at 3.6% over 276 months, principal growing 0.34592411% per repayment.
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

function loan(over: Partial<LoanModelSnapshot> = {}, profile: Record<string, unknown> = {}): LoanModelSnapshot {
  return {
    debtId: "fr", revision: 1, currency: { code: "EUR", minorDigits: 2 }, behaviorClass: "term-loan", lenderPattern: "embedded-interest",
    terms: TERMS, profile: { ...PROFILE, ...profile }, rates: [{ accrualEffectiveFrom: "2026-09-30", annualRateDecimal: "0.036" }],
    phases: [], offsets: [], components: [], paymentRecasts: [], assumptions: [], revolving: null,
    progressive: { growthPerRepaymentDecimal: "0.0034592411" }, ...over,
  } as LoanModelSnapshot;
}
const level = (over: Partial<LoanModelSnapshot> = {}) => loan({ progressive: null, ...over }, { amortization: "level-payment" });
const extra = (date: string, amountMinor: number): LedgerEvent => ({ kind: "extra-repayment", date, amountMinor, ref: { source: "actual", id: `x-${date}` } });

function run(m: LoanModelSnapshot, events: LedgerEvent[] = [], to = "2027-06-30", anchor: Partial<Anchor> = {}) {
  const r = simulate({ model: m, anchor: { date: m.terms.openingDate, principalMinor: m.terms.openingPrincipalMinor, accruedInterestMinor: 0, source: "opening", ...anchor }, events, to });
  if (!r.ok) throw new Error(r.blocked.map((b) => b.message).join("; "));
  return r.events;
}
const repayments = (events: ReturnType<typeof run>) => events.filter((e) => e.type === "repayment" || e.type === "final-payment");
const principalOf = (e: ReturnType<typeof run>[number]) => -e.principalMovementMinor;

describe("per-period engine between repayment dates", () => {
  it("still charges the period's interest when an extra repayment clears the principal between due dates", () => {
    const small = loan({ terms: { ...TERMS, openingPrincipalMinor: 2_000_00, contractualTermMonths: 12, amortizationTermMonths: 12 } });
    const first = repayments(run(small))[0];
    expect(first.balanceAfterMinor).toBe(1_836_48);
    const events = run(small, [extra("2026-11-15", 1_836_48)]);
    const last = events.at(-1)!;
    // The period 30 Oct–30 Nov opened on 1,836.48, so its interest (1,836.48 × 0.3% = 5.51) is still due on 30 Nov.
    expect(last).toMatchObject({ date: "2026-11-30", type: "final-payment", interestMinor: 5_51, cashMovementMinor: -5_51, balanceAfterMinor: 0 });
  });

  it("works out a level payment from the period's opening balance, not one lowered by an extra repayment before the due date", () => {
    const without = repayments(run(level())).slice(0, 2).map((e) => -e.cashMovementMinor);
    const before = repayments(run(level(), [extra("2026-10-10", 50_000_00)])).slice(0, 2).map((e) => -e.cashMovementMinor);
    const onDue = repayments(run(level(), [extra("2026-10-30", 50_000_00)])).slice(0, 2).map((e) => -e.cashMovementMinor);
    expect(without).toEqual([1_084_48, 1_084_48]);
    expect(before).toEqual(without);
    expect(onDue).toEqual(without);
  });
});

describe("progressive principal basis at a contract recast date", () => {
  const recast = (profile: Record<string, unknown> = {}) => loan({ paymentRecasts: [{ date: "2027-01-31" }] }, { recast: "on-contract-date", ...profile });

  it("starts the new series from the balance at the start of the recast day, whatever is paid after it (per-period)", () => {
    // Recast on 31 Jan; an extra 10,000 on 10 Feb comes after the start of that day, so it never resizes the series.
    const plain = repayments(run(recast()));
    const withExtra = repayments(run(recast(), [extra("2027-02-10", 10_000_00)]));
    const feb = (rows: typeof plain) => rows.find((e) => e.date === "2027-02-28")!;
    expect(feb(withExtra).diagnostics.scheduledPrincipalMinor).toBe(feb(plain).diagnostics.scheduledPrincipalMinor);
    expect(principalOf(feb(withExtra))).toBe(principalOf(feb(plain)));
  });

  it("counts an extra repayment made before the recast day in the new series (per-period)", () => {
    const plain = repayments(run(recast()));
    const before = repayments(run(recast(), [extra("2027-01-20", 10_000_00)]));
    const feb = (rows: typeof plain) => rows.find((e) => e.date === "2027-02-28")!;
    expect(principalOf(feb(before))).toBeLessThan(principalOf(feb(plain)));
  });

  it("starts the series after an interest-only phase from the balance at the end of the phase (per-period)", () => {
    const io = (events: LedgerEvent[] = []) => repayments(run(loan({ phases: [{ kind: "interest-only", from: "2026-09-30", to: "2026-11-30", recastAtEnd: "never" }] }), events));
    const plain = io();
    // The phase ends on 30 Nov; an extra on 10 Dec is after it, so the series that starts on 30 Dec is unchanged.
    const after = io([extra("2026-12-10", 10_000_00)]);
    const dec30 = (rows: typeof plain) => rows.find((e) => e.date === "2026-12-30")!;
    expect(principalOf(dec30(after))).toBe(principalOf(dec30(plain)));
  });

  it("agrees between the per-period and daily engines", () => {
    const daily = { accrual: "daily-simple", rateEffectiveTiming: "on-accrual-effective-date" };
    const shift = (rows: ReturnType<typeof repayments>) => principalOf(rows.find((e) => e.date === "2027-02-28")!);
    const perPeriodDelta = shift(repayments(run(recast(), [extra("2027-02-10", 10_000_00)]))) - shift(repayments(run(recast())));
    const dailyDelta = shift(repayments(run(recast(daily), [extra("2027-02-10", 10_000_00)]))) - shift(repayments(run(recast(daily))));
    expect(perPeriodDelta).toBe(0);
    expect(dailyDelta).toBe(0);
  });
});

describe("daily interest charged on its own day, resumed between the charge and the repayment", () => {
  const daily = loan({ terms: { ...TERMS, firstInterestChargeDate: "2026-10-01" } }, { accrual: "daily-simple", chargeFrequency: "monthly", chargeDay: 1, rateEffectiveTiming: "on-accrual-effective-date" });

  it("still collects the interest charged before the restart with the next repayment", () => {
    const one = repayments(run(daily, [], "2026-12-31"));
    const first = simulateDaily({ model: daily, anchor: { date: "2026-09-30", principalMinor: 203_353_10, accruedInterestMinor: 0, source: "opening" }, events: [], to: "2026-11-05" });
    if (!first.ok) throw new Error("first run");
    const charged = first.events.filter((e) => e.type === "interest-charge" && e.date === "2026-11-01")[0].interestMinor;
    const second = simulateDaily({
      model: daily,
      anchor: { date: "2026-11-05", principalMinor: first.closing.principalMinor - charged, unpaidInterestMinor: charged, accruedInterestExact: first.closing.accruedInterestExact, carriedRemainder: first.closing.carriedRemainder, accruedInterestMinor: null, source: "resume" },
      events: [], to: "2026-12-31",
    });
    if (!second.ok) throw new Error("second run");
    const resumed = second.events.filter((e) => e.type === "repayment");
    const nov = one.find((e) => e.date === "2026-11-30")!;
    expect(resumed[0].date).toBe("2026-11-30");
    expect(resumed[0].cashMovementMinor).toBe(nov.cashMovementMinor);
    expect(resumed[0].balanceAfterMinor).toBe(nov.balanceAfterMinor);
  });
});

describe("solving the growth from a lender's row", () => {
  it("accepts a row whose principal rounds to the 5% limit", () => {
    // 100.00 over 2 at exactly 5%: the first principal is 48.780487…, which a lender shows as 48.78.
    expect(solveProgressiveGrowth(100_00, 48_78, 2, 2)).toEqual({ ok: true, growthDecimal: "0.05" });
    expect(solveProgressiveGrowth(100_00, 48_77, 2, 2)).toEqual({ ok: false, reason: "too-fast" });
  });
});
