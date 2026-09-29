import { simulate } from "@/lib/financial-models/loan/projection";
import type { ModelEvent, SimulationResult } from "@/lib/financial-models/loan/model";
import { CURRENT_COMPONENT_VERSIONS as ENGINE_VERSIONS } from "@/lib/financial-models/loan/versions";
import { model, type ModelOverrides } from "./builders";

/*
 * Offset and rate diagnostics (P1.3b T200; owner decisions O2, O4). They explain what the engine
 * did and never change it:
 *   offsetAppliedMinor   = min(max(0, eligible offset), max(0, debt)), rounded down
 *   interestBearingMinor = the base the day's accrual used, rounded down
 *   effectiveAnnualRateDecimal = the rate the event date's accrual used
 *   interestRatesDecimal = the rates behind the event's interest (";"-joined)
 */

const OPEN = "2024-01-01";
const DAILY = { accrual: "daily-simple" as const, chargeFrequency: "monthly" as const, chargeDay: 1, dayCount: "actual-365-fixed" as const };

function run(o: Partial<ModelOverrides>, to = "2024-12-31"): ModelEvent[] {
  const m = model({ principalMinor: 40_000_000, openingDate: OPEN, firstPaymentDate: "2024-02-01", contractualTermMonths: 360, rates: [{ accrualEffectiveFrom: OPEN, annualRateDecimal: "0.06" }], ...o });
  const r: SimulationResult = simulate({ model: m, anchor: { date: OPEN, principalMinor: m.terms.openingPrincipalMinor, accruedInterestMinor: 0, source: "opening" }, events: [], to });
  if (!r.ok) throw new Error(r.blocked.map((b) => b.message).join("; "));
  return r.events;
}

const offsetLink = (patch: Record<string, unknown> = {}) => ({ id: "o", accountId: "acc-o", effectiveFrom: OPEN, effectiveTo: null, percentageBps: 10_000, basis: "total" as const, capMinor: null, ...patch });
const offsetBalance = (balanceMinor: number, date = OPEN) => ({ kind: "offset-balance" as const, date, accountId: "acc-o", balanceMinor });
const charges = (events: ModelEvent[]) => events.filter((e) => e.type === "interest-charge");

describe("offset diagnostics (O4)", () => {
  it("are absent without offsets, while the rate is always reported", () => {
    const events = run({ profile: DAILY });
    const diagnosed = events.filter((e) => e.type === "repayment" || e.type === "interest-charge");
    expect(diagnosed.length).toBeGreaterThan(10);
    for (const e of diagnosed) {
      expect(e.diagnostics).not.toHaveProperty("offsetAppliedMinor");
      expect(e.diagnostics.effectiveAnnualRateDecimal).toBe("0.06");
    }
  });

  it("report the applied offset and the interest-bearing base the charge accrued on", () => {
    const events = run({ profile: DAILY, offsets: [offsetLink()], assumptions: [offsetBalance(5_000_000)] });
    for (const e of charges(events)) {
      expect(e.diagnostics.offsetAppliedMinor).toBe(5_000_000);
      // Start-of-day order: the charge day's accrual saw the debt before the charge.
      expect(e.diagnostics.interestBearingMinor).toBe(e.balanceBeforeMinor - 5_000_000);
    }
  });

  it("an offset larger than the debt is capped at the debt and never makes the base negative", () => {
    const events = run({ principalMinor: 1_000_000, profile: DAILY, offsets: [offsetLink()], assumptions: [offsetBalance(5_000_000)] }, "2024-06-30");
    const first = charges(events)[0];
    expect(first.diagnostics.offsetAppliedMinor).toBe(first.balanceBeforeMinor);
    expect(first.diagnostics.interestBearingMinor).toBe(0);
    expect(first.interestMinor).toBe(0);
  });

  it("apply the percentage and the cap exactly as the engine does", () => {
    const events = run({ profile: DAILY, offsets: [offsetLink({ percentageBps: 5_000, capMinor: 10_000_000 })], assumptions: [offsetBalance(30_000_000)] });
    for (const e of charges(events)) expect(e.diagnostics.offsetAppliedMinor).toBe(10_000_000);
    const uncapped = run({ profile: DAILY, offsets: [offsetLink({ percentageBps: 2_550 })], assumptions: [offsetBalance(1_000_001)] });
    // 25.5% of 10,000.01 is 2,550.00255: the display value rounds down; the accrual keeps the exact amount.
    expect(charges(uncapped)[0].diagnostics.offsetAppliedMinor).toBe(255_000);
  });

  it("do not change any calculated amount", () => {
    const withOffset = run({ profile: DAILY, offsets: [offsetLink()], assumptions: [offsetBalance(5_000_000)] });
    const strip = (es: ModelEvent[]) => es.map(({ diagnostics: _d, ...rest }) => rest);
    const again = run({ profile: DAILY, offsets: [offsetLink()], assumptions: [offsetBalance(5_000_000)] });
    expect(strip(withOffset)).toEqual(strip(again));
    // Interest with a 5,000 offset is less than without, by the engine's own arithmetic.
    const without = run({ profile: DAILY });
    expect(charges(withOffset)[0].interestMinor).toBeLessThan(charges(without)[0].interestMinor);
  });

  it("under daily compounding, the base includes the accrued interest the engine compounds", () => {
    const events = run({ profile: { accrual: "daily-compounded", capitalization: "daily", chargeFrequency: "monthly", chargeDay: 1, dayCount: "actual-365-fixed" }, offsets: [offsetLink()], assumptions: [offsetBalance(5_000_000)] });
    for (const e of charges(events)) {
      expect(e.diagnostics.offsetAppliedMinor).toBe(5_000_000);
      expect(Number(e.diagnostics.interestBearingMinor)).toBeGreaterThanOrEqual(e.balanceBeforeMinor - 5_000_000);
    }
  });

  it("the daily engine version records the new outputs", () => {
    expect(ENGINE_VERSIONS["loan-daily"]).toBe("loan-daily@2");
    expect(ENGINE_VERSIONS["loan-periodic"]).toBe("loan-periodic@2");
  });
});

