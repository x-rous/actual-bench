"use client";

import type { BrowserApiConnection } from "@/store/connection";
import type { ActualApi, ActualApiRuntime } from "../runtime/types";
import { exportRuntimeBudget } from "../runtime/archive";
import { assertDirectBrowserApiEnvironment } from "./environment";
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

let activeRuntime: ActiveRuntime | null = null;
let syncQueue = Promise.resolve();

function runtimeKey(connection: BrowserApiConnection): string {
  return JSON.stringify({
    id: connection.id,
    baseUrl: normalizeUrl(connection.baseUrl),
    budgetSyncId: connection.budgetSyncId,
    serverPassword: connection.serverPassword,
    encryptionPassword: connection.encryptionPassword ?? "",
  });
}

async function shutdownRuntime(runtime: ActiveRuntime): Promise<void> {
  try {
    const actual = await runtime.promise;
    await withTimeout(
      actual.shutdown(),
      "Shutting down browser API",
      SHUTDOWN_STEP_TIMEOUT_MS
    );
  } catch {
    // Best-effort cleanup only. The next initialization will surface real errors.
  }
}

export function clearBrowserApiRuntimeCache(): void {
  const runtime = activeRuntime;
  activeRuntime = null;
  if (runtime) void shutdownRuntime(runtime);
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

export async function ensureBrowserApiBudgetOpen(
  connection: BrowserApiConnection
): Promise<void> {
  await getBrowserApiRuntime(connection);
}

export async function getBrowserApiRuntime(
  connection: BrowserApiConnection
): Promise<ActualApiRuntime> {
  assertDirectBrowserApiEnvironment();

  const key = runtimeKey(connection);
  if (activeRuntime?.key === key) return activeRuntime.promise;

  const previousRuntime = activeRuntime;
  const serverUrl = normalizeUrl(connection.baseUrl);
  const encryptionPassword = connection.encryptionPassword?.trim() || undefined;

  const promise = (async () => {
    if (previousRuntime) await shutdownRuntime(previousRuntime);

    const actual = await withTimeout(
      loadActualApi<ActualApi>(),
      "Loading @actual-app/api"
    );
    const initResult = await initializeActualApi(actual, {
      dataDir: "/documents",
      serverURL: serverUrl,
      password: connection.serverPassword,
      verbose: false,
    });
    const runtime: ActualApiRuntime = { ...actual, send: initResult.send };
    await withTimeout(
      runtime.downloadBudget(connection.budgetSyncId, { password: encryptionPassword }),
      "Opening budget"
    );
    await withTimeout(runtime.sync(), "Syncing budget");
    return runtime;
  })();

  activeRuntime = { key, promise };
  promise.catch(() => {
    if (activeRuntime?.key === key) activeRuntime = null;
  });

  return promise;
}
