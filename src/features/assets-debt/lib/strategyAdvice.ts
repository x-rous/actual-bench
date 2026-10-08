import { evaluateStrategyEligibility } from "@/lib/financial-models/loan/eligibility";
import { simulationToModel, type SimulationState } from "./simulatorModel";

/**
 * Which calculation engine reproduces the loan (P1.3b; FR-225). Not a choice the user makes: the
 * calculation method decides it. Shown as one read-only line on the Schedule tab (rev 2).
 */
export type StrategyAdvice = { recommended: "bench-periodic" | "bench-daily" | null; lines: { strategy: string; label: string; available: boolean; reasons: string[] }[] };

const CAPABILITY_REASON = /^The connected Actual (does not support|cannot read)/;

/** The Bench strategy the loan's calculation fits; the formula-rule strategy waits for P1.7's capability check. */
export function strategyAdvice(sim: SimulationState): StrategyAdvice {
  const built = simulationToModel(sim);
  if (!built.ok) return { recommended: null, lines: [] };
  const e = evaluateStrategyEligibility(built.model, { formulaRules: false, splitActions: false, transferPayees: false, ruleReadback: false });
  const label = { "actual-formula-rule": "An Actual formula rule", "bench-periodic": "Actual Bench, period by period", "bench-daily": "Actual Bench, day by day" } as const;
  const lines = e.options.map((o) => ({
    strategy: o.strategy,
    label: label[o.strategy],
    available: o.strategy !== "actual-formula-rule" && o.eligible,
    reasons: o.strategy === "actual-formula-rule" ? [...o.reasons.filter((r) => !CAPABILITY_REASON.test(r)), "Available once Actual Bench has checked what the connected Actual supports (a later step)."] : o.reasons,
  }));
  const recommended = (lines.find((l) => l.available)?.strategy ?? null) as StrategyAdvice["recommended"];
  return { recommended, lines };
}

/** The one line Schedule shows: which engine will keep this loan in Actual. */
export function engineLine(sim: SimulationState): string {
  const advice = strategyAdvice(sim);
  const line = advice.lines.find((l) => l.strategy === advice.recommended);
  return line ? `Kept in Actual by ${line.label}` : "No Actual Bench engine fits these settings yet";
}
