import { simulateDaily } from "@/lib/financial-models/loan/daily-engine";
import type { LedgerEvent, ModelEvent, SimulationResult } from "@/lib/financial-models/loan/model";
import type { CalculationProfile } from "@/lib/financial-models/loan/profile";
import type { RatePeriod } from "@/lib/financial-models/loan/rates";
import { oracleEveryNDays, oracleMonthly, dailySchedule, type DailyRow, type DailySpec } from "@/test-oracles/rd084/schedules";
import { levelPayment, periodicRate } from "@/test-oracles/rd084/conventions";
import { qdiv, qmul, qs, roundHalfAwayScaled, q } from "@/test-oracles/rd084/rational";
import { BASE_PROFILE, model } from "./builders";

/*
 * bench-daily against the independent day-walking oracle (V3 §40.1 daily
 * cases, §40.2 derivation set, §40.3 precision set). Expected rows come from
 * src/test-oracles/rd084/schedules.ts, never from the engine.
 */

type Place = "before-accrual" | "after-accrual";
type DailyCase = {
  name: string;
  anchor: string;
  principal: string;
  convention?: DailySpec["convention"];
  rates: { from: string; annualRate: string }[];
  charge: { first: string; day: number; count: number } | "at-repayment";
  repayments: { first: string; every: "weekly" | "fortnightly" | "monthly"; amount: string; count?: number };
  until: string;
  events?: DailySpec["events"];
  offsets?: NonNullable<DailySpec["offsets"]>;
  order?: { scheduled: Place; other: Place; offsets: Place };
  compounded?: boolean;
  dayScale?: number | null;
  dayMode?: DailySpec["dayMode"];
  postingMode?: DailySpec["postingMode"];
  carry?: boolean;
  profile?: Partial<CalculationProfile>;
};

const P = (s: Place) => (s === "before-accrual" ? "before" : "after");

function dates(c: DailyCase): string[] {
  const r = c.repayments;
  const all = r.every === "monthly" ? oracleMonthly(r.first, r.count ?? 600) : oracleEveryNDays(r.first, r.every === "weekly" ? 7 : 14, c.until);
  return all.filter((d) => d <= c.until);
}

function oracleRows(c: DailyCase): DailyRow[] {
  const order = c.order ?? { scheduled: "before-accrual", other: "before-accrual", offsets: "before-accrual" };
  return dailySchedule({
    anchorDate: c.anchor,
    principal: c.principal,
    convention: c.convention ?? "actual-365-fixed",
    rates: c.rates,
    charges: c.charge === "at-repayment" ? "at-repayment" : oracleMonthly(c.charge.first, c.charge.count, c.charge.day).filter((d) => d <= c.until),
    scheduled: dates(c).map((date) => ({ date, amount: c.repayments.amount })),
    events: c.events,
    offsets: c.offsets,
    order: { scheduled: P(order.scheduled), other: P(order.other), offsets: P(order.offsets) },
    compounded: c.compounded,
    dayScale: c.dayScale === undefined ? null : c.dayScale,
    dayMode: c.dayMode ?? "half-up",
    postingMode: c.postingMode ?? "half-up",
    carry: c.carry,
    until: c.until,
  });
}

