import { runWorkerTask, workerAvailability } from "@/lib/workers/supervisor";
import { executeJob, type JobExecutionOutcome, type JobExecutionRequest, type StopCode } from "./jobExecution";
import type { SqliteDatabase } from "@/lib/app-db/types";

/**
 * Where a job actually runs (RD-095).
 *
 * The engine hands every run to an executor and records whatever comes back,
 * so it neither knows nor cares whether the job ran in this thread or another.
 * Two exist:
 *
 *   * `worker` - the default. Each run gets a worker thread of its own: its own
 *     heap, a deadline that can actually stop it, and a crash that ends only
 *     that run.
 *   * `in-thread` - the job runs in the server's own thread, as it did before
 *     workers. Used by the test suite, and available to operators on a
 *     platform that cannot start worker threads, through
 *     `ACTUAL_BENCH_AUTOMATION_EXECUTOR=in-thread`. A deadline there can only
 *     ask a job to stop; it cannot end one that will not.
 *
 * Choosing is explicit. When workers cannot start, runs stop with a reason in
 * App Health; nothing falls back to in-thread on its own.
 */

export type ExecutorAvailability = { ok: true } | { ok: false; code: StopCode; message: string };

export type AutomationExecutor = {
  readonly name: "in-thread" | "worker";
  /** Can a run start now? Asked before a run is claimed. */
  availability(): ExecutorAvailability;
  /**
   * Run one job. Must start synchronously - take any capacity before the
   * first `await` - so an `availability()` answer cannot go stale in between.
   */
  execute(db: SqliteDatabase, request: JobExecutionRequest, signal: AbortSignal): Promise<JobExecutionOutcome>;
};

export const inThreadExecutor: AutomationExecutor = {
  name: "in-thread",
  availability: () => ({ ok: true }),
  execute: (db, request, signal) => executeJob(db, request, { signal, onPhase: () => {} }),
};

function isJobOutcome(value: unknown): value is JobExecutionOutcome {
  const kind = (value as { kind?: unknown } | null)?.kind;
  return kind === "completed" || kind === "threw" || kind === "stopped";
}

export const workerExecutor: AutomationExecutor = {
  name: "worker",
  availability: workerAvailability,
  async execute(_db, request, signal) {
    // The worker opens its own connection to the app database; nothing but
    // this plain, secret-free request crosses into it.
    const outcome = await runWorkerTask("automation.run", request, { signal });
    switch (outcome.status) {
      case "result":
        return isJobOutcome(outcome.output)
          ? outcome.output
          : { kind: "threw", message: "The worker returned an answer Bench could not read.", log: [] };
      case "error":
        return { kind: "threw", message: outcome.message, log: [] };
      case "stopped":
        return { kind: "stopped", code: outcome.code, phase: outcome.phase, message: outcome.message, log: [] };
    }
  },
};

/** The executor this process uses, per `ACTUAL_BENCH_AUTOMATION_EXECUTOR` (default `worker`). */
export function getAutomationExecutor(): AutomationExecutor {
  return process.env.ACTUAL_BENCH_AUTOMATION_EXECUTOR === "in-thread" ? inThreadExecutor : workerExecutor;
}
