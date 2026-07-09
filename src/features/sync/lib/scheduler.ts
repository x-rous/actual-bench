import type { SyncReviewPolicy } from "@/lib/app-db/types";

/**
 * Pure scheduling decision for client-side interval auto-sync
 * (RD-054 / PR-020 Slice 4).
 *
 * This is intentionally a plain function, not a hook: all the rules that matter
 * - policy gate, enabled gate, connection availability, the interval floor, and
 * non-overlap - are decided here so they can be unit-tested without React or a
 * live timer. `useSyncScheduler` is only a thin timer wrapper around this.
 *
 * There is no server here: the engine and credentials live in the browser, so a
 * flow is only schedulable while its connections are unlocked in this tab
 * (`connectionsReady`). Unattended server-side scheduling is RD-058.
 */

export type SchedulableFlow = {
  flowId: string;
  reviewPolicy: SyncReviewPolicy;
  /** Disabled/paused flows are never auto-triggered. */
  enabled: boolean;
  intervalMinutes: number;
  /** Both source and target connections are resolved/unlocked in this tab. */
  connectionsReady: boolean;
  /** Start time (ms) of this flow's most recent auto run, or null if never. */
  lastRunAtMs: number | null;
};

export type AutoRunSelectionInput = {
  flows: SchedulableFlow[];
  /** Flows whose auto run is currently in progress - never started twice. */
  inFlight: ReadonlySet<string>;
  nowMs: number;
};

/** True when a flow is due for an automated safe-only run right now. */
export function isFlowDue(flow: SchedulableFlow, inFlight: ReadonlySet<string>, nowMs: number): boolean {
  if (flow.reviewPolicy !== "auto_sync_on_interval") return false;
  if (!flow.enabled) return false;
  if (!flow.connectionsReady) return false;
  if (inFlight.has(flow.flowId)) return false;
  if (flow.lastRunAtMs == null) return true;
  const intervalMs = Math.max(1, flow.intervalMinutes) * 60_000;
  return nowMs - flow.lastRunAtMs >= intervalMs;
}

/** Flow ids that should start an automated safe-only run on this tick. */
export function selectFlowsToAutoRun(input: AutoRunSelectionInput): string[] {
  return input.flows
    .filter((flow) => isFlowDue(flow, input.inFlight, input.nowMs))
    .map((flow) => flow.flowId);
}
