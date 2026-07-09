import type { SafeSyncResult } from "@/lib/sync/safeSyncOrchestrator";

/**
 * Flow health for automated safe-sync (RD-054 / PR-020 Slice 5).
 *
 * Repeated failing/partial automated runs pause a flow so it stops auto-firing
 * until the user re-enables it. All the counting is pure and here so the pause
 * rule is unit-testable; the scheduler hook only keeps the running count and
 * calls back to persist the pause.
 */

export const DEFAULT_HEALTH_PAUSE_THRESHOLD = 3;

export type AutoRunHealthOutcome = "success" | "failure" | "ignored";

/**
 * Map a safe-sync result to a health outcome:
 * - a clean apply or a nothing-to-do run is success (resets the streak);
 * - a failed/partial apply or a failed preview is a failure (extends the streak);
 * - a manual-policy skip never happened as an auto run, so it is ignored.
 */
export function classifySafeSyncOutcome(status: SafeSyncResult["status"]): AutoRunHealthOutcome {
  switch (status) {
    case "applied":
    case "no_safe_items":
      return "success";
    case "partial":
    case "failed":
    case "preview_failed":
      return "failure";
    case "skipped_manual_policy":
      return "ignored";
    default:
      return "ignored";
  }
}

/** Next consecutive-failure count after observing an outcome. */
export function nextConsecutiveFailures(prev: number, outcome: AutoRunHealthOutcome): number {
  if (outcome === "failure") return prev + 1;
  if (outcome === "success") return 0;
  return prev; // ignored: leave the streak unchanged
}

/** True once the failure streak reaches the pause threshold. */
export function shouldPauseForHealth(
  consecutiveFailures: number,
  threshold: number = DEFAULT_HEALTH_PAUSE_THRESHOLD
): boolean {
  return consecutiveFailures >= threshold;
}
