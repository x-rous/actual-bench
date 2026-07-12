import { listSyncFlows } from "@/lib/app-db/syncFlowRepository";
import { listSyncFlowRuns } from "@/lib/app-db/syncRunRepository";
import { hasSyncCredential } from "@/lib/app-db/syncCredentialRepository";
import {
  DEFAULT_HEALTH_PAUSE_THRESHOLD,
  classifySafeSyncOutcome,
  nextConsecutiveFailures,
  shouldPauseForHealth,
} from "@/features/sync/lib/flowHealth";
import { decodeFlowPlanConfig } from "./flowConfig";
import { runServerSafeSync, isServerSafeSyncBlocked, type ServerSafeSyncResult } from "./serverSafeSync";
import { vaultEnabled } from "./vault";
import type { SqliteDatabase, SyncReviewPolicy } from "@/lib/app-db/types";

/**
 * In-process unattended scheduler (RD-058 / PR-024c). A pure selection function
 * (`selectUnattendedFlowsToRun`) plus a runner (`runSchedulerTick`) that the
 * server's interval or the trigger endpoint drive. Single-instance: non-overlap
 * and flow-health tracking are process-local (reset on restart, which just means
 * a fresh retry - a persistently broken flow re-pauses after the threshold).
 */

/** Floor on unattended frequency - each run opens/syncs the whole budget. */
export const MIN_UNATTENDED_INTERVAL_MINUTES = 15;

export type UnattendedFlow = {
  flowId: string;
  reviewPolicy: SyncReviewPolicy;
  enabled: boolean;
  intervalMinutes: number;
  /** Both source and target connections have a stored (HTTP-API) credential. */
  enrolled: boolean;
  /** Start/finish time (ms) of the flow's most recent run, or null if never. */
  lastRunAtMs: number | null;
};

export type UnattendedSelectionInput = {
  flows: UnattendedFlow[];
  /** Runs currently in progress this process - never started twice. */
  inFlight: ReadonlySet<string>;
  /** Flows paused after repeated failures this process. */
  pausedByHealth: ReadonlySet<string>;
  nowMs: number;
};

/** True when an unattended flow is due for a safe-only run right now. */
export function isUnattendedFlowDue(
  flow: UnattendedFlow,
  inFlight: ReadonlySet<string>,
  pausedByHealth: ReadonlySet<string>,
  nowMs: number
): boolean {
  if (flow.reviewPolicy !== "auto_sync_unattended") return false;
  if (!flow.enabled) return false;
  if (!flow.enrolled) return false;
  if (inFlight.has(flow.flowId)) return false;
  if (pausedByHealth.has(flow.flowId)) return false;
  if (flow.lastRunAtMs == null) return true;
  const intervalMs = Math.max(MIN_UNATTENDED_INTERVAL_MINUTES, flow.intervalMinutes) * 60_000;
  return nowMs - flow.lastRunAtMs >= intervalMs;
}

/** Flow ids that should start an unattended safe-only run on this tick. */
export function selectUnattendedFlowsToRun(input: UnattendedSelectionInput): string[] {
  return input.flows
    .filter((flow) => isUnattendedFlowDue(flow, input.inFlight, input.pausedByHealth, input.nowMs))
    .map((flow) => flow.flowId);
}

// ── Runner (impure) ─────────────────────────────────────────────────────────

const inFlight = new Set<string>();
const consecutiveFailures = new Map<string, number>();
const pausedByHealth = new Set<string>();
const lastResults = new Map<string, { status: string; at: string; message?: string }>();
let lastTickAt: string | null = null;

export type SchedulerState = {
  enabled: boolean;
  lastTickAt: string | null;
  inFlight: string[];
  pausedByHealth: string[];
  lastResults: Record<string, { status: string; at: string; message?: string }>;
};

/** Human-readable reason for a non-success result, so the operator surfaces (log
 * + App Health) explain a `failed`/blocked run instead of just its status. */
export function serverResultMessage(result: ServerSafeSyncResult): string | undefined {
  if (isServerSafeSyncBlocked(result)) return result.message;
  if (result.status === "preview_failed") return result.error.message;
  if (result.status === "failed" || result.status === "partial") return result.apply.error?.message;
  return undefined;
}

