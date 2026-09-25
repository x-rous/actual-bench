import { isMainThread, threadId } from "node:worker_threads";
import { getAppDb } from "@/lib/app-db/connection";
import { getLastSnapshotAt, recordSnapshotUploaded } from "@/lib/app-db/budgetRuntimeStateRepository";
import { logger } from "@/lib/logger";
import { serverFingerprint } from "@/lib/sync/connectionRef";
import type { BrowserApiConnection } from "@/store/connection";
import { exportRuntimeBudget } from "./archive";
import { toActualRuntimeError } from "./errors";
import { SHUTDOWN_STEP_TIMEOUT_MS, normalizeUrl, withTimeout } from "./timeouts";
import type { ActualApi, ActualApiRuntime, ActualRuntimeHost } from "./types";
import { WORKSPACE_HEARTBEAT_MS, createWorkspace, removeWorkspace, touchWorkspace } from "./workspace";

/**
 * The Direct transport's host inside an automation worker (RD-095 M3).
 *
 * The Node build of `@actual-app/api` has the same methods as the browser
 * build, so this mirrors `browser/runtime.ts`: one open budget per worker, and
 * a connection with a different key switches it - `shutdown` → `init` →
 * `downloadBudget` → `sync` (Pattern A). A Direct→Direct flow therefore opens
 * its two budgets one after the other inside one worker, as the tab does.
 *
 * **Workers only.** `@actual-app/api` keeps its runtime in module globals, and
 * a budget in memory is tens to hundreds of megabytes; in the web server's own
 * thread that would be shared by every request and bounded by nothing. A
 * worker has its own heap with a limit, and is thrown away after the task.
 *
 * Every budget is downloaded fresh into this worker's own workspace and the
 * workspace is deleted when the task ends (`closeNodeRuntime`). The snapshot
 * refresh is what keeps a fresh download cheap.
 *
 * Server-only.
 */

/**
 * Step limits in a worker. The browser gives each step 45 seconds; a worker
 * does not need to, because every task already has a deadline of its own that
 * ends the thread. A budget whose server snapshot is old replays every change
 * since, which can take minutes, and it only gets a fresh snapshot after an
 * open succeeds - so a short limit here could leave it unable to open at all.
 */
const OPEN_STEP_TIMEOUT_MS = 20 * 60_000;
const SYNC_STEP_TIMEOUT_MS = 5 * 60_000;
const EXPORT_STEP_TIMEOUT_MS = 10 * 60_000;

/** Actual's own clients refresh a budget's snapshot at most this often. */
export const SNAPSHOT_REFRESH_INTERVAL_MS = 7 * 24 * 60 * 60_000;

export type SnapshotStore = {
  lastSnapshotAt(key: { serverFingerprint: string; budgetSyncId: string }): string | null;
  recordSnapshot(key: { serverFingerprint: string; budgetSyncId: string }, at: string): void;
};

const appDbSnapshotStore: SnapshotStore = {
  lastSnapshotAt: (key) => getLastSnapshotAt(getAppDb(), key),
  recordSnapshot: (key, at) => recordSnapshotUploaded(getAppDb(), key, at),
};

type OpenBudget = {
  key: string;
  connection: BrowserApiConnection;
  promise: Promise<ActualApiRuntime>;
};

type HostState = {
  open: OpenBudget | null;
  workspace: string | null;
  heartbeat: ReturnType<typeof setInterval> | null;
  closing: Promise<void>;
  syncQueue: Promise<void>;
  allowMainThread: boolean;
  snapshots: SnapshotStore;
  loadApi: () => Promise<ActualApi>;
  now: () => number;
};

async function loadNodeActualApi(): Promise<ActualApi> {
  const actual = await import("@actual-app/api");
  return actual as unknown as ActualApi;
}

const state: HostState = {
  open: null,
  workspace: null,
  heartbeat: null,
  closing: Promise.resolve(),
  syncQueue: Promise.resolve(),
  allowMainThread: false,
  snapshots: appDbSnapshotStore,
  loadApi: loadNodeActualApi,
  now: Date.now,
};

