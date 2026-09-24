import type { AutomationRun } from "@/lib/app-db/types";

/**
 * Follow a run started by "Run now" until it ends (F-191).
 *
 * The Run-now routes answer with a run id as soon as the run exists instead of
 * holding the request open for the whole run. Callers await this, so a button
 * stays in its running state and shows the same outcome it always did; only
 * the transport changed. If the page goes away, the run still finishes and
 * lands in run history.
 */

/** Poll quickly at first, when most runs finish, then settle to a slower pace. */
const FAST_POLL_MS = 1_000;
const FAST_PHASE_MS = 10_000;
const SLOW_POLL_MS = 2_000;

/**
 * Longest a page waits before handing the run over to run history. Generous:
 * a large backup can take many minutes, and giving up early would report a
 * run as unfinished when it was merely slow.
 */
export const DEFAULT_RUN_WAIT_MS = 60 * 60_000;

/**
 * How many reads in a row may fail before the page gives up following a run.
 * A wait can last an hour, so a single network blip or a moment when the app
 * database is busy must not turn a run that is still going into an error on
 * screen. A missing run (404) is a real answer and ends the wait at once.
 */
const MAX_CONSECUTIVE_READ_FAILURES = 5;

/** A failed read of a run, carrying the HTTP status when there was one. */
export class RunReadError extends Error {
  constructor(
    message: string,
    readonly status: number | null
  ) {
    super(message);
    this.name = "RunReadError";
  }
}

export class RunStillGoingError extends Error {
  constructor(readonly runId: string) {
    super("The run is still going. Its result will appear in run history when it finishes.");
    this.name = "RunStillGoingError";
  }
}

type WaitOptions = {
  maxWaitMs?: number;
  /** Called once the run exists, with its id - so a page can show it as running (and cancellable) at once. */
  onStarted?: (runId: string) => void;
  /** Injected in tests; defaults to real timers. */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

async function readRun(runId: string): Promise<AutomationRun> {
  let response: Response;
  try {
    response = await fetch(`/api/automations/runs/${encodeURIComponent(runId)}`, { cache: "no-store" });
  } catch (error) {
    throw new RunReadError(error instanceof Error ? error.message : "Could not reach the server", null);
  }
  if (!response.ok) {
    let message = `Could not read the run (${response.status})`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // Keep the status-code message.
    }
    throw new RunReadError(message, response.status);
  }
  return ((await response.json()) as { run: AutomationRun }).run;
}

export async function waitForRun(runId: string, options: WaitOptions = {}): Promise<AutomationRun> {
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = options.now ?? Date.now;
  const startedAt = now();
  const deadline = startedAt + (options.maxWaitMs ?? DEFAULT_RUN_WAIT_MS);

  let failures = 0;

  for (;;) {
    let run: AutomationRun | null = null;
    try {
      run = await readRun(runId);
      failures = 0;
    } catch (error) {
      failures += 1;
      const missing = error instanceof RunReadError && error.status === 404;
      if (missing || failures >= MAX_CONSECUTIVE_READ_FAILURES) throw error;
    }
    if (run && run.status !== "running") return run;

    const elapsed = now() - startedAt;
    const delay = elapsed < FAST_PHASE_MS ? FAST_POLL_MS : SLOW_POLL_MS;
    if (now() + delay > deadline) throw new RunStillGoingError(runId);
    await sleep(delay);
  }
}

/**
 * Start a run through a Run-now route and wait for it: the route answers 202
 * with `{ runId }`. Any other answer is an error carrying the route's message.
 */
export async function startAndWaitForRun(
  url: string,
  init: RequestInit,
  options: WaitOptions = {}
): Promise<AutomationRun> {
  const response = await fetch(url, init);
  if (response.status !== 202) {
    let message = `Request failed (${response.status})`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // Keep the status-code message.
    }
    throw new Error(message);
  }
  const { runId } = (await response.json()) as { runId: string };
  options.onStarted?.(runId);
  return waitForRun(runId, options);
}