/** Snapshot of the scheduler for the operator health view (024e). */
export function getSchedulerState(): SchedulerState {
  return {
    enabled: vaultEnabled(),
    lastTickAt,
    inFlight: [...inFlight],
    pausedByHealth: [...pausedByHealth],
    lastResults: Object.fromEntries(lastResults),
  };
}

function buildUnattendedFlows(db: SqliteDatabase): UnattendedFlow[] {
  return listSyncFlows(db).map((flow) => {
    const config = decodeFlowPlanConfig(flow);
    const enrolled =
      hasSyncCredential(db, config.sourceConnectionFingerprint) &&
      hasSyncCredential(db, config.targetConnectionFingerprint);
    const latest = listSyncFlowRuns(db, { flowId: flow.id, limit: 1 })[0];
    const lastRunAtMs = latest ? new Date(latest.finishedAt ?? latest.startedAt).getTime() : null;
    return {
      flowId: flow.id,
      reviewPolicy: config.reviewPolicy,
      enabled: flow.enabled && !config.autoPausedAt,
      intervalMinutes: config.intervalMinutes,
      enrolled,
      lastRunAtMs: Number.isNaN(lastRunAtMs) ? null : lastRunAtMs,
    };
  });
}

/** Map a server result to a health outcome; blocked (vault/enrollment) counts as failure. */
function outcomeOf(result: ServerSafeSyncResult): "success" | "failure" | "ignored" {
  if (isServerSafeSyncBlocked(result)) return "failure";
  return classifySafeSyncOutcome(result.status);
}

export type TickSummary = {
  at: string;
  due: number;
  ran: { flowId: string; status: string; message?: string }[];
};

export type SchedulerRunDeps = {
  /** Injectable for tests; defaults to the real server executor. */
  run?: (db: SqliteDatabase, flowId: string) => Promise<ServerSafeSyncResult>;
  nowMs?: number;
};

/** Run one scheduler pass: select due flows and safe-sync each, once. */
export async function runSchedulerTick(db: SqliteDatabase, deps: SchedulerRunDeps = {}): Promise<TickSummary> {
  const nowMs = deps.nowMs ?? Date.now();
  const run = deps.run ?? runServerSafeSync;
  lastTickAt = new Date(nowMs).toISOString();

  if (!vaultEnabled()) return { at: lastTickAt, due: 0, ran: [] };

  const flows = buildUnattendedFlows(db);
  const due = selectUnattendedFlowsToRun({ flows, inFlight, pausedByHealth, nowMs });
  const ran: { flowId: string; status: string; message?: string }[] = [];

  for (const flowId of due) {
    // A concurrent tick (interval + external POST) may have started this flow
    // between selection and now. `inFlight` is mutated synchronously before the
    // first await, so this guard reliably prevents a double run.
    if (inFlight.has(flowId)) continue;
    inFlight.add(flowId);
    try {
      const result = await run(db, flowId);
      const outcome = outcomeOf(result);
      const failures = nextConsecutiveFailures(consecutiveFailures.get(flowId) ?? 0, outcome);
      consecutiveFailures.set(flowId, failures);
      if (shouldPauseForHealth(failures, DEFAULT_HEALTH_PAUSE_THRESHOLD)) {
        pausedByHealth.add(flowId);
      }
      const message = serverResultMessage(result);
      lastResults.set(flowId, { status: result.status, at: lastTickAt, message });
      ran.push({ flowId, status: result.status, message });
    } catch (err) {
      const failures = nextConsecutiveFailures(consecutiveFailures.get(flowId) ?? 0, "failure");
      consecutiveFailures.set(flowId, failures);
      if (shouldPauseForHealth(failures, DEFAULT_HEALTH_PAUSE_THRESHOLD)) pausedByHealth.add(flowId);
      lastResults.set(flowId, { status: err instanceof Error ? `error: ${err.message}` : "error", at: lastTickAt });
      ran.push({ flowId, status: "error" });
    } finally {
      inFlight.delete(flowId);
    }
  }

  return { at: lastTickAt, due: due.length, ran };
}

/** Test-only: clear the process-local scheduler state between cases. */
export function __resetSchedulerStateForTests(): void {
  inFlight.clear();
  consecutiveFailures.clear();
  pausedByHealth.clear();
  lastResults.clear();
  lastTickAt = null;
}
