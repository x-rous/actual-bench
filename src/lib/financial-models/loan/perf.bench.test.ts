import type { FutureAssumption, LoanModelSnapshot } from "./model";
import { projectDebt } from "./projection";
import type { CalculationProfile } from "./profile";

/*
 * P1.3b T199: how long the pure engine takes for the loan simulator's worst realistic cases.
 * Skipped in the normal run; `RD084_BENCH=1 npx jest perf.bench` prints cold and warm p50/p95.
 * The simulator recalculates on the main thread only if these fit the P1.3b budget (plan.md).
 */

const OPEN = "2024-01-01";
const bench = process.env.RD084_BENCH === "1" ? describe : describe.skip;

const PERIODIC: CalculationProfile = {
  amortization: "level-payment", rateQuote: "nominal-simple-periodic", dayCount: "actual-365-fixed", accrual: "per-period",
  chargeFrequency: "at-repayment", chargeDay: null, capitalization: "at-charge", repaymentFrequency: "monthly",
  repaymentDerivation: "annuity-at-payment-frequency", recast: "on-rate-change", rateEffectiveTiming: "on-accrual-effective-date",
  repaymentEffectiveTiming: "transaction-date",
  rounding: { paymentRounding: "half-up", interestPostingRounding: "half-up", intermediateScale: { mode: "full" }, intermediateRounding: "half-even", balancePrecision: "round-each-posting" },
  eventOrder: { timing: "start-of-day" }, finalPayment: "true-up-to-zero", shortMonth: "clamp-to-last-calendar-day",
  negativeAmortizationAllowed: false, interestOnlyRepayment: "charged-interest-outstanding", presetId: null,
};
const DAILY: Partial<CalculationProfile> = { accrual: "daily-simple", chargeFrequency: "monthly", chargeDay: 1 };

function loan(profile: Partial<CalculationProfile>, extra: Partial<LoanModelSnapshot> = {}): LoanModelSnapshot {
  return {
    debtId: "bench", revision: 0, currency: { code: "AUD", minorDigits: 2 }, behaviorClass: "term-loan", lenderPattern: null,
    terms: { openingDate: OPEN, openingPrincipalMinor: 60_000_000, maturityDate: null, contractualTermMonths: 360, amortizationTermMonths: 360, contractualPaymentMinor: null, creditLimitMinor: null, firstPaymentDate: "2024-02-01", firstInterestChargeDate: null },
    profile: { ...PERIODIC, ...profile }, rates: [{ accrualEffectiveFrom: OPEN, annualRateDecimal: "0.0612" }],
    phases: [], offsets: [], components: [], paymentRecasts: [], assumptions: [], revolving: null, ...extra,
  };
}

const offsets: LoanModelSnapshot["offsets"] = [{ id: "o", accountId: "acc", effectiveFrom: OPEN, effectiveTo: null, percentageBps: 10_000, basis: "total", capMinor: null }];
const offsetSteps: FutureAssumption[] = Array.from({ length: 360 }, (_, i) => ({ kind: "offset-balance", date: `${2024 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}-15`, accountId: "acc", balanceMinor: 2_000_000 + i * 50_000 }));
const sixRates = ["0.0612", "0.0655", "0.0590", "0.0520", "0.0610", "0.0580"].map((r, i) => ({ accrualEffectiveFrom: `${2024 + i * 4}-0${i === 0 ? 1 : 3}-${i === 0 ? "01" : "17"}`, annualRateDecimal: r }));
const extras: FutureAssumption = { kind: "extra-repayment", date: "2024-03-10", amountMinor: 50_000, recurrence: { frequency: "monthly", until: "2040-12-10" } };
const fortnightly = { ...DAILY, repaymentFrequency: "fortnightly" as const };

export const BENCH_SCENARIOS: [string, LoanModelSnapshot][] = [
  ["30y periodic monthly (five-input default)", loan({})],
  ["30y daily, monthly repayments", loan(DAILY)],
  ["30y daily, weekly repayments", loan({ ...DAILY, repaymentFrequency: "weekly" })],
  ["30y daily, fortnightly repayments", loan(fortnightly)],
  ["30y daily fortnightly + offset (360 balance steps)", loan(fortnightly, { offsets, assumptions: offsetSteps })],
  ["30y daily fortnightly + offset + monthly extras + 6 rate changes (worst case)", loan(fortnightly, { offsets, rates: sixRates, assumptions: [...offsetSteps, extras] })],
];

const project = (m: LoanModelSnapshot) =>
  projectDebt({ model: m, anchor: { date: OPEN, principalMinor: m.terms.openingPrincipalMinor, accruedInterestMinor: 0, source: "opening" }, events: [], from: OPEN, to: "2054-06-30" });

const pct = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor((p / 100) * xs.length))];

bench("engine timing for the simulator (T199)", () => {
  it("prints cold and warm p50/p95 per scenario, plus the simulate-and-compare pair", () => {
    const rows: string[] = [];
    for (const [name, m] of BENCH_SCENARIOS) {
      const t0 = performance.now();
      const first = project(m);
      const cold = performance.now() - t0;
      if (!first.ok) throw new Error(`${name}: ${first.blocked.map((b) => b.message).join("; ")}`);
      const warm: number[] = [];
      for (let i = 0; i < 20; i++) {
        const t = performance.now();
        project(m);
        warm.push(performance.now() - t);
      }
      rows.push(`${name}: cold ${cold.toFixed(0)} ms; warm p50 ${pct(warm, 50).toFixed(0)} ms, p95 ${pct(warm, 95).toFixed(0)} ms; ${first.events.length} events`);
    }
    const worst = BENCH_SCENARIOS.at(-1)![1];
    const pair: number[] = [];
    for (let i = 0; i < 20; i++) {
      const t = performance.now();
      project(worst);
      project({ ...worst, rates: worst.rates.slice(0, 1) });
      pair.push(performance.now() - t);
    }
    rows.push(`simulate + compare (worst case pair): p50 ${pct(pair, 50).toFixed(0)} ms, p95 ${pct(pair, 95).toFixed(0)} ms`);
    console.log(rows.join("\n"));
  });
});
