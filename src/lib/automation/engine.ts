import {
  claimAutomation,
  getAutomation,
  listAutomations,
  resumeAutomation,
  pauseAutomationForHealth,
  recordAutomationOutcome,
  releaseAutomationClaim,
  updateAutomation,
} from "@/lib/app-db/automationRepository";
import {
  createAutomationRun,
  finalizeAutomationRun,
  listAutomationRuns,
  pruneAutomationRuns,
} from "@/lib/app-db/automationRunRepository";
import { pruneSyncFlowRuns } from "@/lib/app-db/syncRunRepository";
import { logger } from "@/lib/logger";
import { DEFAULT_JOB_DEADLINE_MS, getAutomationJobType, listAutomationJobTypes } from "./registry";
import { getAutomationExecutor, type AutomationExecutor } from "./executor";
import { resolveCredentials, type JobExecutionOutcome, type StopCode } from "./jobExecution";
import { redactSecrets, type RunLogEntry } from "./runLogger";
import { effectiveNextRunAt, isDue } from "./schedule";
import type { AutomationJobType } from "./registry";
import type {
  AutomationDefinition,
  AutomationRun,
  AutomationRunRollup,
  AutomationRunStatus,
  AutomationRunTrigger,
  JsonEnvelope,
  SqliteDatabase,
} from "@/lib/app-db/types";

/**
 * The automation engine (RD-079 / PR-043b): select what is due, run exactly one
 * instance of it, retry sensibly, and pause what is persistently broken.
 *
 * Single-instance and in-process, exactly as RD-058 established — the overlap
 * guarantee below holds *within one Node process*, and the UI says so rather
 * than implying distributed locking. Horizontal scaling is a separate decision.
 */

/** Runs currently executing in this process. Mutated synchronously before the
 * first `await`, so a concurrent tick cannot start the same automation twice. */
const inFlight = new Set<string>();

/** Runs left to keep per automation when pruning history. */
export const RUN_RETENTION_PER_AUTOMATION = 100;

/**
 * Runs left to keep per Budget File Sync flow when pruning history.
 *
 * A separate table from `automation_runs` (`sync_flow_runs`/
 * `sync_flow_run_items` — see persistPlan.ts) with its own retention, for the
 * same reason RD-079 kept it: it holds the detailed per-item plan, not just
 * the automation rollup. Left unpruned, an unattended flow ticking every 15
 * minutes accumulates run history indefinitely.
 */
export const RUN_RETENTION_PER_SYNC_FLOW = 100;

/**
 * Cancellation handles for in-flight runs, keyed by automation, so a stop
 * request can reach them. On `globalThis`: the cancel route is a separate
 * module instance from the scheduler that started the run, and a map of its
 * own would never contain it.
 */
const CONTROLLERS_KEY = Symbol.for("actual-bench.automationRunControllers");

function runControllers(): Map<string, { runId: string; controller: AbortController }> {
  const holder = globalThis as { [CONTROLLERS_KEY]?: Map<string, { runId: string; controller: AbortController }> };
  holder[CONTROLLERS_KEY] ??= new Map();
  return holder[CONTROLLERS_KEY];
}

/** Why a run's signal was aborted, carried as the abort reason. */
type AbortReason = { code: "TIMEOUT" | "CANCELLED" };

export type EngineRunOutcome = {
  automationId: string;
  runId: string | null;
  status: AutomationRunStatus | "skipped";
  message?: string;
  /** Set when a run was skipped for want of a worker (`NO_CAPACITY`, `WORKER_UNAVAILABLE`). */
  code?: StopCode;
};

export type TickSummary = {
  at: string;
  due: number;
  ran: EngineRunOutcome[];
};

// Moved to `jobExecution.ts`, where it also runs inside a worker; re-exported
// so callers keep one import site.
export { resolveCredentials } from "./jobExecution";

/**
 * Re-exported so callers reason about backoff in one place. The delay is
 * enforced by `isDue` at selection time, not merely stored on the row.
 */
export { backoffDelayMinutes } from "./schedule";

function errorEnvelope(message: string, code?: StopCode): JsonEnvelope {
  return { version: 1, data: { message: redact(message), ...(code ? { code } : {}) } };
}