function engineRows(c: DailyCase): DailyRow[] | string {
  const cents = (s: string) => Number(roundHalfAwayScaled(qs(s), 2));
  const rates: RatePeriod[] = c.rates.map((r) => ({ accrualEffectiveFrom: r.from, annualRateDecimal: r.annualRate }));
  const m = model({
    principalMinor: cents(c.principal),
    openingDate: c.anchor,
    firstPaymentDate: c.repayments.first,
    contractualTermMonths: 360,
    contractualPaymentMinor: cents(c.repayments.amount),
    firstInterestChargeDate: c.charge === "at-repayment" ? null : c.charge.first,
    rates,
    offsets: (c.offsets ?? []).map((o, i) => ({ id: `o${i}`, accountId: o.account, effectiveFrom: o.from, effectiveTo: o.to ?? null, percentageBps: o.bps, basis: "total", capMinor: o.cap ? cents(o.cap) : null })),
    profile: {
      ...BASE_PROFILE,
      dayCount: c.convention ?? "actual-365-fixed",
      accrual: c.compounded ? "daily-compounded" : "daily-simple",
      capitalization: c.compounded ? "daily" : "at-charge",
      chargeFrequency: c.charge === "at-repayment" ? "at-repayment" : "monthly",
      chargeDay: c.charge === "at-repayment" ? null : c.charge.day,
      repaymentFrequency: c.repayments.every,
      repaymentDerivation: "contractual-fixed",
      eventOrder: c.order ? { scheduledRepayments: c.order.scheduled, otherPayments: c.order.other, offsets: c.order.offsets } : { timing: "start-of-day" },
      feeCapitalization: "permitted",
      ...c.profile,
      rounding: {
        ...BASE_PROFILE.rounding,
        intermediateScale: c.dayScale === undefined || c.dayScale === null ? { mode: "full" } : { mode: "fixed", places: c.dayScale },
        intermediateRounding: c.dayMode ?? "half-up",
        interestPostingRounding: c.postingMode ?? "half-up",
        balancePrecision: c.carry ? "carry-full-precision" : "round-each-posting",
        ...c.profile?.rounding,
      },
    },
  });
  const ledger: LedgerEvent[] = (c.events ?? []).map((e, i) => {
    const ref = { source: "actual" as const, id: `e${i}` };
    if (e.kind === "offset") return { kind: "offset-balance", date: e.date, accountId: e.account!, balanceMinor: cents(e.amount), clearedBalanceMinor: cents(e.amount) };
    if (e.kind === "extra") return { kind: "extra-repayment", date: e.date, amountMinor: cents(e.amount), ref };
    if (e.kind === "draw") return { kind: "draw", date: e.date, amountMinor: cents(e.amount), ref };
    return { kind: "fee", date: e.date, amountMinor: cents(e.amount), capitalized: true, ref };
  });
  const result: SimulationResult = simulateDaily({ model: m, anchor: { date: c.anchor, principalMinor: cents(c.principal), accruedInterestMinor: 0, source: "opening" }, events: ledger, to: c.until });
  if (!result.ok) return result.blocked.map((b) => `${b.code}: ${b.message}`).join("; ");
  return result.events.flatMap((e: ModelEvent): DailyRow[] => {
    if (e.type === "repayment" || e.type === "final-payment") {
      return [{ date: e.date, kind: c.charge === "at-repayment" ? `repayment+interest:${e.interestMinor}` : "repayment", amount: e.cashMovementMinor, balance: e.balanceAfterMinor }];
    }
    if (e.type === "interest-charge") return [{ date: e.date, kind: "interest-charge", amount: e.interestMinor, balance: e.balanceAfterMinor }];
    if (e.type === "extra-repayment" || e.type === "draw") return [{ date: e.date, kind: e.type, amount: e.cashMovementMinor, balance: e.balanceAfterMinor }];
    if (e.type === "fee") return [{ date: e.date, kind: "fee", amount: e.principalMovementMinor, balance: e.balanceAfterMinor }];
    return [];
  });
}

const AU = { anchor: "2024-01-15", principal: "400000.00", rates: [{ from: "2024-01-15", annualRate: "0.0612" }], charge: { first: "2024-02-15", day: 15, count: 24 } as const };

