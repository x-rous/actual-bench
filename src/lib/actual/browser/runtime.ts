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
import { assertDirectBrowserApiEnvironment } from "./environment";
import {
  SHUTDOWN_STEP_TIMEOUT_MS,
  initializeActualApi,
  loadActualApi,
  normalizeUrl,
  withTimeout,
} from "./setup";

/**
 * Raw transaction shape returned by the `@actual-app/api` browser runtime.
 * `getTransactions` runs with `{ splits: "grouped" }`, so split parents carry
 * their children inline under `subtransactions`. snake_case matches the runtime.
 */
export type ApiTransaction = {
  id: string;
  account: string;
  date: string;
  amount: number;
  payee?: string | null;
  category?: string | null;
  notes?: string | null;
  cleared?: boolean;
  reconciled?: boolean;
  imported_id?: string | null;
  is_parent?: boolean;
  is_child?: boolean;
  parent_id?: string | null;
  subtransactions?: ApiTransaction[];
};

/** Raw create/import payload for the browser runtime's transaction writers. */
export type ApiImportTransaction = {
  account?: string;
  date: string;
  amount: number;
  payee?: string | null;
  payee_name?: string;
  category?: string | null;
  notes?: string | null;
  cleared?: boolean;
  imported_id?: string;
  /** Split children created inline with the parent (RD-057 §6). */
  subtransactions?: Array<{ amount: number; category?: string | null; payee?: string | null; notes?: string | null }>;
};

export type ActualQueryBuilder = {
  filter(expr: unknown): ActualQueryBuilder;
  unfilter(exprs?: unknown): ActualQueryBuilder;
  select(exprs?: unknown): ActualQueryBuilder;
  calculate(expr: unknown): ActualQueryBuilder;
  groupBy(exprs: unknown): ActualQueryBuilder;
  orderBy(exprs: unknown): ActualQueryBuilder;
  limit(num: number): ActualQueryBuilder;
  offset(num: number): ActualQueryBuilder;
  raw(): ActualQueryBuilder;
  withDead(): ActualQueryBuilder;
  withoutValidatedRefs(): ActualQueryBuilder;
  options(opts: Record<string, unknown>): ActualQueryBuilder;
};

export type ActualBrowserApiSend = <T = unknown>(
  name: string,
  args?: unknown,
  options?: { catchErrors?: boolean }
) => Promise<T>;

export type ActualBrowserApiInitResult = {
  send: ActualBrowserApiSend;
};