/**
 * The same redactor the run logger uses.
 *
 * A second, weaker implementation lived here and covered only *known* secrets —
 * values a job had actually revealed. A provider error echoing a credential
 * from a job that never called `reveal()` passed straight through into
 * `error_json`, the roll-up message and the auto-pause reason, all of which are
 * persisted and shown in the UI. One redactor, one behaviour.
 */
function redact(message: string): string {
  // Everything that reaches here from a job is already redacted against the
  // secrets it revealed (`jobExecution.ts`); patterns are the second line.
  return redactSecrets(message);
}

function statusFromRollup(rollup: AutomationRunRollup): AutomationRunStatus {
  switch (rollup.outcome) {
    case "ok":
      return "succeeded";
    case "partial":
      return "partial";
    case "no_changes":
      return "no_changes";
    case "failed":
      return "failed";
  }
}

/**
 * Did this run count as a success for health purposes?
 *
 * A partial run is reported as partial either way; whether it counts *against*
 * the automation's health is the job type's call, declared on the roll-up. The
 * engine has no basis for that judgement — "some items failed" means a broken
 * write path for one type and an unreachable bank for another.
 */
function isHealthySuccess(status: AutomationRunStatus, rollup?: AutomationRunRollup | null): boolean {
  if (status === "partial") return !rollup?.countsAsFailure;
  return status === "succeeded" || status === "no_changes";
}

export type ExecuteOptions = {
  trigger?: AutomationRunTrigger;
  attempt?: number;
  nowMs?: number;
  /** Stored on the run and handed to the job as `ctx.input`. */
  input?: JsonEnvelope | null;
};

/**
 * The result of *starting* a run: either it started, with the id to follow it
 * by and a promise that settles when it ends, or it did not, and why.
 */
export type StartedRun =
  | { started: true; runId: string; done: Promise<EngineRunOutcome> }
  | { started: false; outcome: EngineRunOutcome };

/**
 * Runs started in the background, kept process-wide so tests and shutdown can
 * wait for them. On `globalThis` for the same reason the queue is: a route
 * module instance and the engine's own must see the same set.
 */
const BACKGROUND_RUNS_KEY = Symbol.for("actual-bench.backgroundAutomationRuns");

function backgroundRuns(): Set<Promise<EngineRunOutcome>> {
  const holder = globalThis as { [BACKGROUND_RUNS_KEY]?: Set<Promise<EngineRunOutcome>> };
  holder[BACKGROUND_RUNS_KEY] ??= new Set();
  return holder[BACKGROUND_RUNS_KEY];
}

/** Settle every run started in the background. For tests and orderly shutdown. */
export async function settleBackgroundRuns(): Promise<void> {
  while (backgroundRuns().size > 0) {
    await Promise.allSettled([...backgroundRuns()]);
  }
}

/**
 * Run one automation once, recording a run row whatever happens.
 *
 * Every exit path finalizes the run — a job that throws leaves a `failed` run
 * with a readable reason, never a row stuck in `running` that history would
 * render as "still going" forever.
 */
export async function executeAutomation(
  db: SqliteDatabase,
  automationId: string,
  options: ExecuteOptions = {}
): Promise<EngineRunOutcome> {
  const start = startAutomationRun(db, automationId, options);
  return start.started ? start.done : start.outcome;
}

/**
 * Start one run and return as soon as it exists.
 *
 * Everything up to and including the run row happens before this returns:
 * the lookup, the fail-closed credential check, the claim and the `running`
 * row. The job itself continues in the background, with the same bookkeeping
 * `executeAutomation` has always done. This is what lets "Run now" answer with
 * a run id immediately instead of holding an HTTP request open for a run that
 * may take minutes (F-191) - a reverse proxy gives up long before a large
 * backup does, while the run carries on regardless.
 */
