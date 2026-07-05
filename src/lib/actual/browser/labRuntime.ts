"use client";

import { assertDirectBrowserApiEnvironment } from "./environment";
import {
  SHUTDOWN_STEP_TIMEOUT_MS,
  initializeActualApi,
  loadActualApi,
  normalizeUrl,
  withTimeout,
} from "./setup";

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
  id?: string;
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

export type BrowserApiLabStepUpdate = {
  id: BrowserApiLabStepId;
  status: BrowserApiLabStepStatus;
  detail?: string;
};

type ActualBudget = {
  id?: string;
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

function normalizeBudget(budget: ActualBudget): BrowserApiLabBudget {
  return {
    id: budget.id,
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
    const syncId = getBudgetSyncId(budget);
    if (!syncId) return false;
    if (seen.has(syncId)) return false;
    seen.add(syncId);
    return true;
  });
}

function getBudgetSyncId(budget: BrowserApiLabBudget): string | undefined {
  return budget.groupId ?? budget.id;
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

export async function loadBrowserApiBudgetList(
  input: BrowserApiBudgetListInput
): Promise<BrowserApiBudgetListResult> {
  const serverUrl = normalizeUrl(input.serverUrl);
  const serverPassword = input.serverPassword;

  if (!serverUrl) throw new Error("Actual Server URL is required.");
  if (!serverPassword) throw new Error("Actual Server password is required.");
  assertDirectBrowserApiEnvironment();

  let actual: ActualApiModule | null = null;
  let initialized = false;

  try {
    actual = await withTimeout(
      loadActualApi<ActualApiModule>(),
      "Loading @actual-app/api"
    );
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
  assertDirectBrowserApiEnvironment();

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
    actual = await withTimeout(
      loadActualApi<ActualApiModule>(),
      "Loading @actual-app/api"
    );
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

    const selectedBudget = budgets.find(
      (budget) => getBudgetSyncId(budget) === budgetSyncId
    );

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
  } catch (error) {
    const detail = toErrorMessage(error, input);
    if (activeStep) {
      onStep({ id: activeStep, status: "error", detail });
      activeStep = null;
    }
    throw new Error(detail);
  }

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
      throw new Error(detail);
    }
  }

  if (!result) throw new Error("Browser API lab did not produce a result.");
  return result;
}
