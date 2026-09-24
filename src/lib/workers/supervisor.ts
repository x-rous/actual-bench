import { createInterface } from "node:readline";
import type { Readable } from "node:stream";
import { generateId } from "@/lib/uuid";
import { logger } from "@/lib/logger";
import { redactSecrets } from "@/lib/automation/runLogger";
import type { AutomationRunPhase } from "@/lib/automation/registry";
import type { StopCode } from "@/lib/automation/jobExecution";
import { workerToParentMessage } from "./protocol";
import { spawnBenchWorker } from "./spawnBenchWorker";

/**
 * Owns the worker threads (RD-095): how many may run, how much memory each
 * gets, and what happens when one has to be stopped.
 *
 * One per process, on `globalThis`: Next evaluates route modules separately
 * from `instrumentation.ts`, and a "Run now" from a route must count against
 * the same slots as the scheduler's runs. The supervisor only limits
 * *capacity*. Correctness - one run per automation, one request at a time per
 * HTTP server - is held in SQLite (claims, leases), where every thread and
 * module instance sees the same thing.
 *
 * Lifetime policy `run`: a worker is started for one task and gone when it
 * settles. The parent always settles a task, whatever the worker does.
 */

/** The part of `worker_threads.Worker` the supervisor uses, so tests can fake it. */
export type SupervisedWorker = {
  postMessage(message: unknown): void;
  on(event: "message", listener: (message: unknown) => void): unknown;
  on(event: "error", listener: (error: Error & { code?: string }) => void): unknown;
  on(event: "exit", listener: (exitCode: number) => void): unknown;
  terminate(): Promise<number>;
  stdout?: Readable | null;
  stderr?: Readable | null;
};

export type SpawnWorker = (options: { heapMb: number }) => SupervisedWorker;

export type TaskOutcome =
  | { status: "result"; output: unknown }
  /** The task could not run at all; `message` is redacted. */
  | { status: "error"; message: string }
  | { status: "stopped"; code: StopCode; phase: AutomationRunPhase; message: string };

export type PreflightStatus = {
  status: "unknown" | "checking" | "ready" | "failed";
  checkedAt: string | null;
  nodeVersion?: string;
  heapLimitMb?: number;
  error?: string;
};

export type SupervisorStatus = {
  preflight: PreflightStatus;
  slots: { max: number; busy: number };
  lastCrash: { at: string; code: StopCode; message: string } | null;
};

type Settings = {
  maxSlots: number;
  heapMb: number;
  /** After a cancel, how long a task gets to stop on its own before its thread is ended. */
  graceMs: number;
  preflightTimeoutMs: number;
  /** How long after a failed preflight before trying again. */
  preflightRetryMs: number;
  spawn: SpawnWorker;
};

type State = {
  settings: Settings;
  busy: number;
  preflight: PreflightStatus;
  preflightRun: Promise<PreflightStatus> | null;
  lastCrash: SupervisorStatus["lastCrash"];
};

const STATE_KEY = Symbol.for("actual-bench.workerSupervisor");
const PREFLIGHT_TASK_ID = "preflight";

