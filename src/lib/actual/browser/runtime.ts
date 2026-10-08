"use client";

import { useConnectionStore, type BrowserApiConnection } from "@/store/connection";
import type { ActualApi, ActualApiRuntime } from "../runtime/types";
import { exportRuntimeBudget } from "../runtime/archive";
import { assertDirectBrowserApiEnvironment } from "./environment";
import { runtimeTiming } from "../runtime/diagnostics";
import {
  SHUTDOWN_STEP_TIMEOUT_MS,
  initializeActualApi,
  loadActualApi,
  normalizeUrl,
  withTimeout,
} from "./setup";

export type {
  ActualApi as ActualBrowserApi,
  ActualApiInitResult as ActualBrowserApiInitResult,
  ActualApiRuntime as ActualBrowserApiRuntime,
  ActualApiSend as ActualBrowserApiSend,
  ActualQueryBuilder,
  ApiImportTransaction,
  ApiTransaction,
} from "../runtime/types";

type ActiveRuntime = {
  key: string;
  promise: Promise<ActualApiRuntime>;
};

/** The runtime holding (or opening) the budget requests are served from. */
let activeRuntime: ActiveRuntime | null = null;
/** The last runtime started, even if it failed: the next one shuts it down first. */
let lastStarted: ActiveRuntime | null = null;
/** Explicit opens in progress (connect, switch, reconnect, resume). */
let explicitOpens = 0;
let syncQueue = Promise.resolve();

/** A newer open took the runtime while this one was still on its way. */
class SupersededOpenError extends Error {}

/** A request for a budget that isn't the open one, while it may not take over. */
export class BudgetNotOpenError extends Error {
  constructor(label: string) {
    super(`${label} isn't open right now. Switch to it to use it.`);
  }
}

function runtimeKey(connection: BrowserApiConnection): string {
  return JSON.stringify({
    id: connection.id,
    baseUrl: normalizeUrl(connection.baseUrl),
    budgetSyncId: connection.budgetSyncId,
    serverPassword: connection.serverPassword,
    encryptionPassword: connection.encryptionPassword ?? "",
  });
}

/**
 * Stop whatever the tab's one Actual runtime is doing, whether its open worked,
 * failed or timed out. A timeout only stops Bench waiting: the work carries on
 * inside the worker, and the next budget must not start beside it.
 */
async function shutdownRuntime(runtime: ActiveRuntime): Promise<void> {
  await runtime.promise.catch(() => undefined);
  try {
    const actual = await loadActualApi<ActualApi>();
    await withTimeout(actual.shutdown(), "Shutting down browser API", SHUTDOWN_STEP_TIMEOUT_MS);
  } catch {
    // Never initialised, or already shut down: nothing left running.
  }
}

export function clearBrowserApiRuntimeCache(): void {
  const runtime = activeRuntime;
  activeRuntime = null;
  if (runtime) void shutdownRuntime(runtime);
}

/** The browser event Bench raises when Actual reports its local copy of the budget damaged. */
export const DAMAGED_COPY_EVENT = "actual-bench:damaged-copy";

/**
 * Every runtime call reports "database disk image is malformed" (this browser's copy of the budget
 * is damaged, usually after two tabs wrote to it) as a browser event, so the app can offer to
 * reload the budget from the server; the error itself still reaches the caller.
 */
function reportIfDamaged(error: unknown): void {
  if (typeof window !== "undefined" && /database disk image is malformed/i.test(error instanceof Error ? error.message : String(error))) {
    window.dispatchEvent(new CustomEvent(DAMAGED_COPY_EVENT));
  }
}

function reportingDamagedCopy<T extends object>(runtime: T): T {
  const out: Record<string, unknown> = { ...(runtime as Record<string, unknown>) };
  for (const [name, value] of Object.entries(runtime)) {
    if (typeof value !== "function") continue;
    // Same shape as the original call (some, like the query builder, return at once): only errors are watched.
    out[name] = (...args: unknown[]) => {
      try {
        const result = (value as (...a: unknown[]) => unknown).apply(runtime, args);
        if (result instanceof Promise) return result.catch((error: unknown) => { reportIfDamaged(error); throw error; });
        return result;
      } catch (error) {
        reportIfDamaged(error);
        throw error;
      }
    };
  }
  return out as T;
}

