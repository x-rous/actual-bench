import { listSyncFlows, pauseSyncFlowForHealth } from "@/lib/app-db/syncFlowRepository";
import { listSyncFlowRuns } from "@/lib/app-db/syncRunRepository";
import { hasSyncCredential } from "@/lib/app-db/syncCredentialRepository";
import { getAppMeta, setAppMeta } from "@/lib/app-db/appMetaRepository";
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
  nowMs: number;
};

/**
 * True when an unattended flow is due for a safe-only run right now. Health
 * pauses aren't checked here: a paused flow is persisted as disabled (see
 * buildUnattendedFlows), so it already fails the `enabled` guard.
 */
export function isUnattendedFlowDue(
  flow: UnattendedFlow,
  inFlight: ReadonlySet<string>,
  nowMs: number
): boolean {
  if (flow.reviewPolicy !== "auto_sync_unattended") return false;
  if (!flow.enabled) return false;
  if (!flow.enrolled) return false;
  if (inFlight.has(flow.flowId)) return false;
  if (flow.lastRunAtMs == null) return true;
  const intervalMs = Math.max(MIN_UNATTENDED_INTERVAL_MINUTES, flow.intervalMinutes) * 60_000;
  return nowMs - flow.lastRunAtMs >= intervalMs;
}

/** Flow ids that should start an unattended safe-only run on this tick. */
export function selectUnattendedFlowsToRun(input: UnattendedSelectionInput): string[] {
  return input.flows
    .filter((flow) => isUnattendedFlowDue(flow, input.inFlight, input.nowMs))
    .map((flow) => flow.flowId);
}

// ── Runner (impure) ─────────────────────────────────────────────────────────

const inFlight = new Set<string>();
const consecutiveFailures = new Map<string, number>();
const lastResults = new Map<string, { status: string; at: string; message?: string }>();
let lastTickAt: string | null = null;

/** app_meta key holding the last scheduler snapshot (see appMetaRepository). */
const SCHEDULER_STATE_KEY = "sync_scheduler_state";

export type SchedulerState = {
  enabled: boolean;
  lastTickAt: string | null;
  inFlight: string[];
  pausedByHealth: string[];
  lastResults: Record<string, { status: string; at: string; message?: string }>;
};

type PersistedSchedulerState = Omit<SchedulerState, "enabled">;

/** Human-readable reason for a non-success result, so the operator surfaces (log
 * + App Health) explain a `failed`/blocked run instead of just its status. */
export function serverResultMessage(result: ServerSafeSyncResult): string | undefined {
  if (isServerSafeSyncBlocked(result)) return result.message;
  if (result.status === "preview_failed") return result.error.message;
  if (result.status === "failed" || result.status === "partial") return result.apply.error?.message;
  return undefined;
}

/** Flow ids that are health-paused (persisted `autoPausedAt`), for the card. */
function pausedFlowIds(db: SqliteDatabase): string[] {
  return listSyncFlows(db)
    .filter((flow) => !flow.enabled && decodeFlowPlanConfig(flow).autoPausedAt)
    .map((flow) => flow.id);
}

/** The snapshot written to the DB at the end of every tick. Health pauses are
 * persisted on the flows themselves, so they are read back from the DB. */
function buildSnapshot(db: SqliteDatabase): PersistedSchedulerState {
  return {
    lastTickAt,
    inFlight: [...inFlight],
    pausedByHealth: pausedFlowIds(db),
    lastResults: Object.fromEntries(lastResults),
  };
}

/**
 * Snapshot of the scheduler for the operator health view (024e). The scheduler
 * runs in the server boot context; the App Health API route is a *different*
 * module instance (Next re-evaluates route modules), so its in-memory state is
 * blind. Read the last snapshot the scheduler persisted to the shared DB so the
 * card reflects real activity. Falls back to this process's memory when no db is
 * given or no snapshot exists yet.
 */