export function startAutomationRun(
  db: SqliteDatabase,
  automationId: string,
  options: ExecuteOptions = {}
): StartedRun {
  const skip = (outcome: EngineRunOutcome): StartedRun => ({ started: false, outcome });

  const definition = getAutomation(db, automationId);
  if (!definition) {
    return skip({ automationId, runId: null, status: "skipped", message: "Automation not found" });
  }

  if (inFlight.has(automationId)) {
    return skip({ automationId, runId: null, status: "skipped", message: "A run is already in progress" });
  }

  const jobType = getAutomationJobType(definition.type) as AutomationJobType<unknown, unknown> | undefined;
  if (!jobType) {
    // An unknown type is a deployment problem, not a job failure: pause it so
    // it stops re-firing every minute, and say exactly what is missing. The
    // pause is undone automatically once the type turns up - see
    // `resumeAutomationsAwaitingTheirJobType`.
    pauseAutomationForHealth(
      db,
      automationId,
      new Date(options.nowMs ?? Date.now()).toISOString(),
      `No job type registered for "${definition.type}"`
    );
    return skip({ automationId, runId: null, status: "skipped", message: `Unknown job type ${definition.type}` });
  }

  const credentials = resolveCredentials(db, definition);
  if (credentials.status === "unavailable") {
    // Fail closed: no run, no partial execution — pause and surface why.
    pauseAutomationForHealth(
      db,
      automationId,
      new Date(options.nowMs ?? Date.now()).toISOString(),
      credentials.reason
    );
    return skip({ automationId, runId: null, status: "skipped", message: credentials.reason });
  }

  // Room to run it? Asked before the claim, so a "no" leaves nothing to undo:
  // no claim, no run row, no pause, nothing counted against health. The
  // scheduler picks it up again next tick.
  const executor = getAutomationExecutor();
  const availability = executor.availability();
  if (!availability.ok) {
    return skip({
      automationId,
      runId: null,
      status: "skipped",
      message: availability.message,
      code: availability.code,
    });
  }

  // Take the claim in the database, not only in memory. Next may evaluate a
  // route module separately from the server boot context, so the external-cron
  // trigger endpoint and the interval loop can hold *different* `inFlight` sets
  // — an in-memory lock alone would let the same automation apply its writes
  // twice. The in-memory set stays as a cheap first check and for `running`.
  if (!claimAutomation(db, automationId, new Date(options.nowMs ?? Date.now()).toISOString())) {
    return skip({ automationId, runId: null, status: "skipped", message: "A run is already in progress" });
  }

  inFlight.add(automationId);
  const controller = new AbortController();

  const attempt = options.attempt ?? 1;
  const startedAt = new Date(options.nowMs ?? Date.now()).toISOString();

  // Everything after the claim is inside a guarded region. Opening the run row
  // can fail — a SQLite write error is enough — and if that happened before the
  // `try`, the `finally` never ran: `running_since` would self-heal when the
  // claim went stale, but the in-memory `inFlight` entry would not, leaving the
  // automation permanently "already in progress" until the process restarted.
  let run: AutomationRun;
  try {
    run = createAutomationRun(db, {
      automationId,
      type: definition.type,
      status: "running",
      startedAt,
      trigger: options.trigger ?? "schedule",
      attempt,
      executionMode: definition.executionMode,
      input: options.input ?? null,
    });
  } catch (error) {
    inFlight.delete(automationId);
    releaseAutomationClaim(db, automationId);
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(`[automation] could not open a run for ${automationId}: ${message}`);
    return skip({ automationId, runId: null, status: "skipped", message });
  }

  runControllers().set(automationId, { runId: run.id, controller });

  const done = runStartedAutomation(db, {
    definition,
    executor,
    deadlineMs: jobType.deadlineMs ?? DEFAULT_JOB_DEADLINE_MS,
    controller,
    run,
    attempt,
    nowMs: options.nowMs,
  });
  const runs = backgroundRuns();
  runs.add(done);
  // Both branches, so a run nobody awaits (a background "Run now") cannot turn
  // a rejection - a database error while finalizing - into an unhandled one.
  // Callers that do await `done` still see it.
  const forget = () => {
    runs.delete(done);
  };
  done.then(forget, forget);

  return { started: true, runId: run.id, done };
}

type StartedRunContext = {
  definition: AutomationDefinition;
  executor: AutomationExecutor;
  deadlineMs: number;
  controller: AbortController;
  run: AutomationRun;
  attempt: number;
  nowMs: number | undefined;
};