export type ActualBrowserApi = {
  init(config: {
    dataDir?: string;
    serverURL: string;
    password: string;
    verbose?: boolean;
  }): Promise<ActualBrowserApiInitResult>;
  getBudgets(): Promise<unknown[]>;
  downloadBudget(syncId: string, options?: { password?: string }): Promise<unknown>;
  sync(): Promise<unknown>;
  batchBudgetUpdates(func: () => Promise<void>): Promise<void>;
  getBudgetMonths(): Promise<string[]>;
  getBudgetMonth(month: string): Promise<unknown>;
  setBudgetAmount(month: string, categoryId: string, value: number): Promise<void>;
  setBudgetCarryover(month: string, categoryId: string, flag: boolean): Promise<void>;
  holdBudgetForNextMonth(month: string, amount: number): Promise<boolean>;
  resetBudgetHold(month: string): Promise<void>;
  getAccounts(): Promise<ApiAccount[]>;
  createAccount(account: Omit<ApiAccount, "id">, initialBalance?: number): Promise<string>;
  updateAccount(accountId: string, fields: Partial<ApiAccount>): Promise<void>;
  closeAccount(accountId: string): Promise<void>;
  reopenAccount(accountId: string): Promise<void>;
  deleteAccount(accountId: string): Promise<void>;
  getAccountBalance(accountId: string): Promise<number>;
  getCategoryGroups(options?: { hidden?: boolean }): Promise<ApiCategoryGroup[]>;
  createCategoryGroup(group: Omit<ApiCategoryGroup, "id">): Promise<string>;
  updateCategoryGroup(groupId: string, fields: Partial<ApiCategoryGroup>): Promise<void>;
  deleteCategoryGroup(groupId: string): Promise<void>;
  getCategories(options?: { hidden?: boolean }): Promise<Array<ApiCategory | ApiCategoryGroup>>;
  createCategory(category: Omit<ApiCategory, "id">): Promise<string>;
  updateCategory(categoryId: string, fields: Partial<ApiCategory>): Promise<void>;
  deleteCategory(categoryId: string): Promise<void>;
  getPayees(): Promise<ApiPayee[]>;
  createPayee(payee: Omit<ApiPayee, "id">): Promise<string>;
  updatePayee(payeeId: string, fields: Partial<ApiPayee>): Promise<void>;
  deletePayee(payeeId: string): Promise<void>;
  mergePayees(targetId: string, mergeIds: string[]): Promise<void>;
  getTags(): Promise<ApiTag[]>;
  createTag(tag: Omit<ApiTag, "id">): Promise<string>;
  updateTag(tagId: string, fields: Partial<Omit<ApiTag, "id">>): Promise<void>;
  deleteTag(tagId: string): Promise<void>;
  getRules(): Promise<ApiRule[]>;
  createRule(rule: Omit<ApiRule, "id">): Promise<ApiRule>;
  updateRule(rule: ApiRule): Promise<ApiRule>;
  deleteRule(ruleId: string): Promise<boolean>;
  getSchedules(): Promise<ApiSchedule[]>;
  createSchedule(schedule: Omit<ApiSchedule, "id">): Promise<string>;
  updateSchedule(scheduleId: string, fields: Partial<ApiSchedule>): Promise<string>;
  deleteSchedule(scheduleId: string): Promise<void>;
  getTransactions(
    accountId: string,
    startDate: string,
    endDate: string
  ): Promise<ApiTransaction[]>;
  addTransactions(
    accountId: string,
    transactions: ApiImportTransaction[],
    opts?: { learnCategories?: boolean; runTransfers?: boolean }
  ): Promise<"ok">;
  updateTransaction(id: string, fields: Partial<ApiImportTransaction>): Promise<unknown>;
  deleteTransaction(id: string): Promise<unknown>;
  importTransactions(
    accountId: string,
    transactions: ApiImportTransaction[],
    opts?: Record<string, unknown>
  ): Promise<unknown>;
  getNote(id: string): Promise<NoteRow | null>;
  updateNote(id: string, note: string | null): Promise<void>;
  q?(table: string): ActualQueryBuilder;
  runQuery?(query: unknown): Promise<unknown>;
  aqlQuery?(query: unknown): Promise<unknown>;
  getServerVersion?(): Promise<{ version: string } | { error: string }>;
  shutdown(): Promise<unknown>;
};

export type ActualBrowserApiRuntime = ActualBrowserApi & {
  send: ActualBrowserApiSend;
};

