"use client";

import { withTimeout } from "../runtime/timeouts";

export {
  DEFAULT_STEP_TIMEOUT_MS,
  SHUTDOWN_STEP_TIMEOUT_MS,
  normalizeUrl,
  withTimeout,
} from "../runtime/timeouts";

type ActualInitConfig = {
  dataDir?: string;
  serverURL: string;
  password: string;
  verbose?: boolean;
};

type ActualInitCapable = {
  init(config: ActualInitConfig): Promise<unknown>;
};

let initializeActualApiTail: Promise<unknown> = Promise.resolve();

// Serialize init calls so overlapping connects can't interleave inside the
// Actual API worker. Since 26.8.0 the browser build ships a fully self-contained
// worker (worker code, sql-wasm, and the default DB are inlined as data URLs),
// so no Worker/asset shimming is needed — we just run init under a timeout.
export function initializeActualApi<TActual extends ActualInitCapable>(
  actual: TActual,
  config: ActualInitConfig
): Promise<Awaited<ReturnType<TActual["init"]>>> {
  // The caller-facing promise races a timeout, but the queue must stay gated on
  // the *real* init settling. If we advanced the queue on the timeout, a later
  // connect could start a second init while the first is still running inside
  // the worker — the exact interleave this serialization prevents.
  let initSettled: Promise<unknown> = Promise.resolve();
  const run = () => {
    const initPromise = actual.init(config);
    initSettled = initPromise.then(
      () => undefined,
      () => undefined
    );
    return withTimeout(
      initPromise,
      "Initializing browser API worker"
    ) as Promise<Awaited<ReturnType<TActual["init"]>>>;
  };
  const result = initializeActualApiTail.then(run, run);
  initializeActualApiTail = result
    .catch(() => undefined)
    .then(() => initSettled);
  return result;
}

export async function loadActualApi<TActual>(): Promise<TActual> {
  const actual = await import("@actual-app/api");
  return actual as unknown as TActual;
}
