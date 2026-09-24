import { getAutomation } from "@/lib/app-db/automationRepository";
import { getSyncCredential, hasSyncCredential } from "@/lib/credentials/unattendedCredentials";
import { vaultEnabled } from "@/lib/sync/vault";
import { getAutomationJobType } from "./registry";
import { createRunLogger, redactSecrets, type RunLogEntry } from "./runLogger";
import type { AutomationCredentials, AutomationJobType, AutomationRunPhase } from "./registry";
import type { AutomationDefinition, AutomationRunRollup, JsonEnvelope, SqliteDatabase } from "@/lib/app-db/types";

/**
 * Running one job, the same way wherever it runs (RD-095).
 *
 * The engine decides *whether* and *when* a job runs and records what came of
 * it; this module is the part in between - load the definition, open the
 * credentials, run the job type, reduce its result - and nothing else. It is
 * written once and called from two places: in the server's own thread
 * (`inThreadExecutor`) and inside a worker thread (`taskHost`). Keeping it the
 * same code is what lets the worker path be trusted on the strength of the
 * tests that exercise it in-thread.
 *
 * Everything that leaves here is already redacted: a worker returns this
 * outcome across a thread boundary, and secrets never cross one.
 */

/** Why a run was stopped from outside rather than finishing on its own. */
export type StopCode =
  | "TIMEOUT"
  | "OUT_OF_MEMORY"
  | "CANCELLED"
  | "WORKER_DIED"
  | "NO_CAPACITY"
  | "WORKER_UNAVAILABLE";

export type JobExecutionOutcome =
  /** The job ran to the end (a job that honoured a cancel ends here too, `aborted`). */
  | {
      kind: "completed";
      rollup: AutomationRunRollup;
      result: JsonEnvelope;
      log: RunLogEntry[];
      aborted: boolean;
    }
  /** The job threw. `message` is redacted. */
  | { kind: "threw"; message: string; log: RunLogEntry[] }
  /** Stopped from outside - deadline, forced cancel, a dead worker - in `phase`. */
  | { kind: "stopped"; code: StopCode; phase: AutomationRunPhase; message: string; log: RunLogEntry[] };

export type JobExecutionRequest = {
  automationId: string;
  runId: string;
  attempt: number;
  input: JsonEnvelope | null;
};

export type JobExecutionHooks = {
  signal: AbortSignal;
  /** Called each time the job moves forward a phase. */
  onPhase(phase: AutomationRunPhase): void;
};

/**
 * Resolve the credentials a run may use — or refuse to run.
 *
 * Fail-closed is enforced here rather than left to each job type: an automation
 * that names a credential it cannot get does not execute at all, so a job can
 * never half-run against a partially available secret. The engine asks before
 * it claims a run; the job asks again where it runs, because a worker cannot be
 * handed the decrypted value.
 */
export function resolveCredentials(db: SqliteDatabase, definition: AutomationDefinition): AutomationCredentials {
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

export async function executeJob(
  db: SqliteDatabase,
  request: JobExecutionRequest,
  hooks: JobExecutionHooks
): Promise<JobExecutionOutcome> {
  const definition = getAutomation(db, request.automationId);
  if (!definition) {
    return { kind: "threw", message: "This automation no longer exists.", log: [] };
  }
  const jobType = getAutomationJobType(definition.type) as AutomationJobType<unknown, unknown> | undefined;
  if (!jobType) {
    return { kind: "threw", message: `No job type registered for "${definition.type}"`, log: [] };
  }

  const runLogger = createRunLogger({ automationId: definition.id, type: definition.type, runId: request.runId });
  const secrets: string[] = [];
  const credentials = resolveCredentials(db, definition);

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

  let phase: AutomationRunPhase = "reading";
  const enterPhase = (next: AutomationRunPhase): void => {
    // Forward only: once a run may have changed something, nothing it does
    // later makes that untrue.
    if (next === "reading" || next === phase) return;
    phase = next;
    hooks.onPhase(next);
  };

  try {
    const config = jobType.validateConfig(definition.config);
    const result = await jobType.run({
      definition,
      config,
      credentials: guardedCredentials,
      attempt: request.attempt,
      input: request.input,
      signal: hooks.signal,
      logger: runLogger,
      reportProgress: () => {},
      enterPhase,
    });

    return {
      kind: "completed",
      rollup: jobType.summarize(result),
      result: jobType.serializeResult(result),
      log: runLogger.entries(),
      aborted: hooks.signal.aborted,
    };
  } catch (error) {
    const message = redactSecrets(error instanceof Error ? error.message : String(error), secrets);
    runLogger.error(message);
    return { kind: "threw", message, log: runLogger.entries() };
  }
}