/**
 * Execute a run that `startAutomationRun` has claimed and opened, through the
 * executor, and record what came back. Every exit path finalizes the run and
 * releases the claim; it never rejects.
 *
 * What a run ends as:
 *
 *   * it finished - its own roll-up decides, as always; if it stopped early
 *     because it was asked to, it is `cancelled` (a person asked) or `failed`
 *     (its deadline passed);
 *   * it threw - `failed`;
 *   * it was stopped from outside - by its deadline, a cancel it did not honour
 *     in time, or its worker dying - then it depends on how far it had got.
 *     Still only reading, it `failed` (or was `cancelled`). Past the point
 *     where it may have changed something, it is `indeterminate`: not retried,
 *     not counted against its health, and flagged for someone to check.
 */
async function runStartedAutomation(
  db: SqliteDatabase,
  { definition, executor, deadlineMs, controller, run, attempt, nowMs }: StartedRunContext
): Promise<EngineRunOutcome> {
  const automationId = definition.id;
  const scheduledFrom = nowMs ?? Date.now();

  // Started before the first `await`: the executor takes its worker slot here,
  // in the same turn `startAutomationRun` checked that one was free.
  const pending = executor.execute(
    db,
    { automationId, runId: run.id, attempt, input: run.input },
    controller.signal
  );
  const deadline = setTimeout(() => controller.abort({ code: "TIMEOUT" } satisfies AbortReason), deadlineMs);
  deadline.unref?.();

  try {
    const outcome = await pending;
    return recordOutcome(db, { definition, run, outcome, signal: controller.signal, deadlineMs, scheduledFrom });
  } catch (error) {
    // An executor is not supposed to reject; if one does, the run still ends.
    const message = redact(error instanceof Error ? error.message : String(error));
    return recordOutcome(db, {
      definition,
      run,
      outcome: { kind: "threw", message, log: [] },
      signal: controller.signal,
      deadlineMs,
      scheduledFrom,
    });
  } finally {
    clearTimeout(deadline);
    inFlight.delete(automationId);
    const entry = runControllers().get(automationId);
    if (entry?.runId === run.id) runControllers().delete(automationId);
    releaseAutomationClaim(db, automationId);
  }
}

function abortCode(signal: AbortSignal): AbortReason["code"] | null {
  if (!signal.aborted) return null;
  return (signal.reason as Partial<AbortReason> | undefined)?.code === "TIMEOUT" ? "TIMEOUT" : "CANCELLED";
}

function deadlineMessage(deadlineMs: number): string {
  return `Stopped at its ${Math.round(deadlineMs / 60_000)}-minute deadline.`;
}

