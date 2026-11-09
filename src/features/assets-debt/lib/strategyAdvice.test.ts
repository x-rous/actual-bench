import { newSimulation, newTracking, statesToSaveInput, type SimAssumption, type SimulationState } from "./simulatorModel";
import { strategyAdvice } from "./strategyAdvice";

/** A per-period loan: 500,000 at 5.4% over 20 years, repaid on the 15th. */
function perPeriod(amortization: "level-payment" | "constant-principal", assumptions: SimAssumption[] = []): SimulationState {
  const s = newSimulation({ currency: "EUR", today: "2024-01-01" });
  return {
    ...s, principalMinor: 500_000_00, termMonths: 240, startDate: "2024-01-15", firstPaymentDate: "2024-02-15",
    rates: [{ ...s.rates[0], annualRateDecimal: "0.054", accrualEffectiveFrom: "2024-01-15" }],
    profile: { ...s.profile, amortization, accrual: "per-period", chargeFrequency: "at-repayment", chargeDay: null, capitalization: "at-charge", rateQuote: "nominal-simple-periodic", repaymentDerivation: amortization === "constant-principal" ? "contractual-fixed" : "annuity-at-payment-frequency", recast: "never" },
    assumptions,
  };
}
const whatIf = (kind: SimAssumption["kind"], effectiveFrom: string): SimAssumption => ({ key: `${kind}-${effectiveFrom}`, kind, effectiveFrom, recurrence: null, amountMinor: 10_000_00, feeTreatment: kind === "fee" ? "capitalized" : null, offsetAccountId: null, note: null });
const saves = (sim: SimulationState) => statesToSaveInput(sim, { ...newTracking(sim), name: "Loan" }, "budget", strategyAdvice(sim).recommended).ok;

describe("per-period eligibility (eligibility@2)", () => {
  it.each(["level-payment", "constant-principal"] as const)("%s: extra repayments on or between due dates keep the per-period engine and save", (amortization) => {
    for (const date of ["2026-01-15", "2026-01-20"]) {
      const sim = perPeriod(amortization, [whatIf("extra-repayment", date)]);
      expect(strategyAdvice(sim).recommended).toBe("bench-periodic");
      expect(saves(sim)).toBe(true);
    }
  });

  it.each(["level-payment", "constant-principal"] as const)("%s: a draw or fee on a due date is fine, between due dates it is refused with the reason", (amortization) => {
    expect(strategyAdvice(perPeriod(amortization, [whatIf("draw", "2026-01-15")])).recommended).toBe("bench-periodic");
    for (const kind of ["draw", "fee"] as const) {
      const advice = strategyAdvice(perPeriod(amortization, [whatIf(kind, "2026-01-20")]));
      expect(advice.recommended).toBeNull();
      expect(advice.lines.find((l) => l.strategy === "bench-periodic")?.reasons.join(" ")).toContain("2026-01-20 falls between repayment dates");
    }
  });

  it("leaves a loan without what-ifs on the per-period engine", () => {
    expect(strategyAdvice(perPeriod("level-payment")).recommended).toBe("bench-periodic");
  });
});