export async function syncBrowserApiRuntime(
  connection: BrowserApiConnection
): Promise<void> {
  const nextSync = syncQueue.then(async () => {
    const actual = await getBrowserApiRuntime(connection);
    await withTimeout(actual.sync(), "Syncing budget");
  });
  syncQueue = nextSync.catch(() => undefined);
  return nextSync;
}

export async function exportBrowserApiBudgetZip(
  connection: BrowserApiConnection
): Promise<ArrayBuffer> {
  const bytes = await exportRuntimeBudget(await getBrowserApiRuntime(connection));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

/**
 * Open this budget in the tab's runtime, taking it over from whatever budget
 * it holds: the connect, switch, reconnect and resume paths. The newest open
 * wins; an older one still on its way stops at its next step.
 */
export async function ensureBrowserApiBudgetOpen(
  connection: BrowserApiConnection
): Promise<void> {
  explicitOpens += 1;
  try {
    await getBrowserApiRuntime(connection, { open: true });
  } finally {
    explicitOpens -= 1;
  }
}

/**
 * The runtime for this budget. Only an explicit open (see above) may take the
 * runtime from another budget. Ordinary requests may open the *active* budget
 * (after a switch, or when a disconnect leaves another one active), but never
 * while an explicit open is under way, and never a budget that isn't active:
 * a late request from the page being left, or its retry, used to take the
 * runtime back mid-switch, and the two budgets then kept taking it from each
 * other until one timed out.
 */
export async function getBrowserApiRuntime(
  connection: BrowserApiConnection,
  { open = false }: { open?: boolean } = {}
): Promise<ActualApiRuntime> {
  assertDirectBrowserApiEnvironment();

  const key = runtimeKey(connection);
  if (activeRuntime?.key === key) return activeRuntime.promise;

  if (!open) {
    const isActive = useConnectionStore.getState().activeInstanceId === connection.id;
    if (!isActive || explicitOpens > 0) throw new BudgetNotOpenError(connection.label);
  }

  const previous = lastStarted;
  const serverUrl = normalizeUrl(connection.baseUrl);
  const encryptionPassword = connection.encryptionPassword?.trim() || undefined;
  const stillWanted = () => {
    if (activeRuntime?.key !== key) throw new SupersededOpenError("A newer budget is being opened.");
  };

  // Registered before any work starts, so `stillWanted` sees this open.
  const started: ActiveRuntime = { key, promise: Promise.resolve(undefined as never) };
  activeRuntime = started;
  lastStarted = started;

  const promise = (async () => {
    const timing = runtimeTiming("Direct budget open");
    try {
      if (previous) await shutdownRuntime(previous);
      timing.step("previous runtime shutdown");
      stillWanted();

      const actual = await withTimeout(
        loadActualApi<ActualApi>(),
        "Loading @actual-app/api"
      );
      timing.step("load API");
      const initResult = await initializeActualApi(actual, {
        dataDir: "/documents",
        serverURL: serverUrl,
        password: connection.serverPassword,
        verbose: false,
      });
      timing.step("initialize worker");
      stillWanted();
      const runtime: ActualApiRuntime = reportingDamagedCopy({ ...actual, send: initResult.send });
      await withTimeout(
        runtime.downloadBudget(connection.budgetSyncId, { password: encryptionPassword }),
        "Opening budget"
      );
      timing.step("download/open budget");
      stillWanted();
      await withTimeout(runtime.sync(), "Syncing budget");
      timing.step("initial sync");
      return runtime;
    } finally { timing.end(); }
  })();

  started.promise = promise;
  promise.catch(() => {
    if (activeRuntime?.key === key) activeRuntime = null;
  });

  return promise;
}
