import { simulatePeriodic } from "@/lib/financial-models/loan/periodic-engine";
import type { ModelEvent, SimulationResult } from "@/lib/financial-models/loan/model";
import { oracleMonthly, periodicSchedule, type PeriodicRow, type PeriodicSpec } from "@/test-oracles/rd084/schedules";
import { model, ledger, type ModelOverrides } from "./builders";

/*
 * bench-periodic against the independent oracle (V3 §40.1 periodic cases,
 * §40.3 rounding set) and against published anchors. Expected rows come from
 * src/test-oracles/rd084/schedules.ts or the cited publication, never from
 * the engine.
 */

const OPEN = "2024-01-01";
const FIRST = "2024-02-01";

function rowsOf(result: SimulationResult): PeriodicRow[] {
  if (!result.ok) throw new Error(result.blocked.map((b) => `${b.code}: ${b.message}`).join("; "));
  return result.events
    .filter((e: ModelEvent) => e.type === "repayment" || e.type === "final-payment")
    .map((e, i) => ({
      n: i + 1,
      payment: -e.cashMovementMinor,
      interest: e.interestMinor,
      principal: -e.cashMovementMinor - e.feesMinor - e.interestMinor,
      fee: e.feesMinor,
      balance: e.balanceAfterMinor,
    }));
}

type Case = {
  name: string;
  engine: ModelOverrides & { to?: string; events?: ReturnType<typeof ledger>[] };
  oracle: PeriodicSpec;
};

const std = (o: Partial<ModelOverrides> = {}): ModelOverrides => ({
  principalMinor: 20000000,
  openingDate: OPEN,
  firstPaymentDate: FIRST,
  contractualTermMonths: 360,
  rates: [{ accrualEffectiveFrom: OPEN, annualRateDecimal: "0.06" }],
  ...o,
});
const stdOracle = (o: Partial<PeriodicSpec> = {}): PeriodicSpec => ({
  principal: "200000",
  annualRate: "0.06",
  paymentsPerYear: 12,
  compoundsPerYear: 12,
  contractPayments: 360,
  amortizationPayments: 360,
  paymentRounding: "half-up",
  interestRounding: "half-up",
  finalPolicy: "true-up-to-zero",
  ...o,
});
const monthsLater = (n: number) => oracleMonthly(FIRST, n)[n - 1];