function runtimeKey(connection: BrowserApiConnection): string {
  return JSON.stringify({
    id: connection.id,
    baseUrl: normalizeUrl(connection.baseUrl),
    budgetSyncId: connection.budgetSyncId,
    serverPassword: connection.serverPassword,
    encryptionPassword: connection.encryptionPassword ?? "",
  });
}

function assertWorkerThread(): void {
  if (isMainThread && !state.allowMainThread) {
    throw new Error(
      "Direct budgets can only be opened in an automation worker thread. If ACTUAL_BENCH_AUTOMATION_EXECUTOR is set to in-thread, remove it."
    );
  }
}

function workspace(): string {
  if (state.workspace) return state.workspace;
  const dir = createWorkspace(threadId);
  state.workspace = dir;
  // Keeps a long run's workspace from looking abandoned to a sweep.
  state.heartbeat = setInterval(() => {
    try {
      touchWorkspace(dir);
    } catch {
      // Gone already; the task is ending.
    }
  }, WORKSPACE_HEARTBEAT_MS);
  state.heartbeat.unref?.();
  return dir;
}

function snapshotKey(connection: BrowserApiConnection) {
  return {
    serverFingerprint: serverFingerprint({ mode: connection.mode, baseUrl: connection.baseUrl }),
    budgetSyncId: connection.budgetSyncId,
  };
}

/**
 * Upload a fresh snapshot of the open budget if Bench has not in a week.
 * Never throws: a failed upload is tried again next time, and must not turn a
 * run that did its work into a failed one.
 */
