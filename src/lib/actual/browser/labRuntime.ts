"use client";

export type BrowserApiLabInput = {
  serverUrl: string;
  serverPassword: string;
  budgetSyncId: string;
  encryptionPassword?: string;
};

export type BrowserApiBudgetListInput = {
  serverUrl: string;
  serverPassword: string;
};

export type BrowserApiLabBudget = {
  cloudFileId?: string;
  name?: string;
  state?: string;
  groupId?: string;
  encryptKeyId?: string | null;
  hasKey?: boolean;
  owner?: string;
};

export type BrowserApiBudgetListResult = {
  budgets: BrowserApiLabBudget[];
  serverVersion: string | null;
};

export type BrowserApiLabAccount = {
  id: string;
  name: string;
  closed?: boolean;
  offbudget?: boolean;
};

export type BrowserApiLabResult = {
  serverUrl: string;
  budgetCount: number;
  selectedBudgetName: string | null;
  selectedBudgetSyncId: string;
  accounts: BrowserApiLabAccount[];
};

export type BrowserApiLabStepId =
  | "load"
  | "init"
  | "budgets"
  | "download"
  | "accounts"
  | "sync"
  | "shutdown";

export type BrowserApiLabStepStatus = "running" | "success" | "error";

const DEFAULT_STEP_TIMEOUT_MS = 45_000;
const SHUTDOWN_STEP_TIMEOUT_MS = 15_000;

export type BrowserApiLabStepUpdate = {
  id: BrowserApiLabStepId;
  status: BrowserApiLabStepStatus;
  detail?: string;
};

type ActualBudget = {
  cloudFileId?: string;
  name?: string;
  state?: string;
  groupId?: string;
  encryptKeyId?: string | null;
  hasKey?: boolean;
  owner?: string;
};

type ActualAccount = {
  id?: string;
  name?: string;
  closed?: boolean;
  offbudget?: boolean;
};

type ActualApiModule = {
  init(config: {
    dataDir?: string;
    serverURL: string;
    password: string;
    verbose?: boolean;
  }): Promise<unknown>;
  getBudgets(): Promise<ActualBudget[]>;
  getServerVersion?(): Promise<{ version: string } | { error: string }>;
  downloadBudget(syncId: string, options?: { password?: string }): Promise<unknown>;
  getAccounts(): Promise<ActualAccount[]>;
  sync(): Promise<unknown>;
  shutdown(): Promise<unknown>;
};

type WorkerInitMessage = {
  name?: unknown;
  args?: unknown;
};

function normalizeUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

function normalizeBudget(budget: ActualBudget): BrowserApiLabBudget {
  return {
    cloudFileId: budget.cloudFileId,
    name: budget.name,
    state: budget.state,
    groupId: budget.groupId,
    encryptKeyId: budget.encryptKeyId,
    hasKey: budget.hasKey,
    owner: budget.owner,
  };
}

function normalizeAccount(account: ActualAccount): BrowserApiLabAccount | null {
  if (!account.id || !account.name) return null;
  return {
    id: account.id,
    name: account.name,
    closed: account.closed,
    offbudget: account.offbudget,
  };
}

function filterRemoteBudgets(budgets: BrowserApiLabBudget[]): BrowserApiLabBudget[] {
  const seen = new Set<string>();
  return budgets.filter((budget) => {
    if (budget.state !== "remote") return false;
    if (!budget.groupId) return false;
    if (seen.has(budget.groupId)) return false;
    seen.add(budget.groupId);
    return true;
  });
}

function redactMessage(
  message: string,
  input: { serverPassword?: string; encryptionPassword?: string }
): string {
  let redacted = message;
  for (const secret of [input.serverPassword, input.encryptionPassword]) {
    if (!secret) continue;
    redacted = redacted.split(secret).join("[redacted]");
  }
  return redacted;
}