describe("rate diagnostics (O2)", () => {
  const rates = (change: string, timing?: "from-next-charge-period") =>
    run({ profile: { ...DAILY, ...(timing ? { rateEffectiveTiming: timing } : {}) }, rates: [{ accrualEffectiveFrom: OPEN, annualRateDecimal: "0.06" }, { accrualEffectiveFrom: change, annualRateDecimal: "0.07" }] }, "2024-06-30");
  const chargeOn = (events: ModelEvent[], date: string) => events.find((e) => e.type === "interest-charge" && e.date === date)!;

  it("one rate: every charge accrued at that rate", () => {
    for (const e of charges(run({ profile: DAILY }, "2024-06-30"))) expect(e.diagnostics.interestRatesDecimal).toBe("0.06");
  });

  it("a change at a charge boundary: each charge used one rate", () => {
    const events = rates("2024-03-02");
    expect(chargeOn(events, "2024-03-01").diagnostics.interestRatesDecimal).toBe("0.06");
    expect(chargeOn(events, "2024-04-01").diagnostics.interestRatesDecimal).toBe("0.07");
  });

  it("a mid-period change: the charge covering it lists both rates, in order", () => {
    const events = rates("2024-03-15");
    expect(chargeOn(events, "2024-04-01").diagnostics.interestRatesDecimal).toBe("0.06;0.07");
    expect(chargeOn(events, "2024-04-01").diagnostics.effectiveAnnualRateDecimal).toBe("0.07");
  });

  it("from-next-charge-period: the new rate starts with the next charge period, as the engine applied it", () => {
    const events = rates("2024-03-15", "from-next-charge-period");
    expect(chargeOn(events, "2024-04-01").diagnostics.interestRatesDecimal).toBe("0.06");
    expect(chargeOn(events, "2024-05-01").diagnostics.interestRatesDecimal).toBe("0.07");
  });

  it("the periodic engine reports the period rate on each repayment", () => {
    const events = run({ rates: [{ accrualEffectiveFrom: OPEN, annualRateDecimal: "0.06" }, { accrualEffectiveFrom: "2024-06-01", annualRateDecimal: "0.065" }] }, "2024-12-31");
    const repayments = events.filter((e) => e.type === "repayment");
    expect(repayments[0].diagnostics).toMatchObject({ effectiveAnnualRateDecimal: "0.06", interestRatesDecimal: "0.06" });
    expect(repayments.at(-1)!.diagnostics).toMatchObject({ effectiveAnnualRateDecimal: "0.065", interestRatesDecimal: "0.065" });
  });
});