async function refreshSnapshotIfDue(runtime: ActualApiRuntime, connection: BrowserApiConnection): Promise<void> {
  try {
    const key = snapshotKey(connection);
    const last = state.snapshots.lastSnapshotAt(key);
    if (last && state.now() - Date.parse(last) < SNAPSHOT_REFRESH_INTERVAL_MS) return;

    // Upload only what the server already has: a snapshot that contains
    // changes the server has not seen would be a second, divergent history.
    await withTimeout(runtime.sync(), "Syncing budget", SYNC_STEP_TIMEOUT_MS);
    const result = await withTimeout(
      runtime.send<{ error?: { reason?: string } } | null>("upload-budget"),
      "Uploading budget snapshot",
      120_000
    );
    if (result?.error) {
      logger.warn(`[actual-runtime] snapshot upload failed: ${result.error.reason ?? "unknown reason"}`);
      return;
    }
    state.snapshots.recordSnapshot(key, new Date(state.now()).toISOString());
  } catch (error) {
    logger.warn(
      `[actual-runtime] snapshot upload failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/** Close the open budget, refreshing its snapshot first when asked. */
async function leave(open: OpenBudget, options: { refreshSnapshot: boolean }): Promise<void> {
  let runtime: ActualApiRuntime;
  try {
    runtime = await open.promise;
  } catch {
    return; // It never opened; there is nothing to close.
  }
  if (options.refreshSnapshot) await refreshSnapshotIfDue(runtime, open.connection);
  try {
    await withTimeout(runtime.shutdown(), "Shutting down Actual", SHUTDOWN_STEP_TIMEOUT_MS);
  } catch {
    // Best-effort: the worker, and its workspace, go away after the task.
  }
}

export async function getNodeRuntime(connection: BrowserApiConnection): Promise<ActualApiRuntime> {
  assertWorkerThread();

  const key = runtimeKey(connection);
  if (state.open?.key === key) return state.open.promise;

  const previous = state.open;
  const dataDir = workspace();
  const encryptionPassword = connection.encryptionPassword?.trim() || undefined;

  const promise = (async () => {
    // Leaving a budget that worked: the run is not over, but this budget is
    // done with and in a state the server has, which is all a snapshot needs.
    if (previous) await leave(previous, { refreshSnapshot: true });

    try {
      const actual = await withTimeout(state.loadApi(), "Loading @actual-app/api");
      const initResult = await withTimeout(
        actual.init({
          dataDir,
          serverURL: normalizeUrl(connection.baseUrl),
          password: connection.serverPassword,
          verbose: false,
        }),
        "Signing in to the Actual server"
      );
      const runtime: ActualApiRuntime = { ...actual, send: initResult.send };
      await withTimeout(
        runtime.downloadBudget(connection.budgetSyncId, { password: encryptionPassword }),
        "Opening budget",
        OPEN_STEP_TIMEOUT_MS
      );
      await withTimeout(runtime.sync(), "Syncing budget", SYNC_STEP_TIMEOUT_MS);
      return runtime;
    } catch (error) {
      throw toActualRuntimeError(error);
    }
  })();

  const open: OpenBudget = { key, connection, promise };
  state.open = open;
  promise.catch(() => {
    if (state.open === open) state.open = null;
  });
  return promise;
}

export async function syncNodeRuntime(connection: BrowserApiConnection): Promise<void> {
  const next = state.syncQueue.then(async () => {
    const actual = await getNodeRuntime(connection);
    await withTimeout(actual.sync(), "Syncing budget", SYNC_STEP_TIMEOUT_MS);
  });
  state.syncQueue = next.catch(() => undefined);
  return next;
}

export const nodeHost: ActualRuntimeHost = {
  getRuntime: getNodeRuntime,
  sync: syncNodeRuntime,
  exportBudget: async (connection) => exportRuntimeBudget(await getNodeRuntime(connection), EXPORT_STEP_TIMEOUT_MS),
};

/**
 * End of task: close the open budget and delete this worker's workspace.
 *
 * `refreshSnapshot` is for a task that finished without error - the budget it
 * leaves is one the server has. Safe to call when nothing is open, and more
 * than once.
 */
export function closeNodeRuntime(options: { refreshSnapshot: boolean } = { refreshSnapshot: false }): Promise<void> {
  // One close at a time. A task stopped during a snapshot upload answers
  // without waiting for it, and the close that follows must not delete the
  // workspace from under the upload still reading it.
  const run = state.closing.then(() => closeOnce(options));
  state.closing = run.catch(() => undefined);
  return run;
}

async function closeOnce(options: { refreshSnapshot: boolean }): Promise<void> {
  const open = state.open;
  state.open = null;
  if (open) await leave(open, options);
  await state.syncQueue.catch(() => undefined);
  state.syncQueue = Promise.resolve();
  if (state.heartbeat) {
    clearInterval(state.heartbeat);
    state.heartbeat = null;
  }
  if (state.workspace) {
    const dir = state.workspace;
    state.workspace = null;
    try {
      removeWorkspace(dir);
    } catch (error) {
      logger.warn(
        `[actual-runtime] could not remove a worker workspace: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}

/** Whether a task left a budget open. */
export function nodeRuntimeIsOpen(): boolean {
  return state.open !== null;
}

/** Test seam: run in Jest's main thread, with a fake API or snapshot store. */
export function __configureNodeHostForTests(
  overrides: Partial<Pick<HostState, "snapshots" | "loadApi" | "now">> & { allowMainThread?: boolean }
): void {
  if (overrides.allowMainThread !== undefined) state.allowMainThread = overrides.allowMainThread;
  if (overrides.snapshots) state.snapshots = overrides.snapshots;
  if (overrides.loadApi) state.loadApi = overrides.loadApi;
  if (overrides.now) state.now = overrides.now;
}

export function __resetNodeHostForTests(): void {
  if (state.heartbeat) clearInterval(state.heartbeat);
  state.heartbeat = null;
  state.closing = Promise.resolve();
  state.open = null;
  state.workspace = null;
  state.syncQueue = Promise.resolve();
  state.allowMainThread = false;
  state.snapshots = appDbSnapshotStore;
  state.loadApi = loadNodeActualApi;
  state.now = Date.now;
}
