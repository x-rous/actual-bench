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
import type { NoteRow } from "@/lib/api/noteIds";

/**
 * The shape of an open `@actual-app/api` runtime, shared by both of the places
 * a Direct budget can be opened (RD-095 M3): the browser tab
 * (`browser/runtime.ts`) and an automation worker (`runtime/nodeHost.ts`). The
 * browser and Node builds of the package expose the same methods, so the one
 * Direct transport (`runtimeTransport.ts`) is written against this and is
 * handed a host that knows how to open it. Types only: nothing here may pull
 * in browser or server code.
 */

/**
 * Raw transaction shape returned by `@actual-app/api` (browser and Node builds alike).
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
  /** Raw merchant text captured at import, distinct from the curated payee. */
  imported_payee?: string | null;
  /** Set on both legs of a transfer; mutating one leg affects the other. */
  transfer_id?: string | null;
  /** Set when the row is linked to a schedule. */
  schedule?: string | null;
  is_parent?: boolean;
  is_child?: boolean;
  parent_id?: string | null;
  subtransactions?: ApiTransaction[];
};

/** Raw create/import payload for the runtime's transaction writers. */
export type ApiImportTransaction = {
  account?: string;
  date: string;
  amount: number;
  payee?: string | null;
  payee_name?: string;
  /**
   * Raw source/bank merchant text. Actual keeps this separate from the resolved
   * payee and preserves an explicitly supplied value through its own
   * normalization (`imported_payee = imported_payee || payee_name`).
   */
  imported_payee?: string | null;
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

export type ActualApiSend = <T = unknown>(
  name: string,
  args?: unknown,
  options?: { catchErrors?: boolean }
) => Promise<T>;

export type ActualApiInitResult = {
  send: ActualApiSend;
};

export type ActualApi = {
  init(config: {
    dataDir?: string;
    serverURL: string;
    password: string;
    verbose?: boolean;
  }): Promise<ActualApiInitResult>;
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
  /** Trigger Actual's own bank import (RD-080). Optional: an older build may
   * not export it, and the capability report says so rather than no-oping. */
  runBankSync?(args?: { accountId?: string }): Promise<void>;
  getNote(id: string): Promise<NoteRow | null>;
  updateNote(id: string, note: string | null): Promise<void>;
  q?(table: string): ActualQueryBuilder;
  runQuery?(query: unknown): Promise<unknown>;
  aqlQuery?(query: unknown): Promise<unknown>;
  getServerVersion?(): Promise<{ version: string } | { error: string }>;
  shutdown(): Promise<unknown>;
};

export type ActualApiRuntime = ActualApi & {
  send: ActualApiSend;
};

/**
 * Where a Direct transport gets its runtime from. The transport never opens a
 * budget itself: it asks the host, which keeps at most one budget open and
 * switches when a different connection asks.
 */
export type ActualRuntimeHost = {
  /** The open runtime for this connection's budget, opening or switching as needed. */
  getRuntime(connection: BrowserApiConnection): Promise<ActualApiRuntime>;
  /** Sync the open budget with the server. */
  sync(connection: BrowserApiConnection): Promise<void>;
  /** The budget archive (a zip), after a sync. */
  exportBudget(connection: BrowserApiConnection): Promise<Uint8Array>;
};