const CASES: DailyCase[] = [
  { name: "4 first partial accrual period", ...AU, anchor: "2024-01-20", charge: { first: "2024-02-01", day: 1, count: 12 }, repayments: { first: "2024-02-01", every: "monthly", amount: "2500.00" }, until: "2024-06-30" },
  { name: "5 Actual/365 Fixed across 29 February", ...AU, repayments: { first: "2024-01-29", every: "fortnightly", amount: "1200.00" }, until: "2024-04-30" },
  { name: "6 Actual/Actual across a year end into a leap year", ...AU, anchor: "2023-11-15", convention: "actual-actual-calendar", rates: [{ from: "2023-11-15", annualRate: "0.0612" }], charge: { first: "2023-12-15", day: 15, count: 12 }, repayments: { first: "2023-11-29", every: "fortnightly", amount: "1200.00" }, until: "2024-04-30" },
  { name: "7 Actual/360 over months of every length", ...AU, convention: "actual-360", charge: "at-repayment", repayments: { first: "2024-02-15", every: "monthly", amount: "2600.00" }, until: "2025-01-31", order: { scheduled: "after-accrual", other: "before-accrual", offsets: "before-accrual" } },
  { name: "11 mid-period rate change", ...AU, rates: [{ from: "2024-01-15", annualRate: "0.0612" }, { from: "2024-03-10", annualRate: "0.0662" }], repayments: { first: "2024-01-29", every: "fortnightly", amount: "1200.00" }, until: "2024-05-31" },
  { name: "14 start-of-day repayment", ...AU, repayments: { first: "2024-01-29", every: "fortnightly", amount: "1200.00" }, until: "2024-04-30", order: { scheduled: "before-accrual", other: "before-accrual", offsets: "before-accrual" } },
  { name: "15 end-of-day repayment", ...AU, repayments: { first: "2024-01-29", every: "fortnightly", amount: "1200.00" }, until: "2024-04-30", order: { scheduled: "after-accrual", other: "after-accrual", offsets: "after-accrual" } },
  { name: "16 daily accrual, monthly charge, monthly repayment", ...AU, repayments: { first: "2024-02-20", every: "monthly", amount: "2500.00" }, until: "2024-12-31" },
  { name: "17 daily accrual, weekly repayments", ...AU, repayments: { first: "2024-01-22", every: "weekly", amount: "600.00" }, until: "2024-04-30" },
  { name: "18 daily accrual, fortnightly repayments", ...AU, repayments: { first: "2024-01-29", every: "fortnightly", amount: "1200.00" }, until: "2024-12-31" },
  { name: "19 100% offset", ...AU, repayments: { first: "2024-01-29", every: "fortnightly", amount: "1200.00" }, until: "2024-04-30", offsets: [{ account: "o1", bps: 10000, from: "2024-01-15" }], events: [{ date: "2024-01-15", kind: "offset", account: "o1", amount: "50000.00" }, { date: "2024-03-01", kind: "offset", account: "o1", amount: "65000.00" }] },
  { name: "20 partial (40%) offset", ...AU, repayments: { first: "2024-01-29", every: "fortnightly", amount: "1200.00" }, until: "2024-04-30", offsets: [{ account: "o1", bps: 4000, from: "2024-01-15" }], events: [{ date: "2024-01-15", kind: "offset", account: "o1", amount: "50000.00" }] },
  { name: "21 multiple offsets, one ending", ...AU, repayments: { first: "2024-01-29", every: "fortnightly", amount: "1200.00" }, until: "2024-04-30", offsets: [{ account: "o1", bps: 10000, from: "2024-01-15" }, { account: "o2", bps: 10000, from: "2024-02-01", to: "2024-03-20" }], events: [{ date: "2024-01-15", kind: "offset", account: "o1", amount: "20000.00" }, { date: "2024-01-15", kind: "offset", account: "o2", amount: "15000.55" }, { date: "2024-02-20", kind: "offset", account: "o2", amount: "-300.00" }] },
  { name: "22 offset larger than the debt", ...AU, principal: "40000.00", repayments: { first: "2024-01-29", every: "fortnightly", amount: "300.00" }, until: "2024-04-30", offsets: [{ account: "o1", bps: 10000, from: "2024-01-15" }], events: [{ date: "2024-01-15", kind: "offset", account: "o1", amount: "90000.00" }] },
  { name: "23 capped offset", ...AU, repayments: { first: "2024-01-29", every: "fortnightly", amount: "1200.00" }, until: "2024-04-30", offsets: [{ account: "o1", bps: 10000, cap: "30000.00", from: "2024-01-15" }], events: [{ date: "2024-01-15", kind: "offset", account: "o1", amount: "50000.00" }] },
  { name: "25 lump sum between repayments", ...AU, repayments: { first: "2024-01-29", every: "fortnightly", amount: "1200.00" }, until: "2024-04-30", events: [{ date: "2024-03-06", kind: "extra", amount: "20000.00" }] },
  { name: "26 redraw between repayments", ...AU, repayments: { first: "2024-01-29", every: "fortnightly", amount: "1200.00" }, until: "2024-04-30", events: [{ date: "2024-03-06", kind: "draw", amount: "7500.00" }] },
  { name: "28 capitalized fee", ...AU, repayments: { first: "2024-01-29", every: "fortnightly", amount: "1200.00" }, until: "2024-04-30", events: [{ date: "2024-02-15", kind: "fee-capitalized", amount: "10.00" }, { date: "2024-03-15", kind: "fee-capitalized", amount: "10.00" }] },
  { name: "daily compounding (capitalized daily)", ...AU, repayments: { first: "2024-01-29", every: "fortnightly", amount: "1200.00" }, until: "2024-06-30", compounded: true },
  { name: "40.3 daily interest to 5 places, charge rounded half-up", ...AU, repayments: { first: "2024-01-29", every: "fortnightly", amount: "1200.00" }, until: "2024-12-31", dayScale: 5 },
  { name: "40.3 half-even posting", ...AU, repayments: { first: "2024-01-29", every: "fortnightly", amount: "1200.00" }, until: "2024-12-31", postingMode: "half-even" },
  { name: "40.3 truncated posting", ...AU, repayments: { first: "2024-01-29", every: "fortnightly", amount: "1200.00" }, until: "2024-12-31", postingMode: "down" },
  { name: "40.3 carry full precision", ...AU, repayments: { first: "2024-01-29", every: "fortnightly", amount: "1200.00" }, until: "2024-12-31", carry: true },
];