export function getSchedulerState(db?: SqliteDatabase): SchedulerState {
  const enabled = vaultEnabled();
  if (db) {
    const raw = getAppMeta(db, SCHEDULER_STATE_KEY);
    if (raw) {
      try {
        return { enabled, ...(JSON.parse(raw) as PersistedSchedulerState) };
      } catch {
        // Corrupt snapshot → fall through to in-memory.
      }
    }
  }
  // No db / no snapshot yet: report this process's minimal in-memory view.
  return {
    enabled,
    lastTickAt,
    inFlight: [...inFlight],
    pausedByHealth: [],
    lastResults: Object.fromEntries(lastResults),
  };
}

function buildUnattendedFlows(db: SqliteDatabase): UnattendedFlow[] {
  return listSyncFlows(db).map((flow) => {
    const config = decodeFlowPlanConfig(flow);
    const enrolled =
      hasSyncCredential(db, config.sourceConnectionFingerprint) &&
      hasSyncCredential(db, config.targetConnectionFingerprint);
    // Measure the interval from the last run that actually *completed* a sync,
    // not a pending manual preview (draft_preview) - otherwise repeatedly
    // previewing a flow would keep resetting its clock and starve the schedule.
    const lastCompleted = listSyncFlowRuns(db, { flowId: flow.id, limit: 20 }).find(
      (r) => r.status !== "draft_preview"
    );
    const lastRunAtMs = lastCompleted ? new Date(lastCompleted.finishedAt ?? lastCompleted.startedAt).getTime() : null;
    return {
      flowId: flow.id,
      reviewPolicy: config.reviewPolicy,
      // A health-paused flow is disabled + carries autoPausedAt, so it drops out
      // here until the user re-enables it (which clears autoPausedAt).
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

  if (!vaultEnabled()) {
    persistSnapshot(db);
    return { at: lastTickAt, due: 0, ran: [] };
  }

  const flows = buildUnattendedFlows(db);
  const due = selectUnattendedFlowsToRun({ flows, inFlight, nowMs });
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
      registerOutcome(db, flowId, outcome);
      const message = serverResultMessage(result);
      lastResults.set(flowId, { status: result.status, at: lastTickAt, message });
      ran.push({ flowId, status: result.status, message });
    } catch (err) {
      registerOutcome(db, flowId, "failure");
      lastResults.set(flowId, { status: err instanceof Error ? `error: ${err.message}` : "error", at: lastTickAt });
      ran.push({ flowId, status: "error" });
    } finally {
      inFlight.delete(flowId);
    }
  }

  // Publish the snapshot so the App Health route (a different module instance)
  // reads real activity from the shared DB instead of its own blank memory.
  persistSnapshot(db);
  return { at: lastTickAt, due: due.length, ran };
}

/**
 * Track consecutive failures per flow and, at the threshold, persist a health
 * pause on the flow itself (disabled + autoPausedAt). The pause then shows via
 * the existing "Auto-paused" badge and is cleared when the user re-enables the
 * flow - the counter is dropped so a resumed flow starts with a clean slate.
 */
function registerOutcome(db: SqliteDatabase, flowId: string, outcome: "success" | "failure" | "ignored"): void {
  const failures = nextConsecutiveFailures(consecutiveFailures.get(flowId) ?? 0, outcome);
  if (shouldPauseForHealth(failures, DEFAULT_HEALTH_PAUSE_THRESHOLD)) {
    pauseSyncFlowForHealth(db, flowId, new Date().toISOString());
    consecutiveFailures.delete(flowId);
    return;
  }
  consecutiveFailures.set(flowId, failures);
}

function persistSnapshot(db: SqliteDatabase): void {
  try {
    setAppMeta(db, SCHEDULER_STATE_KEY, JSON.stringify(buildSnapshot(db)));
  } catch {
    // Snapshot persistence is best-effort telemetry; never fail a tick over it.
  }
}

/** Test-only: clear the process-local scheduler state between cases. */
export function __resetSchedulerStateForTests(): void {
  inFlight.clear();
  consecutiveFailures.clear();
  lastResults.clear();
  lastTickAt = null;
}