type ActiveRuntime = {
  key: string;
  promise: Promise<ActualBrowserApiRuntime>;
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

type ActualExportBudgetResult = {
  data?: unknown;
  error?: string;
};

function exportedZipToArrayBuffer(data: unknown): ArrayBuffer {
  if (data instanceof ArrayBuffer) return data.slice(0);

  if (ArrayBuffer.isView(data)) {
    return data.buffer.slice(
      data.byteOffset,
      data.byteOffset + data.byteLength
    ) as ArrayBuffer;
  }

  if (Array.isArray(data)) {
    return Uint8Array.from(data).buffer as ArrayBuffer;
  }

  if (
    data &&
    typeof data === "object" &&
    "type" in data &&
    (data as { type?: unknown }).type === "Buffer" &&
    "data" in data &&
    Array.isArray((data as { data?: unknown }).data)
  ) {
    return Uint8Array.from((data as { data: number[] }).data).buffer as ArrayBuffer;
  }

  throw new Error("Direct budget export returned an unsupported byte payload.");
}

export async function exportBrowserApiBudgetZip(
  connection: BrowserApiConnection
): Promise<ArrayBuffer> {
  const actual = await getBrowserApiRuntime(connection);
  await withTimeout(actual.sync(), "Syncing budget");
  const result = await withTimeout(
    actual.send<ActualExportBudgetResult | null>("export-budget"),
    "Exporting budget snapshot"
  );

  if (!result) {
    throw new Error("Direct budget export returned no data.");
  }

  if (result.error) {
    throw new Error("Direct budget export failed: " + result.error);
  }

  return exportedZipToArrayBuffer(result.data);
}

export async function ensureBrowserApiBudgetOpen(
  connection: BrowserApiConnection
): Promise<void> {
  await getBrowserApiRuntime(connection);
}

export async function getBrowserApiRuntime(
  connection: BrowserApiConnection
): Promise<ActualBrowserApiRuntime> {
  assertDirectBrowserApiEnvironment();

  const key = runtimeKey(connection);
  if (activeRuntime?.key === key) return activeRuntime.promise;

  const previousRuntime = activeRuntime;
  const serverUrl = normalizeUrl(connection.baseUrl);
  const encryptionPassword = connection.encryptionPassword?.trim() || undefined;

  // RD-059: is the previous runtime on the SAME server, with only the budget
  // differing? Then we can keep the initialized API + server connection alive and
  // just swap the open budget - skipping the teardown/re-init/reconnect entirely.
  const sameServerAsPrevious =
    !!previousRuntime && serverSignatureFromKey(previousRuntime.key) === serverSignature(connection);

  // NOTE (RD-059): the live budget-swap fast path was reverted - `downloadBudget`
  // on an already-initialized runtime throws (the exposed API has no clean
  // close/reload primitive), so it fell back every time (`switched: false`) and
  // made switching slower. Back to the plain full re-init; timing is kept so the
  // baseline stays visible.
  const promise = (async () => {
    const timing = runtimeTiming();

    if (previousRuntime) await timing.phase("shutdown", () => shutdownRuntime(previousRuntime));

    const actual = await timing.phase("load", () =>
      withTimeout(loadActualApi<ActualBrowserApi>(), "Loading @actual-app/api")
    );
    const initResult = await timing.phase("init", () =>
      initializeActualApi(actual, {
        dataDir: "/documents",
        serverURL: serverUrl,
        password: connection.serverPassword,
        verbose: false,
      })
    );
    const runtime: ActualBrowserApiRuntime = { ...actual, send: initResult.send };
    await timing.phase("download", () =>
      withTimeout(
        runtime.downloadBudget(connection.budgetSyncId, { password: encryptionPassword }),
        "Opening budget"
      )
    );
    await timing.phase("sync", () => withTimeout(runtime.sync(), "Syncing budget"));

    timing.report({ budgetSyncId: connection.budgetSyncId, sameServerAsPrevious, switched: false });
    return runtime;
  })();

  activeRuntime = { key, promise };
  promise.catch(() => {
    if (activeRuntime?.key === key) activeRuntime = null;
  });

  return promise;
}

// ── SPIKE (RD-059): runtime-switch timing ──────────────────────────────────
// Opt-in phase timing to decide whether the same-server budget-switch
// optimization is worth building. Enable in the browser console with:
//   localStorage.setItem("ab:runtime-timing", "1")
// then run a cross-budget Direct preview and read "[RD-059 timing]" logs.
// Off unless the flag is "1" (default) or NODE_ENV !== production; throwaway.

function runtimeTimingEnabled(): boolean {
  try {
    if (typeof window !== "undefined") {
      const flag = window.localStorage.getItem("ab:runtime-timing");
      if (flag === "1") return true;
      if (flag === "0") return false;
    }
  } catch {
    // ignore storage access errors
  }
  return process.env.NODE_ENV !== "production";
}

type PhaseName = "shutdown" | "load" | "init" | "download" | "sync";

function runtimeTiming() {
  const enabled = runtimeTimingEnabled();
  const ms: Record<PhaseName, number> = { shutdown: 0, load: 0, init: 0, download: 0, sync: 0 };
  return {
    async phase<T>(name: PhaseName, run: () => Promise<T>): Promise<T> {
      if (!enabled) return run();
      const t = performance.now();
      try {
        return await run();
      } finally {
        ms[name] = Math.round(performance.now() - t);
      }
    },
    report(meta: { budgetSyncId: string; sameServerAsPrevious: boolean; switched: boolean }) {
      if (!enabled) return;
      const total = ms.shutdown + ms.load + ms.init + ms.download + ms.sync;
      // `switched: true` = RD-059 fast path taken, so shutdown/load/init are ~0
      // and totalMs is the realized (post-optimization) cost. `sameServerSwitch`
      // true with `switched: false` means the fast path fell back to a re-init.
      console.info("[RD-059 timing]", {
        budget: meta.budgetSyncId.slice(0, 8),
        sameServerSwitch: meta.sameServerAsPrevious,
        switched: meta.switched,
        ms,
        totalMs: total,
      });
    },
  };
}

function serverSignature(connection: BrowserApiConnection): string {
  return JSON.stringify({
    baseUrl: normalizeUrl(connection.baseUrl),
    serverPassword: connection.serverPassword,
    encryptionPassword: connection.encryptionPassword ?? "",
  });
}

function serverSignatureFromKey(key: string): string | null {
  try {
    const k = JSON.parse(key) as { baseUrl: string; serverPassword: string; encryptionPassword: string };
    return JSON.stringify({
      baseUrl: k.baseUrl,
      serverPassword: k.serverPassword,
      encryptionPassword: k.encryptionPassword,
    });
  } catch {
    return null;
  }
}