describe("bench-daily matches the independent oracle", () => {
  it.each(CASES.map((c) => [c.name, c] as const))("%s", (_name, c) => {
    expect(engineRows(c)).toEqual(oracleRows(c));
  });

  it("24 recurring extra repayment from an assumption equals the same dated events", () => {
    const base: DailyCase = { name: "", ...AU, repayments: { first: "2024-01-29", every: "fortnightly", amount: "1200.00" }, until: "2024-06-30" };
    const expanded: DailyCase = { ...base, events: oracleMonthly("2024-02-10", 5).map((date) => ({ date, kind: "extra" as const, amount: "500.00" })) };
    const cents = 50000;
    const viaAssumption = simulateDaily({
      model: model({
        principalMinor: 40000000, openingDate: AU.anchor, firstPaymentDate: "2024-01-29", contractualTermMonths: 360, contractualPaymentMinor: 120000, firstInterestChargeDate: "2024-02-15",
        rates: [{ accrualEffectiveFrom: AU.anchor, annualRateDecimal: "0.0612" }],
        assumptions: [{ kind: "extra-repayment", date: "2024-02-10", amountMinor: cents, recurrence: { frequency: "monthly", until: "2024-06-10" } }],
        profile: { accrual: "daily-simple", chargeFrequency: "monthly", chargeDay: 15, repaymentFrequency: "fortnightly", repaymentDerivation: "contractual-fixed" },
      }),
      anchor: { date: AU.anchor, principalMinor: 40000000, accruedInterestMinor: 0, source: "opening" },
      events: [],
      to: base.until,
    });
    const rows = viaAssumption.ok ? viaAssumption.events.filter((e) => e.type !== "rate-change").map((e) => [e.date, e.type, e.balanceAfterMinor]) : null;
    expect(rows?.filter((r) => r[1] === "extra-repayment").map((r) => r[0])).toEqual(["2024-02-10", "2024-03-10", "2024-04-10", "2024-05-10", "2024-06-10"]);
    expect(viaAssumption.ok && viaAssumption.events.filter((e) => e.type === "extra-repayment").every((e) => e.certainty === "assumed")).toBe(true);
    expect(rows?.at(-1)?.[2]).toBe(oracleRows(expanded).at(-1)!.balance);
  });

  it("40.3 long horizon: 30 years of daily interest match the oracle to the cent (loan still open)", () => {
    const long: DailyCase = { name: "", ...AU, charge: { first: "2024-02-15", day: 15, count: 361 }, repayments: { first: "2024-01-29", every: "fortnightly", amount: "1000.00" }, until: "2053-12-31", dayScale: 5 };
    const engine = engineRows(long);
    const oracle = oracleRows(long);
    expect(typeof engine === "string" ? engine : engine.length).toBe(oracle.length);
    expect(engine).toEqual(oracle);
  }, 120_000);
});

