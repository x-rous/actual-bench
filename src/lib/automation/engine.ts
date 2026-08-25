import {
  claimAutomation,
  getAutomation,
  listAutomations,
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
import { getSyncCredential, hasSyncCredential } from "@/lib/app-db/syncCredentialRepository";
import { vaultEnabled } from "@/lib/sync/vault";
import { logger } from "@/lib/logger";
import { getAutomationJobType } from "./registry";
import { createRunLogger } from "./runLogger";
import { effectiveNextRunAt, isDue } from "./schedule";
import type { AutomationCredentials, AutomationJobType } from "./registry";
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

/** Cancellation handles for in-flight runs, so a stop request can reach them. */
const cancellations = new Map<string, AbortController>();

export type EngineRunOutcome = {
  automationId: string;
  runId: string | null;
  status: AutomationRunStatus | "skipped";
  message?: string;
};

export type TickSummary = {
  at: string;
  due: number;
  ran: EngineRunOutcome[];
};

/**
 * Resolve the credentials a run may use — or refuse to run.
 *
 * Fail-closed is enforced here rather than left to each job type: an automation
 * that names a credential it cannot get does not execute at all, so a job can
 * never half-run against a partially available secret.
 */
export function resolveCredentials(
  db: SqliteDatabase,
  definition: AutomationDefinition
): AutomationCredentials {
  if (definition.executionMode === "browser") return { status: "not-required" };
  if (!definition.credentialRef) return { status: "not-required" };

  if (!vaultEnabled()) {
    return { status: "unavailable", reason: "The credential vault is disabled (SYNC_VAULT_KEY is not set)." };
  }
  if (!hasSyncCredential(db, definition.credentialRef)) {
    return {
      status: "unavailable",
      reason: "No stored credential for this connection. Re-enrol it to run unattended.",
    };
  }

  const credentialRef = definition.credentialRef;
  return {
    status: "resolved",
    serverFingerprint: credentialRef,
    // Opened only if the job actually asks, so the decrypted value never sits
    // in a context object that could be logged or serialized into a result.
    reveal: () => {
      const credential = getSyncCredential(db, credentialRef);
      if (!credential) {
        throw new Error("The stored credential disappeared between checking and using it.");
      }
      return credential.secret;
    },
  };
}

/**
 * Re-exported so callers reason about backoff in one place. The delay is
 * enforced by `isDue` at selection time, not merely stored on the row.
 */
export { backoffDelayMinutes } from "./schedule";

function errorEnvelope(error: unknown, secrets: readonly string[]): JsonEnvelope {
  const message = error instanceof Error ? error.message : String(error);
  return { version: 1, data: { message: redact(message, secrets) } };
}

function redact(message: string, secrets: readonly string[]): string {
  // The run logger owns the real redaction; this is the same treatment for the
  // error stored on the run row, which never goes through the logger.
  let output = message;
  for (const secret of secrets) {
    if (secret.length >= 8) output = output.split(secret).join("[redacted]");
  }
  return output;
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
};

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
  const definition = getAutomation(db, automationId);
  if (!definition) {
    return { automationId, runId: null, status: "skipped", message: "Automation not found" };
  }

  if (inFlight.has(automationId)) {
    return { automationId, runId: null, status: "skipped", message: "A run is already in progress" };
  }

  const jobType = getAutomationJobType(definition.type) as AutomationJobType<unknown, unknown> | undefined;
  if (!jobType) {
    // An unknown type is a deployment problem, not a job failure: pause it so
    // it stops re-firing every minute, and say exactly what is missing.
    pauseAutomationForHealth(
      db,
      automationId,
      new Date(options.nowMs ?? Date.now()).toISOString(),
      `No job type registered for "${definition.type}"`
    );
    return { automationId, runId: null, status: "skipped", message: `Unknown job type ${definition.type}` };
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
    return { automationId, runId: null, status: "skipped", message: credentials.reason };
  }

  // Take the claim in the database, not only in memory. Next may evaluate a
  // route module separately from the server boot context, so the external-cron
  // trigger endpoint and the interval loop can hold *different* `inFlight` sets
  // — an in-memory lock alone would let the same automation apply its writes
  // twice. The in-memory set stays as a cheap first check and for `running`.
  if (!claimAutomation(db, automationId, new Date(options.nowMs ?? Date.now()).toISOString())) {
    return { automationId, runId: null, status: "skipped", message: "A run is already in progress" };
  }

  inFlight.add(automationId);
  const controller = new AbortController();
  cancellations.set(automationId, controller);

  const attempt = options.attempt ?? 1;
  const startedAt = new Date(options.nowMs ?? Date.now()).toISOString();
  const run = createAutomationRun(db, {
    automationId,
    type: definition.type,
    status: "running",
    startedAt,
    trigger: options.trigger ?? "schedule",
    attempt,
    executionMode: definition.executionMode,
  });

  const runLogger = createRunLogger({ automationId, type: definition.type, runId: run.id });
  const secrets: string[] = [];

  // Any secret a job actually opens is registered for redaction at the moment
  // it is revealed, so a provider error that echoes the key back cannot reach
  // the log or the stored error. The job type does not have to remember to do
  // this — it cannot get the secret without going through here.
  const guardedCredentials: AutomationCredentials =
    credentials.status === "resolved"
      ? {
          ...credentials,
          reveal: () => {
            const secret = credentials.reveal();
            for (const value of [secret.apiKey, secret.encryptionPassword]) {
              if (value) {
                secrets.push(value);
                runLogger.protect(value);
              }
            }
            return secret;
          },
        }
      : credentials;

  try {
    const config = jobType.validateConfig(definition.config);
    const result = await jobType.run({
      definition,
      config,
      credentials: guardedCredentials,
      attempt,
      signal: controller.signal,
      logger: runLogger,
      reportProgress: () => {},
    });

    const rollup = jobType.summarize(result);
    const status = controller.signal.aborted ? "cancelled" : statusFromRollup(rollup);

    finalizeAutomationRun(db, run.id, {
      status,
      result: withLog(jobType.serializeResult(result), runLogger.entries()),
      rollup,
    });

    const finishedAt = new Date().toISOString();
    const success = isHealthySuccess(status, rollup);
    const updated = recordAutomationOutcome(db, automationId, { success, at: finishedAt });
    applyHealthPolicy(db, updated ?? definition, success, rollup.message);
    scheduleNext(db, automationId, options.nowMs ?? Date.now());

    return { automationId, runId: run.id, status, message: rollup.message };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    runLogger.error(message);

    finalizeAutomationRun(db, run.id, {
      status: "failed",
      error: errorEnvelope(error, secrets),
      result: withLog(null, runLogger.entries()),
      rollup: { outcome: "failed", itemCount: 0, message: redact(message, secrets).slice(0, 500) },
    });

    const updated = recordAutomationOutcome(db, automationId, { success: false, at: new Date().toISOString() });
    // Redacted, like the log and the stored error: the pause reason is shown in
    // the UI and returned by the health route, so a provider error echoing an
    // API key must not reach it either.
    const safeMessage = redact(message, secrets);
    applyHealthPolicy(db, updated ?? definition, false, safeMessage);
    scheduleNext(db, automationId, options.nowMs ?? Date.now());

    return { automationId, runId: run.id, status: "failed", message: safeMessage };
  } finally {
    inFlight.delete(automationId);
    cancellations.delete(automationId);
    releaseAutomationClaim(db, automationId);
  }
}

/** Store the run's redacted log lines alongside the type's own result. */
function withLog(result: JsonEnvelope | null, entries: ReturnType<ReturnType<typeof createRunLogger>["entries"]>): JsonEnvelope {
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
export async function runEngineTick(
  db: SqliteDatabase,
  options: { nowMs?: number } = {}
): Promise<TickSummary> {
  const nowMs = options.nowMs ?? Date.now();
  const at = new Date(nowMs).toISOString();
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

  return { at, due: due.length, ran };
}

/** Request cancellation of an in-flight run. */
export function cancelAutomation(automationId: string): boolean {
  const controller = cancellations.get(automationId);
  if (!controller) return false;
  controller.abort();
  return true;
}

export function isAutomationRunning(automationId: string): boolean {
  return inFlight.has(automationId);
}

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
  cancellations.clear();
}
