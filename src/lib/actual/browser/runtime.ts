"use client";

import type {
  ApiAccount,
  ApiCategory,
  ApiCategoryGroup,
  ApiPayee,
  ApiRule,
  ApiSchedule,
  ApiTag,
} from "@/types/api";
import type { BrowserApiConnection } from "@/store/connection";
import type { NoteRow } from "@/lib/api/notes";

export type ActualQueryBuilder = {
  select(exprs?: unknown): unknown;
};

export type ActualBrowserApi = {
  init(config: {
    dataDir?: string;
    serverURL: string;
    password: string;
    verbose?: boolean;
  }): Promise<unknown>;
  getBudgets(): Promise<unknown[]>;
  downloadBudget(syncId: string, options?: { password?: string }): Promise<unknown>;
  sync(): Promise<unknown>;
  getAccounts(): Promise<ApiAccount[]>;
  getAccountBalance(accountId: string): Promise<number>;
  getCategoryGroups(options?: { hidden?: boolean }): Promise<ApiCategoryGroup[]>;
  getCategories(options?: { hidden?: boolean }): Promise<Array<ApiCategory | ApiCategoryGroup>>;
  getPayees(): Promise<ApiPayee[]>;
  getTags(): Promise<ApiTag[]>;
  getRules(): Promise<ApiRule[]>;
  getSchedules(): Promise<ApiSchedule[]>;
  getNote(id: string): Promise<NoteRow | null>;
  q?(table: string): ActualQueryBuilder;
  runQuery?(query: unknown): Promise<unknown>;
  aqlQuery?(query: unknown): Promise<unknown>;
  getServerVersion?(): Promise<{ version: string } | { error: string }>;
  shutdown(): Promise<unknown>;
};

type WorkerInitMessage = {
  name?: unknown;
  args?: unknown;
};

type ActiveRuntime = {
  key: string;
  promise: Promise<ActualBrowserApi>;
};

const DEFAULT_STEP_TIMEOUT_MS = 45_000;
const SHUTDOWN_STEP_TIMEOUT_MS = 15_000;

let activeRuntime: ActiveRuntime | null = null;

function normalizeUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
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

function getActualAssetsBaseUrl(): string {
  if (typeof window === "undefined") return "/actual-api-assets/";
  return new URL("/actual-api-assets/", window.location.origin).href;
}

function isWorkerInitMessage(message: unknown): message is WorkerInitMessage {
  return typeof message === "object" && message !== null && "name" in message;
}

function rewriteActualInitMessage(message: unknown, assetsBaseUrl: string): unknown {
  if (!isWorkerInitMessage(message) || message.name !== "api-browser/init") {
    return message;
  }

  const args =
    typeof message.args === "object" && message.args !== null ? message.args : {};

  return {
    ...message,
    args: {
      ...args,
      assetsBaseUrl,
    },
  };
}

function withTimeout<T>(
  promise: Promise<T>,
  stepLabel: string,
  timeoutMs = DEFAULT_STEP_TIMEOUT_MS
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(() => {
      reject(
        new Error(
          stepLabel +
            " did not finish within " +
            Math.round(timeoutMs / 1000) +
            " seconds."
        )
      );
    }, timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => {
    if (timeoutId) clearTimeout(timeoutId);
  });
}

async function initializeActualApi(
  actual: ActualBrowserApi,
  config: Parameters<ActualBrowserApi["init"]>[0]
): Promise<unknown> {
  const NativeWorker = window.Worker;
  const assetsBaseUrl = getActualAssetsBaseUrl();
  let redirectedBackendWorker = false;

  window.Worker = class ActualBenchWorker extends NativeWorker {
    constructor(scriptURL: string | URL, options?: WorkerOptions) {
      const actualBackendWorkerUrl = redirectedBackendWorker
        ? scriptURL
        : assetsBaseUrl + "worker.js";

      redirectedBackendWorker = true;
      super(actualBackendWorkerUrl, options);
    }

    postMessage(message: unknown, transfer: Transferable[]): void;
    postMessage(message: unknown, options?: StructuredSerializeOptions): void;
    postMessage(
      message: unknown,
      options?: Transferable[] | StructuredSerializeOptions
    ): void {
      const rewrittenMessage = rewriteActualInitMessage(message, assetsBaseUrl);

      if (options === undefined) {
        super.postMessage(rewrittenMessage);
      } else if (Array.isArray(options)) {
        super.postMessage(rewrittenMessage, options);
      } else {
        super.postMessage(rewrittenMessage, options);
      }
    }
  } as typeof Worker;

  try {
    return await actual.init(config);
  } finally {
    window.Worker = NativeWorker;
  }
}

async function loadActualApi(): Promise<ActualBrowserApi> {
  const actual = await import("@actual-app/api");
  return actual as unknown as ActualBrowserApi;
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

export async function getBrowserApiRuntime(
  connection: BrowserApiConnection
): Promise<ActualBrowserApi> {
  if (typeof window === "undefined") {
    throw new Error("Direct browser API transport can only run in the browser.");
  }

  const key = runtimeKey(connection);
  if (activeRuntime?.key === key) return activeRuntime.promise;

  const previousRuntime = activeRuntime;
  const serverUrl = normalizeUrl(connection.baseUrl);
  const encryptionPassword = connection.encryptionPassword?.trim() || undefined;

  const promise = (async () => {
    if (previousRuntime) await shutdownRuntime(previousRuntime);

    const actual = await withTimeout(loadActualApi(), "Loading @actual-app/api");
    await withTimeout(
      initializeActualApi(actual, {
        dataDir: "/documents",
        serverURL: serverUrl,
        password: connection.serverPassword,
        verbose: false,
      }),
      "Initializing browser API worker"
    );
    await withTimeout(
      actual.downloadBudget(connection.budgetSyncId, { password: encryptionPassword }),
      "Opening budget"
    );
    await withTimeout(actual.sync(), "Syncing budget");
    return actual;
  })();

  activeRuntime = { key, promise };
  promise.catch(() => {
    if (activeRuntime?.key === key) activeRuntime = null;
  });

  return promise;
}