describe("Actual/360 in the Fannie Mae §1103 profile (cash schedule)", () => {
  // Payment at r/12 (the published 6.8134680% constant gives $141,947.25); interest on the days of the
  // month before each payment / 360; the repayment after that day's accrual; interest charged with it.
  function run(balancePrecision: "round-each-posting" | "carry-full-precision") {
    const m = model({
      principalMinor: 2500000000, openingDate: "2018-12-01", firstPaymentDate: "2019-01-01", contractualTermMonths: 120, amortizationTermMonths: 360,
      rates: [{ accrualEffectiveFrom: "2018-12-01", annualRateDecimal: "0.055" }],
      profile: {
        dayCount: "actual-360", accrual: "daily-simple", chargeFrequency: "at-repayment", repaymentFrequency: "monthly",
        eventOrder: { scheduledRepayments: "after-accrual", otherPayments: "before-accrual", offsets: "before-accrual" },
        finalPayment: "contractual-balloon",
        rounding: { ...BASE_PROFILE.rounding, balancePrecision },
      },
    });
    return simulateDaily({ model: m, anchor: { date: "2018-12-01", principalMinor: 2500000000, accruedInterestMinor: 0, source: "issue" }, events: [], to: "2029-01-01" });
  }

  it("derives the $141,947.25 payment from r/12, not a 365/360-bumped rate", () => {
    const expected = Number(roundHalfAwayScaled(levelPayment("25000000", periodicRate("0.055", 12, 12, 40), 360).payment, 2));
    const r = run("round-each-posting");
    expect(expected).toBe(14194725);
    expect(r.ok && r.events.find((e) => e.type === "repayment")?.cashMovementMinor).toBe(-expected);
  });

  it.each([
    ["round-each-posting", 411449410],
    ["carry-full-precision", 411449411],
  ] as const)("%s: cash aggregate principal over 120 payments is the oracle's (not the published theoretical 4,114,494.17)", (mode, expected) => {
    const r = run(mode);
    if (!r.ok) throw new Error(r.blocked[0].message);
    const principal = r.events.filter((e) => e.type === "repayment" || e.type === "final-payment").reduce((s, e) => s - e.principalMovementMinor, 0);
    expect(principal).toBe(expected);
    const balloon = r.events.find((e) => e.type === "balloon");
    expect(balloon?.balanceBeforeMinor).toBe(2500000000 - expected);
  });
});

describe("§40.2 repayment derivation on real fortnightly dates", () => {
  // $500,000 at 6%, 25 years: the monthly base is the annuity at r/12 over 300 months, rounded to cents.
  const monthly = roundHalfAwayScaled(levelPayment("500000", qdiv(qs("0.06"), q(12)), 300).payment, 2);
  const fortnightlyAnnuity = roundHalfAwayScaled(levelPayment("500000", qdiv(qs("0.06"), q(26)), 650).payment, 2);
  it.each([
    ["monthly-equivalent-pro-rata", Number(roundHalfAwayScaled(qdiv(qmul(q(monthly, 100), q(12)), q(26)), 2))],
    ["split-monthly", Number(roundHalfAwayScaled(qdiv(q(monthly, 100), q(2)), 2))],
    ["annuity-at-payment-frequency", Number(fortnightlyAnnuity)],
  ] as const)("%s", (derivation, expectedMinor) => {
    const m = model({
      principalMinor: 50000000, openingDate: "2024-01-15", firstPaymentDate: "2024-01-29", contractualTermMonths: 300, firstInterestChargeDate: "2024-02-15",
      rates: [{ accrualEffectiveFrom: "2024-01-15", annualRateDecimal: "0.06" }],
      profile: { accrual: "daily-simple", chargeFrequency: "monthly", chargeDay: 15, repaymentFrequency: "fortnightly", repaymentDerivation: derivation },
    });
    const r = simulateDaily({ model: m, anchor: { date: "2024-01-15", principalMinor: 50000000, accruedInterestMinor: 0, source: "opening" }, events: [], to: "2024-03-31" });
    const repayments = r.ok ? r.events.filter((e) => e.type === "repayment") : [];
    expect(repayments.map((e) => e.cashMovementMinor)).toEqual(repayments.map(() => -expectedMinor));
    // Real dates: every 14 days, straight through 29 February.
    expect(repayments.map((e) => e.date)).toEqual(["2024-01-29", "2024-02-12", "2024-02-26", "2024-03-11", "2024-03-25"]);
  });
});