function toErrorMessage(
  error: unknown,
  input: { serverPassword?: string; encryptionPassword?: string }
): string {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : typeof error === "object" &&
            error !== null &&
            "message" in error &&
            typeof error.message === "string"
          ? error.message
          : "Unknown browser API error";
  return redactMessage(message, input);
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

async function initializeActualApi(
  actual: ActualApiModule,
  config: Parameters<ActualApiModule["init"]>[0]
): Promise<unknown> {
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

  window.Worker = ActualBenchWorker as typeof Worker;

  try {
    return await withTimeout(actual.init(config), "Initializing browser API worker");
  } finally {
    if (window.Worker === (ActualBenchWorker as typeof Worker)) {
      window.Worker = NativeWorker;
    }
  }
}

async function loadActualApi(): Promise<ActualApiModule> {
  const actual = await import("@actual-app/api");
  return actual as unknown as ActualApiModule;
}

export async function loadBrowserApiBudgetList(
  input: BrowserApiBudgetListInput
): Promise<BrowserApiBudgetListResult> {
  const serverUrl = normalizeUrl(input.serverUrl);
  const serverPassword = input.serverPassword;

  if (!serverUrl) throw new Error("Actual Server URL is required.");
  if (!serverPassword) throw new Error("Actual Server password is required.");

  let actual: ActualApiModule | null = null;
  let initialized = false;

  try {
    actual = await withTimeout(loadActualApi(), "Loading @actual-app/api");
    await initializeActualApi(actual, {
      dataDir: "/documents",
      serverURL: serverUrl,
      password: serverPassword,
      verbose: false,
    });
    initialized = true;

    const budgets = (await withTimeout(actual.getBudgets(), "Listing budgets"))
      .map(normalizeBudget);
    const versionResult = actual.getServerVersion
      ? await withTimeout(
          actual.getServerVersion(),
          "Reading Actual Server version",
          10_000
        ).catch(() => null)
      : null;

    return {
      budgets: filterRemoteBudgets(budgets),
      serverVersion:
        versionResult && "version" in versionResult ? versionResult.version : null,
    };
  } catch (error) {
    throw new Error(toErrorMessage(error, input));
  } finally {
    if (actual && initialized) {
      await withTimeout(
        actual.shutdown(),
        "Shutting down browser API",
        SHUTDOWN_STEP_TIMEOUT_MS
      ).catch(() => undefined);
    }
  }
}

export async function listBrowserApiBudgets(
  input: BrowserApiBudgetListInput
): Promise<BrowserApiLabBudget[]> {
  return (await loadBrowserApiBudgetList(input)).budgets;
}

export async function runBrowserApiLab(
  input: BrowserApiLabInput,
  onStep: (update: BrowserApiLabStepUpdate) => void
): Promise<BrowserApiLabResult> {
  const serverUrl = normalizeUrl(input.serverUrl);
  const budgetSyncId = input.budgetSyncId.trim();
  const serverPassword = input.serverPassword;
  const encryptionPassword = input.encryptionPassword?.trim() || undefined;

  if (!serverUrl) throw new Error("Actual Server URL is required.");
  if (!serverPassword) throw new Error("Actual Server password is required.");
  if (!budgetSyncId) throw new Error("Budget Sync ID is required.");

  let actual: ActualApiModule | null = null;
  let initialized = false;
  let result: BrowserApiLabResult | null = null;
  let activeStep: BrowserApiLabStepId | null = null;

  function startStep(id: BrowserApiLabStepId) {
    activeStep = id;
    onStep({ id, status: "running" });
  }

  function completeStep(id: BrowserApiLabStepId, detail?: string) {
    if (activeStep === id) activeStep = null;
    onStep({ id, status: "success", detail });
  }

  try {
    startStep("load");
    actual = await withTimeout(loadActualApi(), "Loading @actual-app/api");
    completeStep("load", "Browser API module loaded.");

    startStep("init");
    await initializeActualApi(actual, {
      dataDir: "/documents",
      serverURL: serverUrl,
      password: serverPassword,
      verbose: true,
    });
    initialized = true;
    completeStep("init", "Worker runtime initialized.");

    startStep("budgets");
    const budgets = filterRemoteBudgets(
      (await withTimeout(actual.getBudgets(), "Listing budgets")).map(normalizeBudget)
    );
    completeStep(
      "budgets",
      budgets.length + " budget" + (budgets.length === 1 ? "" : "s") + " returned."
    );

    const selectedBudget = budgets.find((budget) => budget.groupId === budgetSyncId);

    startStep("download");
    await withTimeout(
      actual.downloadBudget(budgetSyncId, { password: encryptionPassword }),
      "Downloading budget"
    );
    completeStep(
      "download",
      selectedBudget?.name
        ? "Downloaded " + selectedBudget.name + "."
        : "Downloaded selected budget."
    );

    startStep("accounts");
    const accounts = (await withTimeout(actual.getAccounts(), "Reading accounts"))
      .map(normalizeAccount)
      .filter((account): account is BrowserApiLabAccount => account !== null);
    completeStep(
      "accounts",
      accounts.length + " account" + (accounts.length === 1 ? "" : "s") + " returned."
    );

    startStep("sync");
    await withTimeout(actual.sync(), "Syncing budget");
    completeStep("sync", "Sync completed.");

    result = {
      serverUrl,
      budgetCount: budgets.length,
      selectedBudgetName: selectedBudget?.name ?? null,
      selectedBudgetSyncId: budgetSyncId,
      accounts,
    };
    return result;
  } catch (error) {
    const detail = toErrorMessage(error, input);
    if (activeStep) {
      onStep({ id: activeStep, status: "error", detail });
      activeStep = null;
    }
    throw new Error(detail);
  } finally {
    if (actual && initialized) {
      onStep({ id: "shutdown", status: "running" });
      try {
        await withTimeout(
          actual.shutdown(),
          "Shutting down browser API",
          SHUTDOWN_STEP_TIMEOUT_MS
        );
        onStep({ id: "shutdown", status: "success", detail: "Runtime shut down." });
      } catch (error) {
        const detail = toErrorMessage(error, input);
        onStep({ id: "shutdown", status: "error", detail });
        if (result) throw new Error(detail);
      }
    }
  }
}
