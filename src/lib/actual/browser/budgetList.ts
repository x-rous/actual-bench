"use client";

/**
 * Lists the budgets on an Actual Server from the browser, for the connect
 * form's Direct mode: start the runtime, read the budget list and the server
 * version, and shut it down again.
 */

import { assertDirectBrowserApiEnvironment } from "./environment";
import {
  SHUTDOWN_STEP_TIMEOUT_MS,
  initializeActualApi,
  loadActualApi,
  normalizeUrl,
  withTimeout,
} from "./setup";

export type BrowserApiBudgetListInput = {
  serverUrl: string;
  serverPassword: string;
};

export type BrowserApiBudget = {
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
  budgets: BrowserApiBudget[];
  serverVersion: string | null;
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

function normalizeBudget(budget: ActualBudget): BrowserApiBudget {
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

function filterRemoteBudgets(budgets: BrowserApiBudget[]): BrowserApiBudget[] {
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

function getBudgetSyncId(budget: BrowserApiBudget): string | undefined {
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
): Promise<BrowserApiBudget[]> {
  return (await loadBrowserApiBudgetList(input)).budgets;
}