const CASES: Case[] = [
  { name: "1 zero-rate loan", engine: std({ principalMinor: 1200000, contractualTermMonths: 36, rates: [{ accrualEffectiveFrom: OPEN, annualRateDecimal: "0" }] }), oracle: stdOracle({ principal: "12000", annualRate: "0", contractPayments: 36, amortizationPayments: 36 }) },
  { name: "2 standard fixed monthly level payment ($200,000, 6%, 30 years)", engine: std(), oracle: stdOracle() },
  { name: "3 constant principal", engine: std({ principalMinor: 12000000, contractualTermMonths: 120, profile: { amortization: "constant-principal", repaymentDerivation: "contractual-fixed" } }), oracle: stdOracle({ principal: "120000", contractPayments: 120, amortizationPayments: 120, constantPrincipal: true }) },
  { name: "10 semiannual quoted rate (Canadian j2, 25 years)", engine: std({ principalMinor: 10000000, contractualTermMonths: 300, profile: { rateQuote: "nominal-compounded-semiannual" } }), oracle: stdOracle({ principal: "100000", compoundsPerYear: 2, contractPayments: 300, amortizationPayments: 300 }) },
  {
    name: "12 delayed payment change after a rate change",
    // 6.5% accrues from payment 25's period; the payment changes only at payment 27.
    engine: std({ profile: { recast: "on-rate-change" }, rates: [{ accrualEffectiveFrom: OPEN, annualRateDecimal: "0.06" }, { accrualEffectiveFrom: monthsLater(24), annualRateDecimal: "0.065", paymentEffectiveFrom: monthsLater(27) }] }),
    oracle: stdOracle({ rateChanges: [{ payment: 25, annualRate: "0.065", recast: false }], recastAt: [27] }),
  },
  {
    name: "dated recast: the rate changes at payment 25, the payment only at the contract's recast date (payment 31)",
    engine: std({ profile: { recast: "on-contract-date" }, rates: [{ accrualEffectiveFrom: OPEN, annualRateDecimal: "0.06" }, { accrualEffectiveFrom: monthsLater(24), annualRateDecimal: "0.07" }], paymentRecasts: [{ date: monthsLater(31) }] }),
    oracle: stdOracle({ rateChanges: [{ payment: 25, annualRate: "0.07", recast: false }], recastAt: [31] }),
  },
  {
    name: "dated recast alongside on-rate-change: recasts at the rate change (payment 25) and again at payment 40",
    engine: std({ profile: { recast: "on-rate-change" }, rates: [{ accrualEffectiveFrom: OPEN, annualRateDecimal: "0.06" }, { accrualEffectiveFrom: monthsLater(24), annualRateDecimal: "0.055" }], paymentRecasts: [{ date: monthsLater(40) }] }),
    oracle: stdOracle({ rateChanges: [{ payment: 25, annualRate: "0.055", recast: true }], recastAt: [40] }),
  },
  {
    name: "29 interest-only phase then recast over the rest",
    engine: std({ phases: [{ kind: "interest-only", from: FIRST, to: monthsLater(60), recastAtEnd: "on-rate-change" }] }),
    oracle: stdOracle({ interestOnlyPayments: 60 }),
  },
  { name: "whole-term interest-only (one phase, balloon)", engine: std({ contractualTermMonths: 120, amortizationTermMonths: 360, phases: [{ kind: "interest-only", from: FIRST, to: monthsLater(120), recastAtEnd: "never" }], profile: { finalPayment: "contractual-balloon" } }), oracle: stdOracle({ contractPayments: 120, interestOnlyPayments: 120, finalPolicy: "contractual-balloon" }) },
  { name: "32 balloon: 10-year term on 30-year amortization", engine: std({ contractualTermMonths: 120, amortizationTermMonths: 360, profile: { finalPayment: "contractual-balloon" } }), oracle: stdOracle({ contractPayments: 120, finalPolicy: "contractual-balloon" }) },
  { name: "33 true-up final payment", engine: std({ principalMinor: 1000000, contractualTermMonths: 60 }), oracle: stdOracle({ principal: "10000", contractPayments: 60, amortizationPayments: 60 }) },
  { name: "34 residual final balance (keep level payment)", engine: std({ contractualTermMonths: 120, amortizationTermMonths: 360, profile: { finalPayment: "keep-level-payment-with-residual" } }), oracle: stdOracle({ contractPayments: 120, finalPolicy: "keep-level-payment-with-residual" }) },
  { name: "35 principal residual rounding: payment rounded up finishes early", engine: std({ principalMinor: 5000, contractualTermMonths: 360, profile: { rounding: { paymentRounding: "up" } as never } }), oracle: stdOracle({ principal: "50", paymentRounding: "up" }) },
  { name: "fixed payment continues until paid (smaller final payment)", engine: std({ principalMinor: 300000, contractualTermMonths: 120, contractualPaymentMinor: 3000, profile: { repaymentDerivation: "contractual-fixed", finalPayment: "continue-until-paid" } }), oracle: stdOracle({ principal: "3000", contractPayments: 120, fixedPayment: "30.00", finalPolicy: "continue-until-paid" }) },
  { name: "40.3 half-even payment and interest", engine: std({ profile: { rounding: { paymentRounding: "half-even", interestPostingRounding: "half-even" } as never } }), oracle: stdOracle({ paymentRounding: "half-even", interestRounding: "half-even" }) },
  { name: "40.3 truncating interest", engine: std({ profile: { rounding: { interestPostingRounding: "down" } as never } }), oracle: stdOracle({ interestRounding: "down" }) },
  { name: "40.3 zero-decimal currency (unit 1)", engine: std({ principalMinor: 30000000, digits: 0 }), oracle: stdOracle({ principal: "30000000", digits: 0 }) },
  // ¥30,000,000 at 1% truncated: month 1 interest is exactly ¥25,000. A periodic rate rounded before
  // multiplying gave ¥24,999 (found by the mortgagemath LoanKeisan cross-check).
  { name: "40.3 whole-unit interest truncated (JPY, 1%)", engine: std({ principalMinor: 30000000, digits: 0, rates: [{ accrualEffectiveFrom: OPEN, annualRateDecimal: "0.01" }], profile: { rounding: { paymentRounding: "down", interestPostingRounding: "down" } as never } }), oracle: stdOracle({ principal: "30000000", annualRate: "0.01", digits: 0, paymentRounding: "down", interestRounding: "down" }) },
  { name: "40.3 carry full precision", engine: std({ profile: { rounding: { balancePrecision: "carry-full-precision" } as never } }), oracle: stdOracle({ carry: true }) },
  {
    name: "annual recast with yearly rate changes",
    engine: std({ profile: { recast: "annual" }, rates: [0, 1, 2].map((y) => ({ accrualEffectiveFrom: y === 0 ? OPEN : monthsLater(12 * y), annualRateDecimal: ["0.06", "0.07", "0.055"][y] })) }),
    oracle: stdOracle({ annualRecast: true, rateChanges: [{ payment: 13, annualRate: "0.07", recast: true }, { payment: 25, annualRate: "0.055", recast: true }] }),
  },
];

