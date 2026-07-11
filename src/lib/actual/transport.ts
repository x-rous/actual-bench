import type { CategoryGroupsResponse } from "../api/categoryGroups";
import type { NotesIndex } from "../api/notes";
import type { SyncCapabilityReport } from "@/lib/app-db/types";
import type { ConnectionMode } from "@/store/connection";
import type {
  Account,
  Category,
  CategoryGroup,
  Payee,
  Rule,
  Schedule,
  Tag,
} from "@/types/entities";

export type ScheduleWriteInput = Omit<
  Schedule,
  "id" | "ruleId" | "nextDate" | "completed"
>;

/** Integer minor currency units, matching Actual's cents-style amount fields. */
export type MinorUnitAmount = number;

export type TransportBudgetMonthCategory = {
  id: string;
  name: string;
  is_income: boolean;
  hidden?: boolean;
  group_id: string;
  budgeted?: MinorUnitAmount | null;
  spent?: MinorUnitAmount | null;
  balance?: MinorUnitAmount | null;
  carryover?: boolean;
  received?: MinorUnitAmount | null;
};

export type TransportBudgetMonthCategoryGroup =
  | {
      id: string;
      name: string;
      is_income: false;
      hidden: boolean;
      budgeted: MinorUnitAmount | null;
      spent: MinorUnitAmount | null;
      balance: MinorUnitAmount | null;
      categories: TransportBudgetMonthCategory[];
    }
  | {
      id: string;
      name: string;
      is_income: true;
      hidden: boolean;
      received: MinorUnitAmount | null;
      budgeted?: MinorUnitAmount | null;
      balance?: MinorUnitAmount | null;
      categories: TransportBudgetMonthCategory[];
    };

export type TransportBudgetMonth = {
  month: string;
  incomeAvailable: MinorUnitAmount;
  lastMonthOverspent: MinorUnitAmount;
  forNextMonth: MinorUnitAmount;
  totalBudgeted: MinorUnitAmount;
  toBudget: MinorUnitAmount;
  fromLastMonth: MinorUnitAmount;
  totalIncome: MinorUnitAmount;
  totalSpent: MinorUnitAmount;
  totalBalance: MinorUnitAmount;
  categoryGroups: TransportBudgetMonthCategoryGroup[];
};

export type BudgetTransferInput = {
  fromCategoryId: string;
  toCategoryId: string;
  /** Amount to move, in integer minor units. */
  amount: MinorUnitAmount;
};

// ---------------------------------------------------------------------------
// Budget File Sync transaction primitives (RD-053 / PR-019).
//
// These are app-level shapes for the sync engine. They intentionally do NOT
// leak `@actual-app/api` concepts (`addTransactions`, `importTransactions`,
// `imported_id`, `subtransactions`). The transport decides how to satisfy them.
// All amounts are integer minor units, matching Actual's transaction amounts.
// ---------------------------------------------------------------------------

/** A split child line read from a source transaction. */
export type SyncSourceSplitLine = {
  /** Actual subtransaction id, or null if the API did not expose a stable id. */
  id: string | null;
  amount: MinorUnitAmount;
  payeeId: string | null;
  payeeName: string | null;
  categoryId: string | null;
  categoryName: string | null;
  notes: string | null;
};

/** A source transaction with the fields Budget File Sync needs. */
export type SyncSourceTransaction = {
  id: string;
  accountId: string;
  /** ISO `YYYY-MM-DD`. */
  date: string;
  amount: MinorUnitAmount;
  payeeId: string | null;
  payeeName: string | null;
  categoryId: string | null;
  categoryName: string | null;
  notes: string | null;
  cleared: boolean;
  reconciled: boolean;
  /** Actual `imported_id` if the source transaction carries one. */
  importedId: string | null;
  /** True when this transaction is a split parent that owns `splitLines`. */
  isParent: boolean;
  /** True when this transaction is itself a split child of another parent. */
  isChild: boolean;
  parentId: string | null;
  /** Inline split children when `isParent`; empty otherwise. */
  splitLines: SyncSourceSplitLine[];
};

export type ListTransactionsForSyncInput = {
  accountId: string;
  /** Inclusive ISO `YYYY-MM-DD`; omit for open-ended. */
  startDate?: string;
  endDate?: string;
};

/** A target transaction the sync engine wants created (create-only, no splits). */
export type SyncTargetTransactionInput = {
  accountId: string;
  date: string;
  amount: MinorUnitAmount;
  /** Existing target payee id; wins over `payeeName` when set. */
  payeeId?: string | null;
  /** Resolve/create a payee by name when no `payeeId` is given. */
  payeeName?: string | null;
  categoryId?: string | null;
  notes?: string | null;
  cleared?: boolean;
  /**
   * Durable target-side marker (Actual `imported_id`). The sync engine's own
   * mappings remain the source of truth; this is a recovery/dedupe safety net.
   */
  importedId?: string | null;
  /**
   * Split children to create inline under this transaction (RD-057 §6). When
   * present, the transport creates a grouped split whose parent is this row.
   */
  subtransactions?: SyncTargetSplitChild[] | null;
};

