/// <reference lib="webworker" />
import { projectDebt, type DebtProjectionInput } from "@/lib/financial-models/loan/projection";

/**
 * Runs the pure RD-084 projection off the main thread (P1.3b T203). A day-by-day
 * 30-year projection takes hundreds of milliseconds (plan.md, T199), which would
 * freeze typing on the main thread. The worker holds no state and touches
 * nothing but the engine: no Actual, no app database.
 */

export type ProjectionJob = { id: number; primary: DebtProjectionInput; comparison: DebtProjectionInput | null; impactBaseline?: DebtProjectionInput | null; contract?: DebtProjectionInput | null };

self.onmessage = (event: MessageEvent<ProjectionJob>) => {
  const { id, primary, comparison, impactBaseline = null, contract = null } = event.data;
  const started = performance.now();
  try {
    const projection = projectDebt(primary);
    const compared = comparison ? projectDebt(comparison) : null;
    const impact = impactBaseline ? projectDebt(impactBaseline) : null;
    const contracted = contract ? projectDebt(contract) : null;
    self.postMessage({ id, ok: true, projection, comparison: compared, impactBaseline: impact, contract: contracted, durationMs: performance.now() - started });
  } catch (error) {
    self.postMessage({ id, ok: false, error: error instanceof Error ? error.message : String(error) });
  }
};
