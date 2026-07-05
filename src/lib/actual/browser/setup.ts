"use client";

type ActualInitConfig = {
  dataDir?: string;
  serverURL: string;
  password: string;
  verbose?: boolean;
};

type ActualInitCapable = {
  init(config: ActualInitConfig): Promise<unknown>;
};

type WorkerInitMessage = {
  name?: unknown;
  args?: unknown;
};

export const DEFAULT_STEP_TIMEOUT_MS = 45_000;
export const SHUTDOWN_STEP_TIMEOUT_MS = 15_000;

export function normalizeUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

export function withTimeout<T>(
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

export async function initializeActualApi<TActual extends ActualInitCapable>(
  actual: TActual,
  config: ActualInitConfig
): Promise<Awaited<ReturnType<TActual["init"]>>> {
  const NativeWorker = window.Worker;
  const assetsBaseUrl = getActualAssetsBaseUrl();
  let redirectedBackendWorker = false;

  const ActualBenchWorker = class extends NativeWorker {
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
  };

  // Next/Turbopack cannot load the first Actual backend worker directly from
  // node_modules, so this temporary shim redirects it to our asset route. The
  // native Worker constructor is restored in the finally block below.
  window.Worker = ActualBenchWorker as typeof Worker;

  try {
    return (await withTimeout(
      actual.init(config),
      "Initializing browser API worker"
    )) as Awaited<ReturnType<TActual["init"]>>;
  } finally {
    if (window.Worker === (ActualBenchWorker as typeof Worker)) {
      window.Worker = NativeWorker;
    }
  }
}

export async function loadActualApi<TActual>(): Promise<TActual> {
  const actual = await import("@actual-app/api");
  return actual as unknown as TActual;
}
