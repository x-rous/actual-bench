import { projectDebt, type DebtProjection } from "@/lib/financial-models/loan/projection";
import { newSimulation, projectionWindow, simKey, simulationToModel, type SimulationState } from "./simulatorModel";

/** Test support for the simulator (P1.3b): fixture loans and a synchronous projection. Never imported by production code. */

export function sim(patch: Partial<SimulationState> = {}, ratePercent = "0.06"): SimulationState {
  const base = newSimulation({ currency: "AUD", today: "2024-01-01" });
  base.principalMinor = 40_000_000;
  base.termMonths = 360;
  base.rates[0].annualRateDecimal = ratePercent;
  return { ...base, ...patch };
}

export const DAILY_MONTHLY_CHARGE = { accrual: "daily-simple" as const, chargeFrequency: "monthly" as const, chargeDay: 1 };

export function project(s: SimulationState, to?: string): DebtProjection {
  const built = simulationToModel(s);
  if (!built.ok) throw new Error(`missing: ${built.missing.join(", ")}`);
  const window = projectionWindow(s);
  const { model } = built;
  return projectDebt({ model, anchor: { date: model.terms.openingDate, principalMinor: model.terms.openingPrincipalMinor, accruedInterestMinor: 0, source: "opening" }, events: [], from: window.from, to: to ?? window.to });
}

export const offsetOf = (balanceMinor: number) => {
  const key = simKey("offset");
  return {
    offsets: [{ key, placeholderAccountId: key, effectiveFrom: "2024-01-01", effectiveTo: null, percentageBps: 10_000, basis: "total" as const, capMinor: null, fundScheduledRepayments: false }],
    assumptions: [{ key: simKey("a"), kind: "offset-balance" as const, effectiveFrom: "2024-01-01", recurrence: null, amountMinor: balanceMinor, feeTreatment: null, offsetAccountId: key, note: null }],
  };
};