/** A resolved split child line for a grouped target split (RD-057 §6). */
export type SyncTargetSplitChild = {
  amount: MinorUnitAmount;
  categoryId?: string | null;
  payeeId?: string | null;
  payeeName?: string | null;
  notes?: string | null;
};

/** Fields of an existing target transaction to overwrite (RD-057 §4). */
export type UpdateTransactionForSyncInput = {
  transactionId: string;
  accountId: string;
  date: string;
  amount: MinorUnitAmount;
  /** Existing target payee id; wins over `payeeName` when set. */
  payeeId?: string | null;
  /** Resolve/create a payee by name when no `payeeId` is given. */
  payeeName?: string | null;
  categoryId?: string | null;
  notes?: string | null;
  cleared?: boolean;
};

/**
 * The persisted fields of a just-created target transaction, captured while the
 * id is recovered so callers can diff planned-vs-actual (e.g. target rules that
 * ran on create) without a second read.
 */
export type SyncAppliedSnapshot = {
  amount: number;
  date: string;
  cleared: boolean;
  categoryId: string | null;
  payeeId: string | null;
  notes: string | null;
};

export type SyncCreatedTransaction = {
  /** Index into the input array this result corresponds to. */
  requestIndex: number;
  /** Resolved target transaction id, or null if it could not be recovered. */
  transactionId: string | null;
  /** The marker actually written, echoed back for mapping records. */
  importedId: string | null;
  /** The payee id the transport resolved/created for this row (for diffing). */
  resolvedPayeeId?: string | null;
  /** The persisted row's fields, when recovered alongside the id. */
  applied?: SyncAppliedSnapshot | null;
};

export type CreateTransactionsForSyncResult = {
  created: SyncCreatedTransaction[];
};

export type ResolvedSyncPayee = {
  id: string;
  name: string;
  /** True when this call created the payee, false when an existing one matched. */
  created: boolean;
};

/** Minimal target transaction shape for the planner's duplicate heuristic. */
export type SyncTargetLookupTransaction = {
  id: string;
  date: string;
  amount: number;
  payeeName: string | null;
  categoryId: string | null;
};

/** Lightweight target lookup used for marker-match dedupe before applying. */
export type SyncTargetLookup = {
  payees: Payee[];
  /** Map of existing target `imported_id` -> target transaction id. */
  importedIdIndex: Map<string, string>;
  /**
   * Target transactions in range for the duplicate heuristic. Returned here so
   * a single read + payee load covers both the marker index and dedupe, instead
   * of a second full `listTransactionsForSync` (which reloads payees+categories).
   */
  transactions: SyncTargetLookupTransaction[];
};

export interface ActualBenchTransport {
  readonly mode: ConnectionMode;
  sync(): Promise<void>;
  batchBudgetUpdates<T>(operation: () => Promise<T>): Promise<T>;
  runQuery<T>(body: object): Promise<T>;

  getServerVersion(): Promise<string | null>;

  getAccounts(): Promise<Account[]>;
  /** Account balances are returned in decimal currency units for entity pages. */
  getAccountBalances(): Promise<Map<string, number>>;
  /** Account initialBalance follows Account.initialBalance: decimal currency units. */
  createAccount(input: Omit<Account, "id">): Promise<Account>;
  updateAccount(id: string, patch: Partial<Omit<Account, "id" | "initialBalance">>): Promise<void>;
  deleteAccount(id: string): Promise<void>;

  getPayees(): Promise<Payee[]>;
  createPayee(input: Pick<Payee, "name">): Promise<Payee>;
  updatePayee(id: string, patch: Partial<Pick<Payee, "name">>): Promise<void>;
  deletePayee(id: string): Promise<void>;
  mergePayees(targetId: string, mergeIds: string[]): Promise<void>;

  getCategoryGroups(): Promise<CategoryGroupsResponse>;
  createCategoryGroup(input: Pick<CategoryGroup, "name" | "isIncome" | "hidden">): Promise<string>;
  updateCategoryGroup(id: string, patch: Partial<Pick<CategoryGroup, "name" | "hidden">>): Promise<void>;
  deleteCategoryGroup(id: string): Promise<void>;
  createCategory(input: Pick<Category, "name" | "groupId" | "isIncome" | "hidden">): Promise<string>;
  updateCategory(id: string, patch: Partial<Pick<Category, "name" | "hidden">>): Promise<void>;
  deleteCategory(id: string): Promise<void>;

