import { describeOutlook, headline } from "./results";
import type { SimulationState } from "./simulatorModel";
import { project, sim } from "./simulatorTestKit";

const perPeriod = (amortization: SimulationState["profile"]["amortization"], patch: Partial<SimulationState> = {}) => {
  const s = sim();
  return { ...s, principalMinor: 203_353_10, termMonths: 276, startDate: "2026-09-30", rates: [{ ...s.rates[0], annualRateDecimal: "0.036", accrualEffectiveFrom: "2026-09-30" }], profile: { ...s.profile, amortization, accrual: "per-period" as const, recast: "never" as const, repaymentDerivation: amortization === "constant-principal" ? "contractual-fixed" as const : "annuity-at-payment-frequency" as const }, ...patch };
};
const head = (s: SimulationState) => {
  const p = project(s);
  if (!p.ok) throw new Error(p.blocked[0].message);
  return headline(p.events);
};
const words = (s: SimulationState) => describeOutlook(head(s).outlook, (m) => (m / 100).toFixed(2));

describe("repayment headline for repayments that vary", () => {
  it("keeps a level payment as it is", () => {
    const h = head(perPeriod("level-payment"));
    expect(h.outlook?.kind).toBe("level");
    expect(h.regularRepaymentMinor).toBe(1_084_48);
    expect(describeOutlook(h.outlook, String)).toBeNull();
  });

  it("shows a progressive loan's next repayment and what it rises to", () => {
    const h = head(perPeriod("progressive-principal", { progressiveGrowthDecimal: "0.0034592411" }));
    expect(h.regularRepaymentMinor).toBe(1_051_44);
    expect(words(perPeriod("progressive-principal", { progressiveGrowthDecimal: "0.0034592411" }))).toEqual({ next: "on 30 Oct 2026", pattern: "Rising to 1143.78 by Aug 2049" });
  });

  it("says falling for constant principal", () => {
    expect(words(perPeriod("constant-principal"))?.pattern).toMatch(/^Falling to .* by Aug 2049$/);
  });

  it("says future repayments vary when they rise and fall", () => {
    const s = perPeriod("progressive-principal", {
      progressiveGrowthDecimal: "0.0034592411",
      rates: [{ ...sim().rates[0], annualRateDecimal: "0.036", accrualEffectiveFrom: "2026-09-30" }, { ...sim().rates[0], key: "r2", annualRateDecimal: "0.08", accrualEffectiveFrom: "2030-09-30" }, { ...sim().rates[0], key: "r3", annualRateDecimal: "0.01", accrualEffectiveFrom: "2035-09-30" }],
      profile: { ...perPeriod("progressive-principal").profile, rateEffectiveTiming: "from-next-charge-period" },
    });
    expect(words(s)?.pattern).toBe("Future repayments vary");
  });
});