// The profile patches above spread a partial rounding; complete them against the base.
for (const c of CASES) {
  if (c.engine.profile?.rounding) c.engine.profile.rounding = { ...{ paymentRounding: "half-up", interestPostingRounding: "half-up", intermediateScale: { mode: "full" }, intermediateRounding: "half-even", balancePrecision: "round-each-posting" }, ...c.engine.profile.rounding };
}

describe("bench-periodic matches the independent oracle", () => {
  it.each(CASES.map((c) => [c.name, c] as const))("%s", (_name, c) => {
    const m = model(c.engine);
    const to = c.engine.to ?? "2080-01-01";
    const result = simulatePeriodic({ model: m, anchor: { date: OPEN, principalMinor: m.terms.openingPrincipalMinor, accruedInterestMinor: 0, source: "opening" }, events: c.engine.events ?? [], to });
    const oracle = periodicSchedule(c.oracle);
    expect(rowsOf(result)).toEqual(oracle.rows);
    const balloon = result.ok ? result.events.filter((e) => e.type === "balloon").reduce((s, e) => s - e.cashMovementMinor, 0) : NaN;
    const residual = result.ok ? result.events.filter((e) => e.type === "residual").reduce((s, e) => s + Number(e.diagnostics.residualMinor), 0) : NaN;
    expect({ balloon, residual }).toEqual({ balloon: oracle.balloon, residual: oracle.residual });
  });
});

describe("bench-periodic blocks what it cannot represent", () => {
  it("31 negative amortization is blocked (review) when the profile does not permit it", () => {
    const m = model(std({ principalMinor: 6500000, rates: [{ accrualEffectiveFrom: OPEN, annualRateDecimal: "0.10" }, { accrualEffectiveFrom: monthsLater(12), annualRateDecimal: "0.12", paymentEffectiveFrom: monthsLater(13), paymentCap: { kind: "previous-payment-factor", factor: "1.075" } }], profile: { recast: "on-rate-change" } }));
    const r = simulatePeriodic({ model: m, anchor: { date: OPEN, principalMinor: 6500000, accruedInterestMinor: 0, source: "opening" }, events: [], to: monthsLater(24) });
    expect(r.ok ? null : r.blocked[0]).toMatchObject({ code: "negative-amortization", classification: "review", date: monthsLater(13) });
    expect(periodicSchedule({ ...stdOracle({ principal: "65000", annualRate: "0.10" }), rateChanges: [{ payment: 13, annualRate: "0.12", recast: true, capFactor: "1.075" }] }).blockedAt).toBe(13);
  });

  it("13 a missing rate period blocks with rate-gap", () => {
    const m = model(std({ rates: [{ accrualEffectiveFrom: "2024-03-01", annualRateDecimal: "0.06" }] }));
    const r = simulatePeriodic({ model: m, anchor: { date: OPEN, principalMinor: 20000000, accruedInterestMinor: 0, source: "opening" }, events: [], to: "2024-12-01" });
    expect(r.ok ? null : r.blocked[0].code).toBe("rate-gap");
  });

  it.each([
    ["an irregular first period", std(), "2024-01-15", [], "irregular-first-period"],
    ["a rate change inside a period", std({ rates: [{ accrualEffectiveFrom: OPEN, annualRateDecimal: "0.06" }, { accrualEffectiveFrom: "2024-03-10", annualRateDecimal: "0.07" }] }), OPEN, [], "mid-period-rate-change"],
    ["an event between payment dates", std(), OPEN, [ledger("extra-repayment", "2024-03-10", 100000)], "irregular-event"],
    ["offsets", std({ offsets: [{ id: "o", accountId: "a", effectiveFrom: OPEN, effectiveTo: null, percentageBps: 10000, basis: "total", capMinor: null }] }), OPEN, [], "offsets-need-daily-engine"],
  ] as const)("refuses %s rather than approximating", (_n, o, anchorDate, events, code) => {
    const r = simulatePeriodic({ model: model(o), anchor: { date: anchorDate, principalMinor: 20000000, accruedInterestMinor: 0, source: "x" }, events: [...events], to: "2025-01-01" });
    expect(r.ok ? null : r.blocked[0].code).toBe(code);
  });

  it("36 an extra repayment larger than the balance needs review, never a credit", () => {
    const m = model(std({ principalMinor: 100000, contractualTermMonths: 12 }));
    const r = simulatePeriodic({ model: m, anchor: { date: OPEN, principalMinor: 100000, accruedInterestMinor: 0, source: "x" }, events: [ledger("extra-repayment", FIRST, 500000)], to: "2025-01-01" });
    expect(r.ok ? null : r.blocked[0]).toMatchObject({ code: "credit-balance", classification: "review" });
  });
});