  getTags(): Promise<Tag[]>;
  createTag(input: Pick<Tag, "name"> & Partial<Pick<Tag, "color" | "description">>): Promise<Tag>;
  updateTag(id: string, patch: Partial<Pick<Tag, "name" | "color" | "description">>): Promise<void>;
  deleteTag(id: string): Promise<void>;

  getRules(): Promise<Rule[]>;
  createRule(input: Omit<Rule, "id">): Promise<Rule>;
  updateRule(id: string, patch: Partial<Omit<Rule, "id">>): Promise<void>;
  deleteRule(id: string): Promise<void>;

  getSchedules(): Promise<Schedule[]>;
  createSchedule(input: ScheduleWriteInput): Promise<Schedule>;
  updateSchedule(id: string, input: ScheduleWriteInput): Promise<void>;
  deleteSchedule(id: string): Promise<void>;

  getBudgetMonths(): Promise<string[]>;
  /** Budget month amount fields are integer minor units. */
  getBudgetMonth(month: string): Promise<TransportBudgetMonth>;
  setBudgetAmount(month: string, categoryId: string, amount: MinorUnitAmount): Promise<void>;
  setBudgetCarryover(month: string, categoryId: string, flag: boolean): Promise<void>;
  transferBudget(month: string, input: BudgetTransferInput): Promise<void>;
  holdBudgetForNextMonth(month: string, amount: MinorUnitAmount): Promise<void>;
  resetBudgetHold(month: string): Promise<void>;

  // --- Budget File Sync (RD-053 / PR-019) ---------------------------------
  /** Report which Budget File Sync operations this transport can perform. */
  getSyncCapabilities(): SyncCapabilityReport;
  /** Read source transactions with split lines inline and names resolved. */
  listTransactionsForSync(
    input: ListTransactionsForSyncInput
  ): Promise<SyncSourceTransaction[]>;
  /** Match an existing payee by normalized name, or create it if missing. */
  createOrResolvePayee(input: { name: string }): Promise<ResolvedSyncPayee>;
  /** Create target transactions (create-only; splits are pre-exploded). */
  createTransactionsForSync(
    inputs: SyncTargetTransactionInput[]
  ): Promise<CreateTransactionsForSyncResult>;
  /**
   * Update a previously-synced target transaction (RD-057 §4). Returns the
   * persisted fields after the update so the caller can refresh its mapping
   * fingerprint. Only the fields present in `patch` are changed.
   */
  updateTransactionForSync(
    input: UpdateTransactionForSyncInput
  ): Promise<SyncAppliedSnapshot | null>;
  /**
   * Read a single target transaction's syncable fields, or null if it no longer
   * exists (RD-057 §4/§5). Used to guard against overwriting manual edits and to
   * detect source-deleted mappings.
   */
  readTargetTransactionForSync(
    input: { accountId: string; transactionId: string; date?: string }
  ): Promise<SyncAppliedSnapshot | null>;
  /** Delete a previously-synced target transaction (RD-057 §5). */
  deleteTransactionForSync(input: { transactionId: string }): Promise<void>;
  /** Load target payees + existing sync markers for dedupe/apply checks. */
  getTargetLookupForSync(
    input: ListTransactionsForSyncInput
  ): Promise<SyncTargetLookup>;

  getNotesIndex(): Promise<NotesIndex>;
  getAccountNote(accountId: string): Promise<string>;
  getAllNotes(): Promise<Map<string, string>>;
  getCategoryLikeNote(id: string): Promise<string>;
  setAccountNote(accountId: string, note: string): Promise<void>;
  deleteAccountNote(accountId: string): Promise<void>;
  setCategoryNote(id: string, note: string): Promise<void>;
  deleteCategoryNote(id: string): Promise<void>;
  setBudgetMonthNote(month: string, note: string): Promise<void>;
  deleteBudgetMonthNote(month: string): Promise<void>;
}

export async function syncTransportAfterChanges(
  transport: ActualBenchTransport,
  changed: boolean
): Promise<void> {
  if (changed && transport.mode === "browser-api") await transport.sync();
}

export async function settleTransportWrites<TInput, TResult>(
  transport: ActualBenchTransport,
  inputs: TInput[],
  write: (input: TInput) => Promise<TResult>
): Promise<PromiseSettledResult<TResult>[]> {
  if (transport.mode !== "browser-api") {
    return Promise.allSettled(inputs.map(write));
  }

  const results: PromiseSettledResult<TResult>[] = [];
  for (const input of inputs) {
    try {
      results.push({ status: "fulfilled", value: await write(input) });
    } catch (reason) {
      results.push({ status: "rejected", reason });
    }
  }
  return results;
}

export function unsupportedTransportOperation(
  mode: ConnectionMode,
  operation: string
): Error {
  return new Error(
    mode === "browser-api"
      ? "Direct browser API transport does not support " + operation + " yet."
      : "Transport operation " + operation + " is not supported."
  );
}