function recordOutcome(
  db: SqliteDatabase,
  input: {
    definition: AutomationDefinition;
    run: AutomationRun;
    outcome: JobExecutionOutcome;
    signal: AbortSignal;
    deadlineMs: number;
    scheduledFrom: number;
  }
): EngineRunOutcome {
  const { definition, run, outcome, signal, deadlineMs, scheduledFrom } = input;
  const automationId = definition.id;

  const finishFailure = (
    message: string,
    log: RunLogEntry[],
    code?: StopCode,
    result?: JsonEnvelope
  ): EngineRunOutcome => {
    const safeMessage = redact(message);
    finalizeAutomationRun(db, run.id, {
      status: "failed",
      error: errorEnvelope(safeMessage, code),
      result: result ?? withLog(null, log),
      rollup: { outcome: "failed", itemCount: 0, message: safeMessage.slice(0, 500) },
    });
    const updated = recordAutomationOutcome(db, automationId, { success: false, at: new Date().toISOString() });
    // Redacted, like the log and the stored error: the pause reason is shown in
    // the UI and returned by the health route, so a provider error echoing an
    // API key must not reach it either.
    applyHealthPolicy(db, updated ?? definition, false, safeMessage);
    scheduleNext(db, automationId, scheduledFrom);
    return { automationId, runId: run.id, status: "failed", message: safeMessage, ...(code ? { code } : {}) };
  };

  // Neither a success nor a failure: the user stopped it, or it stopped after
  // it may have written. Counting either as a failure would auto-pause the
  // automation for something that was not its fault - and, for a run that may
  // have written, back off into a retry that could repeat the write.
  const finishNeutral = (
    status: "cancelled" | "indeterminate",
    fields: { result?: JsonEnvelope | null; error?: JsonEnvelope; rollup: AutomationRunRollup }
  ): EngineRunOutcome => {
    finalizeAutomationRun(db, run.id, { status, ...fields });
    scheduleNext(db, automationId, scheduledFrom);
    return { automationId, runId: run.id, status, message: fields.rollup.message };
  };

  switch (outcome.kind) {
    case "completed": {
      // Stopped only if the job was still going when it was asked to stop. A
      // job that had already finished - a worker closing its budget when the
      // deadline passed, say - finished, whatever the signal says now.
      const stoppedBy = outcome.aborted ? abortCode(signal) : null;
      const result = withLog(outcome.result, outcome.log);
      if (stoppedBy === "TIMEOUT") {
        // It stopped by itself when its deadline passed. What it did is still
        // in its own result, which is kept either way. If it had got as far as
        // changing something, it is a run that may have written - the same as
        // one that had to be ended - and must not count as a failure or be
        // backed off into a retry that could repeat the write.
        if (outcome.phase !== "reading") {
          const note = `${deadlineMessage(deadlineMs)} It may have made changes before it stopped; check before relying on them.`;
          return finishNeutral("indeterminate", {
            result,
            error: errorEnvelope(note, "TIMEOUT"),
            rollup: { ...outcome.rollup, outcome: "partial", message: redact(note).slice(0, 500) },
          });
        }
        return finishFailure(deadlineMessage(deadlineMs), outcome.log, "TIMEOUT", result);
      }
      if (stoppedBy === "CANCELLED") {
        return finishNeutral("cancelled", { result, rollup: outcome.rollup });
      }
      const status = statusFromRollup(outcome.rollup);
      finalizeAutomationRun(db, run.id, { status, result, rollup: outcome.rollup });
      const success = isHealthySuccess(status, outcome.rollup);
      const updated = recordAutomationOutcome(db, automationId, { success, at: new Date().toISOString() });
      applyHealthPolicy(db, updated ?? definition, success, outcome.rollup.message);
      scheduleNext(db, automationId, scheduledFrom);
      return { automationId, runId: run.id, status, message: outcome.rollup.message };
    }

    case "threw":
      return finishFailure(outcome.message, outcome.log);

    case "stopped": {
      const message = outcome.code === "TIMEOUT" ? deadlineMessage(deadlineMs) : outcome.message;
      if (outcome.phase !== "reading") {
        const note = `${message} It may have made changes before it stopped; check before relying on them.`;
        return finishNeutral("indeterminate", {
          result: withLog(null, outcome.log),
          error: errorEnvelope(note, outcome.code),
          rollup: { outcome: "partial", itemCount: 0, message: redact(note).slice(0, 500) },
        });
      }
      if (outcome.code === "CANCELLED") {
        return finishNeutral("cancelled", {
          result: withLog(null, outcome.log),
          error: errorEnvelope(message, "CANCELLED"),
          rollup: { outcome: "failed", itemCount: 0, message: redact(message).slice(0, 500) },
        });
      }
      return finishFailure(message, outcome.log, outcome.code);
    }
  }
}

/** Store the run's redacted log lines alongside the type's own result. */
function withLog(result: JsonEnvelope | null, entries: RunLogEntry[]): JsonEnvelope {
  const base = result ?? { version: 1, data: {} };
  return { version: base.version, data: { ...base.data, log: entries } };
}

/** Auto-pause once the failure streak reaches the policy threshold. */
function applyHealthPolicy(
  db: SqliteDatabase,
  definition: AutomationDefinition,
  success: boolean,
  message?: string
): void {
  if (success) return;

  const threshold = definition.failurePolicy.pauseAfterConsecutiveFailures;
  if (definition.consecutiveFailures < threshold) return;

  const reason = message
    ? `Paused after ${definition.consecutiveFailures} consecutive failures: ${message.slice(0, 300)}`
    : `Paused after ${definition.consecutiveFailures} consecutive failures`;
  pauseAutomationForHealth(db, definition.id, new Date().toISOString(), reason);
}