describe("bench-periodic against published anchors", () => {
  it("MoneyVox: €10,000 at 5% over 12 months with €2.92 insurance, all 48 published cells", () => {
    const m = model({
      principalMinor: 1000000, openingDate: OPEN, firstPaymentDate: FIRST, contractualTermMonths: 12,
      rates: [{ accrualEffectiveFrom: OPEN, annualRateDecimal: "0.05" }],
      components: [{ economicKind: "insurance", label: "Assurance", destination: "category", categoryId: "c", amountRule: "fixed", fixedAmountMinor: 292, treatment: "cash-paid", order: 1 }],
    });
    const rows = rowsOf(simulatePeriodic({ model: m, anchor: { date: OPEN, principalMinor: 1000000, accruedInterestMinor: 0, source: "opening" }, events: [], to: "2025-01-01" }));
    const published = [
      [4167, 81440, 85899, 918560], [3827, 81780, 85899, 836780], [3487, 82120, 85899, 754660], [3144, 82463, 85899, 672197],
      [2801, 82806, 85899, 589391], [2456, 83151, 85899, 506240], [2109, 83498, 85899, 422742], [1761, 83846, 85899, 338896],
      [1412, 84195, 85899, 254701], [1061, 84546, 85899, 170155], [709, 84898, 85899, 85257], [355, 85257, 85904, 0],
    ];
    expect(rows.map((r) => [r.interest, r.principal, r.payment, r.balance])).toEqual(published);
    expect(rows.every((r) => r.fee === 292)).toBe(true);
  });

  it("ProEducate payment cap: all six printed figures ($570.42; $64,638.72; $667.30 uncapped; $613.20; $65,059.62; $420.90)", () => {
    const m = model(std({
      principalMinor: 6500000,
      rates: [{ accrualEffectiveFrom: OPEN, annualRateDecimal: "0.10" }, { accrualEffectiveFrom: monthsLater(12), annualRateDecimal: "0.12", paymentEffectiveFrom: monthsLater(13), paymentCap: { kind: "previous-payment-factor", factor: "1.075" } }],
      profile: { recast: "on-rate-change", negativeAmortizationAllowed: true },
    }));
    const r = simulatePeriodic({ model: m, anchor: { date: OPEN, principalMinor: 6500000, accruedInterestMinor: 0, source: "opening" }, events: [], to: monthsLater(24) });
    const rows = rowsOf(r);
    const recast = r.ok ? r.events.find((e) => e.type === "recast") : undefined;
    expect([rows[0].payment, rows[11].balance, recast?.diagnostics.recalculatedPaymentMinor, rows[12].payment, rows[23].balance, rows[23].balance - rows[11].balance]).toEqual([57042, 6463872, 66730, 61320, 6505962, 42090]);
    expect(recast?.diagnostics).toMatchObject({ capped: true, capMaxMinor: 61320 });
    // Negative amortization is explicit, never a "principal repayment".
    expect(r.ok && r.events.filter((e) => e.type === "negative-amortization")).toHaveLength(12);
    expect(rows[12].principal).toBeLessThan(0);
  });

  it("Reg Z H-14 (narrowed): annual recast reproduces all 15 published balances", () => {
    const rates = ["0.1741", "0.1541", "0.1517", "0.1317", "0.1241"];
    const m = model(std({
      principalMinor: 1000000,
      rates: rates.map((rate, y) => ({ accrualEffectiveFrom: y === 0 ? OPEN : monthsLater(12 * y), annualRateDecimal: rate })),
      profile: { recast: "annual" },
    }));
    const rows = rowsOf(simulatePeriodic({ model: m, anchor: { date: OPEN, principalMinor: 1000000, accruedInterestMinor: 0, source: "opening" }, events: [], to: monthsLater(180) }));
    const published = [998937, 996966, 994551, 990370, 984894, 978698, 971688, 963756, 954783, 944629, 933156, 920161, 905472, 888852, 870037];
    expect(published.map((_, y) => rows[12 * y + 11].balance)).toEqual(published);
    // The documented gap: H-14 prints 106.73 in 1992, 1994 and 1995 where the arithmetic gives 106.72.
    expect([10, 12, 13].map((y) => rows[12 * y].payment)).toEqual([10672, 10672, 10672]);
  });

  it("York University j2: $100,000 at 6% semi-annual, 25 years: $639.81", () => {
    const m = model(std({ principalMinor: 10000000, contractualTermMonths: 300, profile: { rateQuote: "nominal-compounded-semiannual" } }));
    const rows = rowsOf(simulatePeriodic({ model: m, anchor: { date: OPEN, principalMinor: 10000000, accruedInterestMinor: 0, source: "opening" }, events: [], to: monthsLater(2) }));
    expect(rows[0].payment).toBe(63981);
  });
});
