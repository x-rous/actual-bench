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

export class RunStillGoingError extends Error {
  constructor(readonly runId: string) {
    super("The run is still going. Its result will appear in run history when it finishes.");
    this.name = "RunStillGoingError";
  }
}

type WaitOptions = {
  maxWaitMs?: number;
  /** Injected in tests; defaults to real timers. */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

async function readRun(runId: string): Promise<AutomationRun> {
  const response = await fetch(`/api/automations/runs/${encodeURIComponent(runId)}`, { cache: "no-store" });
  if (!response.ok) {
    let message = `Could not read the run (${response.status})`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // Keep the status-code message.
    }
    throw new Error(message);
  }
  return ((await response.json()) as { run: AutomationRun }).run;
}

export async function waitForRun(runId: string, options: WaitOptions = {}): Promise<AutomationRun> {
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = options.now ?? Date.now;
  const startedAt = now();
  const deadline = startedAt + (options.maxWaitMs ?? DEFAULT_RUN_WAIT_MS);

  for (;;) {
    const run = await readRun(runId);
    if (run.status !== "running") return run;

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
  return waitForRun(runId, options);
}