/**
 * Recompute and store when this automation runs next, so the UI can show it
 * without recomputing, and a retry can be deferred by its backoff.
 */
function scheduleNext(db: SqliteDatabase, automationId: string, nowMs: number): void {
  const definition = getAutomation(db, automationId);
  if (!definition) return;

  const lastRunAtMs = lastRunStartMs(db, automationId);
  // The same function the selector uses, so the time shown is the time that
  // will actually be honoured — backoff included. The previous floor is not
  // carried in: this run has just happened, so the schedule from here is the
  // truth and an older floor would pin the automation in the past.
  const next = effectiveNextRunAt({ definition, lastRunAtMs, nowMs });

  updateAutomation(db, automationId, { nextRunAt: next === null ? null : new Date(next).toISOString() });
}

function lastRunStartMs(db: SqliteDatabase, automationId: string): number | null {
  const [latest] = listAutomationRuns(db, { automationId, limit: 1 });
  if (!latest) return null;
  const ms = Date.parse(latest.startedAt);
  return Number.isNaN(ms) ? null : ms;
}

/** Automations that should start a run on this tick. */
export function selectDueAutomations(
  db: SqliteDatabase,
  nowMs: number
): AutomationDefinition[] {
  return listAutomations(db).filter((definition) => {
    if (inFlight.has(definition.id)) return false;
    if (definition.executionMode !== "server") return false;
    return isDue({
      definition,
      lastRunAtMs: lastRunStartMs(db, definition.id),
      nowMs,
      notBeforeMs: parseIso(definition.nextRunAt),
    });
  });
}

function parseIso(value: string | null): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

/** One scheduler pass. */
/** The reason text `executeAutomation` records for an unregistered type. */
const MISSING_JOB_TYPE_REASON = "No job type registered for";

/**
 * Undo pauses caused by a job type that was missing and no longer is.
 *
 * The engine pauses an automation whose type it cannot resolve, which is right
 * - it stops a broken deployment re-firing every minute - but the pause outlives
 * the problem. A registration bug paused every backup and bank sync in the
 * install, and clearing that by hand, one automation at a time, is work created
 * by Bench for a fault of Bench's own.
 *
 * Deliberately narrow: only pauses whose recorded reason is *this* one, and only
 * when the type is now registered. A pause from repeated genuine failures still
 * needs a person to look, because nothing about it has been fixed by a restart.
 */
export function resumeAutomationsAwaitingTheirJobType(db: SqliteDatabase): string[] {
  const resumed: string[] = [];

  for (const definition of listAutomations(db)) {
    if (!definition.autoPausedAt) continue;
    if (!definition.autoPauseReason?.startsWith(MISSING_JOB_TYPE_REASON)) continue;
    if (!getAutomationJobType(definition.type)) continue;

    resumeAutomation(db, definition.id);
    resumed.push(definition.id);
  }

  if (resumed.length > 0) {
    logger.info(
      `[automation] resumed ${resumed.length} automation(s) paused for a job type that is now registered`
    );
  }

  return resumed;
}

