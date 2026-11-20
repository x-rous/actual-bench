import { getAutomationExecutor } from "@/lib/automation/executor";
import { logger } from "@/lib/logger";
import { runWorkerTask } from "@/lib/workers/supervisor";

/**
 * Running a Backups-page task where it belongs (RD-077). Server-only.
 *
 * With worker threads on - the default - the task runs in a disposable worker
 * (`workerTasks.ts`) and the web server's thread stays free. With
 * `ACTUAL_BENCH_AUTOMATION_EXECUTOR=in-thread` (tests, and installs that
 * turned workers off) the same function runs here instead, exactly as the
 * automation engine does.
 */

export type BackupTaskResult<T> = { ok: true; value: T } | { ok: false; status: number; message: string };

export async function runBackupTask<T>(input: {
  kind: string;
  taskInput: object;
  deadlineMs: number;
  /** The same work, in this thread. */
  inThread: (signal: AbortSignal) => Promise<T>;
}): Promise<BackupTaskResult<T>> {
  const signal = AbortSignal.timeout(input.deadlineMs);

  if (getAutomationExecutor().name !== "worker") {
    try {
      return { ok: true, value: await input.inThread(signal) };
    } catch (error) {
      return { ok: false, status: 502, message: error instanceof Error ? error.message : String(error) };
    }
  }

  const outcome = await runWorkerTask(input.kind, input.taskInput, { signal });
  if (outcome.status === "result") return { ok: true, value: outcome.output as T };
  if (outcome.status === "error") return { ok: false, status: 502, message: outcome.message };
  if (outcome.code === "NO_CAPACITY") {
    return { ok: false, status: 503, message: "Bench is busy running automations. Try again in a minute." };
  }
  if (outcome.code === "TIMEOUT") {
    return { ok: false, status: 504, message: "This took longer than Bench allows and was stopped." };
  }
  logger.warn(`[${input.kind}] worker stopped: ${outcome.message}`);
  return { ok: false, status: 502, message: outcome.message };
}

/**
 * Rules with a run started from the page and not yet finished.
 *
 * A manual rule has no automation, so nothing else stops two presses of
 * "Back up now" from running two backups side by side. Process-wide on
 * purpose, kept on `globalThis` so every route module instance sees one set.
 */
const KEY = Symbol.for("actual-bench.backup.manualRunsInFlight");
type Holder = { [KEY]?: Set<string> };

export function manualRunsInFlight(): Set<string> {
  const holder = globalThis as Holder;
  holder[KEY] ??= new Set<string>();
  return holder[KEY];
}