function positiveIntEnv(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function defaultSettings(): Settings {
  return {
    maxSlots: positiveIntEnv("ACTUAL_BENCH_WORKERS_MAX", 2),
    heapMb: positiveIntEnv("ACTUAL_BENCH_WORKER_HEAP_MB", 512),
    graceMs: 10_000,
    preflightTimeoutMs: 20_000,
    preflightRetryMs: 5 * 60_000,
    spawn: spawnBenchWorker,
  };
}

function state(): State {
  const holder = globalThis as { [STATE_KEY]?: State };
  holder[STATE_KEY] ??= {
    settings: defaultSettings(),
    busy: 0,
    preflight: { status: "unknown", checkedAt: null },
    preflightRun: null,
    lastCrash: null,
  };
  return holder[STATE_KEY];
}

/** Forward a worker's own output to the server log, redacted by pattern. */
function forwardOutput(stream: Readable | null | undefined, level: "info" | "warn"): void {
  if (!stream) return;
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  lines.on("line", (line) => {
    if (line.trim()) logger[level](`[worker] ${redactSecrets(line)}`);
  });
}

function stopCodeFrom(signal: AbortSignal): StopCode {
  const code = (signal.reason as { code?: unknown } | undefined)?.code;
  return code === "TIMEOUT" ? "TIMEOUT" : "CANCELLED";
}

/** Can a task start now? Checked before a run is claimed, so a "no" costs nothing. */
export function workerAvailability(): { ok: true } | { ok: false; code: StopCode; message: string } {
  const { settings, busy, preflight } = state();
  if (preflight.status === "failed") {
    return {
      ok: false,
      code: "WORKER_UNAVAILABLE",
      message: `Automations cannot start: worker threads failed their startup check (${preflight.error ?? "unknown reason"}).`,
    };
  }
  if (busy >= settings.maxSlots) {
    return {
      ok: false,
      code: "NO_CAPACITY",
      message: "Bench is busy running other automations. Try again in a moment.",
    };
  }
  return { ok: true };
}

/**
 * Run one task in a new worker thread.
 *
 * Its slot is taken synchronously, before this returns, so a caller that
 * checked `workerAvailability()` in the same turn cannot be beaten to it. When
 * `signal` aborts - a deadline or a cancel - the task is asked to stop, and
 * its thread is ended if it has not stopped after the grace period; `phase`
 * then says how far it had got.
 */
export function runWorkerTask(kind: string, input: unknown, options: { signal: AbortSignal }): Promise<TaskOutcome> {
  const current = state();
  const { settings } = current;
  if (current.busy >= settings.maxSlots) {
    return Promise.resolve({ status: "stopped", code: "NO_CAPACITY", phase: "reading", message: "No worker slot is free." });
  }
  current.busy += 1;

  return new Promise<TaskOutcome>((resolve) => {
    const taskId = generateId();
    let phase: AutomationRunPhase = "reading";
    let settled = false;
    let graceTimer: ReturnType<typeof setTimeout> | null = null;
    let worker: SupervisedWorker;

    const settle = (outcome: TaskOutcome): void => {
      if (settled) return;
      settled = true;
      if (graceTimer) clearTimeout(graceTimer);
      options.signal.removeEventListener("abort", onAbort);
      if (outcome.status === "stopped" && outcome.code !== "TIMEOUT" && outcome.code !== "CANCELLED") {
        current.lastCrash = { at: new Date().toISOString(), code: outcome.code, message: outcome.message };
      }
      // The caller hears the outcome now; the slot is given back only once the
      // thread has actually gone. Slots bound live threads - and their memory -
      // and `terminate()` is asynchronous, so releasing on settle would let a
      // burst of start-and-cancel run more threads than the limit.
      void worker
        .terminate()
        .catch(() => undefined)
        .finally(() => {
          current.busy -= 1;
        });
      resolve(outcome);
    };

    let taskSent = false;

    function onAbort(): void {
      if (settled) return;
      // Not started yet: nothing to ask, and nothing to wait for. Settle now,
      // and the worker is never sent the task.
      if (!taskSent) {
        settle({
          status: "stopped",
          code: stopCodeFrom(options.signal),
          phase: "reading",
          message: "Stopped before it started.",
        });
        return;
      }
      try {
        worker.postMessage({ type: "cancel", taskId });
      } catch {
        // Already gone; the exit handler settles it.
      }
      graceTimer = setTimeout(() => {
        const code = stopCodeFrom(options.signal);
        settle({
          status: "stopped",
          code,
          phase,
          message:
            code === "TIMEOUT"
              ? "Stopped at its deadline."
              : "Cancelled, and stopped because it did not finish on its own.",
        });
      }, settings.graceMs);
    }

    try {
      worker = settings.spawn({ heapMb: settings.heapMb });
    } catch (error) {
      current.busy -= 1;
      settled = true;
      resolve({
        status: "stopped",
        code: "WORKER_UNAVAILABLE",
        phase,
        message: `Could not start a worker thread: ${redactSecrets(error instanceof Error ? error.message : String(error))}`,
      });
      return;
    }

    forwardOutput(worker.stdout, "info");
    forwardOutput(worker.stderr, "warn");

    worker.on("message", (raw) => {
      const parsed = workerToParentMessage.safeParse(raw);
      if (!parsed.success || settled) return;
      const message = parsed.data;
      switch (message.type) {
        case "ready":
          // A cancel or deadline that arrived while the worker was starting
          // has already settled the task; a cancel sent before this point
          // would have reached a worker with no task to cancel.
          if (options.signal.aborted) return;
          taskSent = true;
          worker.postMessage({ type: "task", taskId, kind, input });
          return;
        case "phase":
          if (message.taskId === taskId) phase = message.phase;
          return;
        case "result":
          if (message.taskId === taskId) settle({ status: "result", output: message.output });
          return;
        case "error":
          if (message.taskId === taskId) settle({ status: "error", message: message.message });
          return;
      }
    });

    worker.on("error", (error) => {
      const outOfMemory = error.code === "ERR_WORKER_OUT_OF_MEMORY";
      settle({
        status: "stopped",
        code: outOfMemory ? "OUT_OF_MEMORY" : "WORKER_DIED",
        phase,
        message: outOfMemory
          ? "Ran out of memory. Raise ACTUAL_BENCH_WORKER_HEAP_MB if this budget needs more."
          : `The worker stopped unexpectedly: ${redactSecrets(error.message)}`,
      });
    });

    worker.on("exit", (exitCode) => {
      settle({
        status: "stopped",
        code: "WORKER_DIED",
        phase,
        message: `The worker exited (code ${exitCode}) before finishing.`,
      });
    });

    if (options.signal.aborted) onAbort();
    else options.signal.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Check that a worker thread can start and answer, and remember the answer
 * for health. Runs at engine start; after a failure, again once
 * `preflightRetryMs` has passed. Concurrent callers share one check.
 */
export function ensureWorkerPreflight(nowMs = Date.now()): Promise<PreflightStatus> {
  const current = state();
  if (current.preflightRun) return current.preflightRun;
  const { preflight, settings } = current;
  if (preflight.status === "ready") return Promise.resolve(preflight);
  if (
    preflight.status === "failed" &&
    preflight.checkedAt &&
    nowMs - Date.parse(preflight.checkedAt) < settings.preflightRetryMs
  ) {
    return Promise.resolve(preflight);
  }

  current.preflight = { ...preflight, status: "checking" };
  const run = new Promise<PreflightStatus>((resolve) => {
    let worker: SupervisedWorker | null = null;
    let done = false;
    const finish = (result: PreflightStatus): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      void worker?.terminate().catch(() => undefined);
      current.preflight = result;
      if (result.status === "failed") logger.warn(`[workers] startup check failed: ${result.error}`);
      resolve(result);
    };
    const failed = (error: string): void =>
      finish({ status: "failed", checkedAt: new Date().toISOString(), error: redactSecrets(error) });

    const timer = setTimeout(
      () => failed(`no answer within ${Math.round(settings.preflightTimeoutMs / 1000)}s`),
      settings.preflightTimeoutMs
    );

    try {
      worker = settings.spawn({ heapMb: settings.heapMb });
    } catch (error) {
      failed(error instanceof Error ? error.message : String(error));
      return;
    }
    forwardOutput(worker.stderr, "warn");
    // Ready is not enough: a worker that starts but cannot run a job - it
    // failed exactly that way once - must fail the check here, at startup,
    // not at the first scheduled run. So it is given the self-test task too.
    let announced: { nodeVersion: string; heapLimitMb: number } | null = null;
    worker.on("message", (raw) => {
      const parsed = workerToParentMessage.safeParse(raw);
      if (!parsed.success) return;
      const message = parsed.data;
      if (message.type === "ready") {
        announced = { nodeVersion: message.nodeVersion, heapLimitMb: message.heapLimitMb };
        worker?.postMessage({ type: "task", taskId: PREFLIGHT_TASK_ID, kind: "preflight", input: null });
      } else if (message.type === "result" && message.taskId === PREFLIGHT_TASK_ID && announced) {
        finish({ status: "ready", checkedAt: new Date().toISOString(), ...announced });
      } else if (message.type === "error" && message.taskId === PREFLIGHT_TASK_ID) {
        failed(`the worker started but could not run its self-test: ${message.message}`);
      }
    });
    worker.on("error", (error) => failed(error.message));
    worker.on("exit", (exitCode) => failed(`exited with code ${exitCode} before answering`));
  });
  // Cleared once settled, not from inside: a worker that cannot even be
  // started fails synchronously, before this assignment, and clearing it from
  // there would leave a finished check recorded as still in progress forever.
  current.preflightRun = run;
  void run.then(() => {
    if (current.preflightRun === run) current.preflightRun = null;
  });
  return run;
}

export function workerSupervisorStatus(): SupervisorStatus {
  const { settings, busy, preflight, lastCrash } = state();
  return { preflight, slots: { max: settings.maxSlots, busy }, lastCrash };
}

/** Test-only: replace settings (a fake `spawn`, short timers) and reset state. */
export function __configureWorkerSupervisorForTests(overrides: Partial<Settings> = {}): void {
  const holder = globalThis as { [STATE_KEY]?: State };
  holder[STATE_KEY] = {
    settings: { ...defaultSettings(), ...overrides },
    busy: 0,
    preflight: { status: "unknown", checkedAt: null },
    preflightRun: null,
    lastCrash: null,
  };
}