export async function runEngineTick(
  db: SqliteDatabase,
  options: { nowMs?: number } = {}
): Promise<TickSummary> {
  const nowMs = options.nowMs ?? Date.now();
  const at = new Date(nowMs).toISOString();

  // Before anything is selected: give back the automations that were paused
  // only because their type had not been registered yet.
  resumeAutomationsAwaitingTheirJobType(db);

  // Let each job type reconcile its definitions with its own configuration
  // first, so an automation enrolled since the last tick is picked up now
  // rather than at the next server restart. The engine stays ignorant of what
  // any of this means; it just gives every type the chance.
  await reconcileJobTypes(db);

  const due = selectDueAutomations(db, nowMs);
  const ran: EngineRunOutcome[] = [];

  for (const definition of due) {
    // A concurrent tick (interval + trigger endpoint) may have started this
    // between selection and now; executeAutomation re-checks the lock.
    ran.push(await executeAutomation(db, definition.id, { trigger: "schedule", nowMs }));
  }

  try {
    pruneAutomationRuns(db, RUN_RETENTION_PER_AUTOMATION);
  } catch (error) {
    logger.warn(`[automation] run pruning failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  try {
    pruneSyncFlowRuns(db, RUN_RETENTION_PER_SYNC_FLOW);
  } catch (error) {
    logger.warn(`[automation] sync flow run pruning failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  try {
    // Reclaims pages the two prunes above just freed. A no-op (and cheap) when
    // auto_vacuum isn't INCREMENTAL yet or there is nothing pending; bounded
    // per tick so a large backlog reclaims gradually instead of stalling one.
    db.pragma("incremental_vacuum(1000)");
    // ...and settle it onto the disk. In WAL mode both the pruning above and
    // the vacuum land in the write-ahead log, not the database file: without a
    // checkpoint the file never shrinks by a byte and the WAL grows without
    // bound instead, which is how an install ends up with a 160 MB log in front
    // of 9 MB of data. TRUNCATE is what returns the log's own space too.
    // Reports busy and changes nothing if a reader is mid-flight.
    db.pragma("wal_checkpoint(TRUNCATE)");
  } catch (error) {
    logger.warn(`[automation] incremental vacuum failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  return { at, due: due.length, ran };
}

/**
 * Give every registered job type a chance to reconcile.
 *
 * Called at the top of every tick, and again by the read paths that show
 * automations to a person: polling for a change someone just made is how a page
 * ends up telling them their new sync flow does not exist. It is idempotent and
 * costs two queries, so doing it on read buys correctness cheaply.
 *
 * One failing type must not stop anything: the others still have work to do,
 * and a reconciliation problem is not a reason to stop running automations that
 * are already configured, nor to fail a read.
 */
export async function reconcileJobTypes(db: SqliteDatabase): Promise<void> {
  for (const jobType of listAutomationJobTypes()) {
    if (!jobType.reconcile) continue;
    try {
      await jobType.reconcile(db);
    } catch (error) {
      logger.warn(
        `[automation] ${jobType.type} could not reconcile: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}

/** Request cancellation of an automation's in-flight run. */
export function cancelAutomation(automationId: string): boolean {
  const entry = runControllers().get(automationId);
  if (!entry) return false;
  entry.controller.abort({ code: "CANCELLED" } satisfies AbortReason);
  return true;
}

/**
 * Request cancellation of one run. A job that honours its signal stops on its
 * own; in a worker, one that does not is ended after a grace period. False when
 * the run is not in progress in this process.
 */
export function cancelRun(runId: string): boolean {
  for (const [automationId, entry] of runControllers()) {
    if (entry.runId === runId) return cancelAutomation(automationId);
  }
  return false;
}

/**
 * Is a run in progress anywhere?
 *
 * The in-memory set only knows about runs started in *this* module instance —
 * the same limitation that made an in-memory lock unsafe — so a definition's
 * claim is what a route handler must actually read. Without this, the UI showed
 * "not running" for a run the interval loop was executing, and offered a Run
 * now button that would be refused.
 */
export function isAutomationRunning(automation: string | AutomationDefinition): boolean {
  if (typeof automation !== "string") {
    return automation.runningSince !== null || inFlight.has(automation.id);
  }
  return inFlight.has(automation);
}

/** Ids running in this process. Callers with definitions should prefer
 * `isAutomationRunning`, which also sees runs claimed elsewhere. */
export function runningAutomationIds(): string[] {
  return [...inFlight];
}

/** Latest run per automation, for list views. */
export function latestRuns(db: SqliteDatabase, automationIds: string[]): Map<string, AutomationRun> {
  const map = new Map<string, AutomationRun>();
  for (const id of automationIds) {
    const [latest] = listAutomationRuns(db, { automationId: id, limit: 1 });
    if (latest) map.set(id, latest);
  }
  return map;
}

/** Test-only: clear process-local engine state between cases. */
export function __resetEngineStateForTests(): void {
  inFlight.clear();
  runControllers().clear();
}
