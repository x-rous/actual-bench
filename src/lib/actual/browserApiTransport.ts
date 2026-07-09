import { normalizeAccount } from "../api/accounts";
import {
  normalizeCategory,
  normalizeCategoryGroup,
  type CategoryGroupsResponse,
} from "../api/categoryGroups";
import {
  extractNote,
  parseNotesIndexIds,
  toAccountNoteId,
  toBudgetNoteId,
  type NoteRow,
} from "../api/notes";
import { normalizePayee } from "../api/payees";
import { normalizeRule } from "../api/rules";
import { normalizeSchedule } from "../api/schedules";
import { normalizeTag } from "../api/tags";
import type { BrowserApiConnection } from "@/store/connection";
import type {
  ApiAccount,
  ApiCategory,
  ApiCategoryGroup,
  ApiPayee,
  ApiRule,
  ApiSchedule,
  ApiTag,
} from "@/types/api";
import type {
  Account,
  Payee,
  Rule,
  Schedule,
  Tag,
} from "@/types/entities";
import {
  getBrowserApiRuntime,
  syncBrowserApiRuntime,
  type ActualBrowserApi,
  type ApiImportTransaction,
  type ApiTransaction,
  type ActualQueryBuilder,
} from "./browser/runtime";
import { prepareRuleForTransport, prepareRulePatchForTransport } from "./ruleMutation";
import {
  unsupportedTransportOperation,
  type ActualBenchTransport,
  type CreateTransactionsForSyncResult,
  type ListTransactionsForSyncInput,
  type ResolvedSyncPayee,
  type ScheduleWriteInput,
  type SyncAppliedSnapshot,
  type SyncCreatedTransaction,
  type SyncSourceSplitLine,
  type SyncSourceTransaction,
  type SyncTargetLookup,
  type SyncTargetLookupTransaction,
  type SyncTargetTransactionInput,
  type TransportBudgetMonth,
} from "./transport";
import { getBudgetFileSyncCapabilities } from "@/lib/sync/capabilities";
import { normalizeName } from "@/lib/sync/normalize";

type RecordLike = Record<string, unknown>;
type ApiCategoryGroupWithId = ApiCategoryGroup & { id: string };

function isRecord(value: unknown): value is RecordLike {
  return typeof value === "object" && value !== null;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function asBoolean(value: unknown): boolean {
  return value === true;
}

function normalizeDirectAccount(raw: unknown): Account | null {
  if (!isRecord(raw)) return null;
  const id = asString(raw.id);
  const name = asString(raw.name);
  if (!id || !name) return null;

  return normalizeAccount({
    id,
    name,
    offbudget: asBoolean(raw.offbudget),
    closed: asBoolean(raw.closed),
  } satisfies ApiAccount);
}

function normalizeDirectPayee(raw: unknown): Payee | null {
  if (!isRecord(raw)) return null;
  const id = asString(raw.id);
  const name = asString(raw.name);
  if (!id || !name) return null;

  return normalizePayee({
    id,
    name,
    category: asString(raw.category),
    transfer_acct: asString(raw.transfer_acct),
  } satisfies ApiPayee);
}

function normalizeDirectTag(raw: unknown): Tag | null {
  if (!isRecord(raw)) return null;
  const id = asString(raw.id);
  const tag = asString(raw.tag) ?? asString(raw.name);
  if (!id || !tag) return null;

  return normalizeTag({
    id,
    tag,
    color: asString(raw.color) ?? null,
    description: asString(raw.description) ?? null,
  } satisfies ApiTag);
}

function normalizeDirectRule(raw: unknown): Rule | null {
  if (!isRecord(raw) || !asString(raw.id)) return null;
  return normalizeRule(raw as ApiRule);
}

function normalizeDirectSchedule(raw: unknown): Schedule | null {
  if (!isRecord(raw) || !asString(raw.id)) return null;
  return normalizeSchedule(raw as ApiSchedule);
}

function toDirectCategory(raw: unknown, fallbackGroupId?: string): ApiCategory | null {
  if (!isRecord(raw)) return null;
  const id = asString(raw.id);
  const name = asString(raw.name);
  const groupId = asString(raw.group_id) ?? asString(raw.group) ?? fallbackGroupId;
  if (!id || !name || !groupId) return null;

  return {
    id,
    name,
    group_id: groupId,
    is_income: asBoolean(raw.is_income),
    hidden: asBoolean(raw.hidden),
  } satisfies ApiCategory;
}

function toDirectCategoryGroup(raw: unknown): ApiCategoryGroup | null {
  if (!isRecord(raw)) return null;
  const id = asString(raw.id);
  const name = asString(raw.name);
  if (!id || !name) return null;

  const categories = Array.isArray(raw.categories)
    ? raw.categories
        .map((category) => toDirectCategory(category, id))
        .filter((category): category is ApiCategory => category !== null)
    : undefined;

  return {
    id,
    name,
    is_income: asBoolean(raw.is_income),
    hidden: asBoolean(raw.hidden),
    ...(categories ? { categories } : {}),
  } satisfies ApiCategoryGroup;
}

function responseRows<T>(response: unknown): T[] {
  if (Array.isArray(response)) return response as T[];
  if (isRecord(response) && Array.isArray(response.data)) return response.data as T[];
  return [];
}

function assertRecord(value: unknown, label: string): RecordLike {
  if (!isRecord(value)) {
    throw new Error("Direct browser API query adapter expected " + label + " to be an object.");
  }
  return value;
}

function getActualQueryInput(body: object): RecordLike {
  const parsed = assertRecord(body, "the query body");
  if ("ActualQLquery" in parsed) {
    return assertRecord(parsed.ActualQLquery, "ActualQLquery");
  }
  if ("table" in parsed) return parsed;

  throw new Error(
    'Direct browser API query adapter requires a query object with "table" or an "ActualQLquery" wrapper.'
  );
}

function assertQueryBuilderMethod(
  query: ActualQueryBuilder,
  method: keyof ActualQueryBuilder
): void {
  if (typeof query[method] !== "function") {
    throw new Error(
      "Direct browser API query adapter cannot apply ActualQL field because the installed Actual API query builder does not expose " +
        method +
        "()."
    );
  }
}

function toRepeatedValues(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [value];
}

function applyRepeatedBuilderMethod(
  query: ActualQueryBuilder,
  method: "filter" | "groupBy" | "orderBy",
  value: unknown
): ActualQueryBuilder {
  if (value === undefined) return query;

  assertQueryBuilderMethod(query, method);
  let nextQuery = query;
  for (const item of toRepeatedValues(value)) {
    if (method === "filter") {
      nextQuery = nextQuery.filter(assertRecord(item, "ActualQLquery.filter item"));
    } else {
      nextQuery = nextQuery[method](item);
    }
  }
  return nextQuery;
}

function getSafeInteger(value: unknown, field: "limit" | "offset"): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0
  ) {
    throw new Error(
      "Direct browser API query adapter requires ActualQLquery." +
        field +
        " to be a non-negative safe integer."
    );
  }
  return value;
}

function getBooleanFlag(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(
      "Direct browser API query adapter requires ActualQLquery." +
        field +
        " to be a boolean when provided."
    );
  }
  return value;
}

function getUnfilterValue(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "string") return [value];
  if (
    Array.isArray(value) &&
    value.every((item): item is string => typeof item === "string")
  ) {
    return value;
  }
  throw new Error(
    "Direct browser API query adapter requires ActualQLquery.unfilter to be a string or string array."
  );
}

function createBrowserQuery(api: ActualBrowserApi, body: object): unknown {
  if (typeof api.q !== "function") {
    throw unsupportedTransportOperation("browser-api", "ActualQL queries");
  }

  const query = getActualQueryInput(body);
  const supportedKeys = new Set([
    "table",
    "options",
    "filter",
    "select",
    "calculate",
    "groupBy",
    "orderBy",
    "limit",
    "offset",
    "unfilter",
    "raw",
    "withDead",
    "withoutValidatedRefs",
  ]);
  for (const key of Object.keys(query)) {
    if (!supportedKeys.has(key)) {
      throw new Error(
        "Direct browser API query adapter does not support ActualQL field: " + key
      );
    }
  }

  const table = asString(query.table);
  if (!table) {
    throw new Error("Direct browser API query adapter requires ActualQLquery.table.");
  }

  let browserQuery = api.q(table);
  if (query.options !== undefined) {
    browserQuery = browserQuery.options(assertRecord(query.options, "ActualQLquery.options"));
  }
  browserQuery = applyRepeatedBuilderMethod(browserQuery, "filter", query.filter);
  if (query.calculate !== undefined) {
    if (query.select !== undefined) {
      throw new Error(
        "Direct browser API query adapter does not support using select and calculate together."
      );
    }
    browserQuery = browserQuery.calculate(query.calculate);
  } else if (query.select !== undefined) {
    browserQuery = browserQuery.select(query.select);
  }
  browserQuery = applyRepeatedBuilderMethod(browserQuery, "groupBy", query.groupBy);
  browserQuery = applyRepeatedBuilderMethod(browserQuery, "orderBy", query.orderBy);
  if (query.limit !== undefined) {
    browserQuery = browserQuery.limit(getSafeInteger(query.limit, "limit"));
  }
  if (query.offset !== undefined) {
    browserQuery = browserQuery.offset(getSafeInteger(query.offset, "offset"));
  }

  const unfilter = getUnfilterValue(query.unfilter);
  if (unfilter !== undefined) {
    assertQueryBuilderMethod(browserQuery, "unfilter");
    browserQuery = browserQuery.unfilter(unfilter);
  }

  // Do not inject Direct-only default limits here. The workspace already warns
  // about risky unbounded reads, and silently changing Direct semantics would
  // make the same saved query return different data by connection mode.
  if (query.raw !== undefined && getBooleanFlag(query.raw, "raw")) {
    assertQueryBuilderMethod(browserQuery, "raw");
    browserQuery = browserQuery.raw();
  }
  if (query.withDead !== undefined && getBooleanFlag(query.withDead, "withDead")) {
    assertQueryBuilderMethod(browserQuery, "withDead");
    browserQuery = browserQuery.withDead();
  }
  if (
    query.withoutValidatedRefs !== undefined &&
    getBooleanFlag(query.withoutValidatedRefs, "withoutValidatedRefs")
  ) {
    assertQueryBuilderMethod(browserQuery, "withoutValidatedRefs");
    browserQuery = browserQuery.withoutValidatedRefs();
  }

  return browserQuery;
}

function getErrorMessage(value: unknown): string {
  if (value instanceof Error) return value.message;
  if (isRecord(value) && typeof value.message === "string") return value.message;
  return String(value || "Direct ActualQL query failed.");
}

function cleanBrowserQueryError(value: unknown): Error {
  const firstLine = getErrorMessage(value).split("\n")[0]?.trim();
  return new Error(
    firstLine
      ? "Direct ActualQL query failed: " + firstLine
      : "Direct ActualQL query failed."
  );
}

async function runBrowserQuery<T>(
  connection: BrowserApiConnection,
  body: object
): Promise<T> {
  const api = await getBrowserApiRuntime(connection);
  const runner = api.aqlQuery?.bind(api) ?? api.runQuery?.bind(api);
  if (!runner) throw unsupportedTransportOperation("browser-api", "ActualQL queries");

  const query = createBrowserQuery(api, body);
  try {
    return (await runner(query)) as T;
  } catch (err) {
    throw cleanBrowserQueryError(err);
  }
}

function toBudgetAmount(amount: number): number {
  if (!Number.isFinite(amount)) {
    throw new Error("Budget amount must be a finite number.");
  }
  return Math.round(amount);
}

function normalizeBudgetMonth(raw: unknown): TransportBudgetMonth {
  if (!isRecord(raw)) throw new Error("Budget month response was not an object.");
  return raw as TransportBudgetMonth;
}

function findBudgetedAmount(
  month: TransportBudgetMonth,
  categoryId: string
): number {
  for (const group of month.categoryGroups) {
    for (const category of group.categories) {
      if (category.id === categoryId) return category.budgeted ?? 0;
    }
  }
  throw new Error("Category " + categoryId + " was not found in month " + month.month + ".");
}

let browserBudgetBatchDepth = 0;

async function runBrowserBudgetBatch<T>(
  connection: BrowserApiConnection,
  operation: () => Promise<T>
): Promise<T> {
  if (browserBudgetBatchDepth > 0) return operation();

  const api = await getBrowserApiRuntime(connection);
  let result: T | undefined;
  await api.batchBudgetUpdates(async () => {
    browserBudgetBatchDepth++;
    try {
      result = await operation();
    } finally {
      browserBudgetBatchDepth--;
    }
  });
  return result as T;
}

function buildActualQuery(
  api: ActualBrowserApi,
  table: string,
  select: "*" | string
): unknown {
  if (typeof api.q === "function") {
    return api.q(table).select(select);
  }

  return { table, select };
}

function denormalizeSchedule(input: ScheduleWriteInput): Omit<ApiSchedule, "id"> {
  if (input.date == null) throw new Error("Schedule date is required but was missing");

  const schedule: Omit<ApiSchedule, "id"> = {
    date: input.date,
    posts_transaction: input.postsTransaction,
    payee: input.payeeId ?? null,
    account: input.accountId ?? null,
  };
  if (input.name !== undefined) schedule.name = input.name;
  if (input.amount !== undefined) schedule.amount = input.amount;
  if (input.amountOp !== undefined) schedule.amountOp = input.amountOp;
  return schedule;
}

type BrowserRuleStage = "pre" | "post" | null;
type BrowserRule = Omit<ApiRule, "stage"> & { stage: BrowserRuleStage };

function toBrowserRuleStage(stage: Rule["stage"]): BrowserRuleStage {
  return stage === "default" ? null : stage;
}

function denormalizeRuleForBrowser(input: Omit<Rule, "id">): Omit<BrowserRule, "id"> {
  const rule = prepareRuleForTransport(input);
  return {
    ...rule,
    stage: toBrowserRuleStage(rule.stage),
  } as unknown as Omit<BrowserRule, "id">;
}

function denormalizeRulePatchForBrowser(
  id: string,
  patch: Partial<Omit<Rule, "id">>
): BrowserRule {
  const rule = prepareRulePatchForTransport(patch);
  return {
    id,
    ...rule,
    ...(rule.stage !== undefined ? { stage: toBrowserRuleStage(rule.stage) } : {}),
  } as unknown as BrowserRule;
}

async function getBrowserAccounts(
  connection: BrowserApiConnection
): Promise<Account[]> {
  const api = await getBrowserApiRuntime(connection);
  return (await api.getAccounts())
    .map(normalizeDirectAccount)
    .filter((account): account is Account => account !== null);
}

async function mapWithConcurrency<TInput, TResult>(
  inputs: TInput[],
  limit: number,
  mapper: (input: TInput) => Promise<TResult>
): Promise<TResult[]> {
  const results = new Array<TResult>(inputs.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < inputs.length) {
      const index = nextIndex++;
      results[index] = await mapper(inputs[index]);
    }
  }

  const workerCount = Math.min(limit, inputs.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

async function getBrowserAccountBalances(
  connection: BrowserApiConnection
): Promise<Map<string, number>> {
  const api = await getBrowserApiRuntime(connection);
  const accounts = await getBrowserAccounts(connection);
  const entries = await mapWithConcurrency(accounts, 6, async (account) => {
    const balance = await api.getAccountBalance(account.id);
    return [account.id, balance / 100] as const;
  });

  return new Map(entries);
}

async function getBrowserCategoryGroups(
  connection: BrowserApiConnection
): Promise<CategoryGroupsResponse> {
  const api = await getBrowserApiRuntime(connection);
  const groupRows = (await api.getCategoryGroups())
    .map(toDirectCategoryGroup)
    .filter(
      (group): group is ApiCategoryGroupWithId =>
        group !== null && typeof group.id === "string"
    );

  let categoryRows = groupRows.flatMap((group) => group.categories ?? []);
  const hasGroupsWithoutNestedCategories = groupRows.some(
    (group) => (group.categories?.length ?? 0) === 0
  );

  if (hasGroupsWithoutNestedCategories) {
    const categoriesFromApi = (await api.getCategories().catch(() => []))
      .map((category) => toDirectCategory(category))
      .filter((category): category is ApiCategory => category !== null);
    if (categoriesFromApi.length > 0) categoryRows = categoriesFromApi;
  }

  const categoriesByGroupId = new Map<string, ApiCategory[]>();
  for (const category of categoryRows) {
    const groupCategories = categoriesByGroupId.get(category.group_id);
    if (groupCategories) {
      groupCategories.push(category);
    } else {
      categoriesByGroupId.set(category.group_id, [category]);
    }
  }

  const groups = groupRows.map((group) =>
    normalizeCategoryGroup({
      ...group,
      categories: categoriesByGroupId.get(group.id) ?? [],
    })
  );
  const categories = categoryRows
    .filter((category): category is ApiCategory & { group_id: string } =>
      typeof category.group_id === "string"
    )
    .map((category) => normalizeCategory(category, category.group_id));

  return { groups, categories };
}

async function getBrowserAllNotes(
  connection: BrowserApiConnection
): Promise<Map<string, string>> {
  const api = await getBrowserApiRuntime(connection);
  const query = buildActualQuery(api, "notes", "*");
  const runner = api.aqlQuery?.bind(api) ?? api.runQuery?.bind(api);
  let rows: NoteRow[] = [];
  if (runner) {
    try {
      rows = responseRows<NoteRow>(await runner(query));
    } catch (err) {
      throw cleanBrowserQueryError(err);
    }
  }

  const map = new Map<string, string>();
  for (const row of rows) {
    if (row.id && row.note) map.set(row.id, row.note);
  }
  return map;
}

// --- Budget File Sync transaction primitives (RD-053 / PR-019) -------------

type NameLookup = {
  payeeNames: Map<string, string>;
  categoryNames: Map<string, string>;
};

async function loadSyncNameLookup(
  api: ActualBrowserApi
): Promise<NameLookup> {
  const payeeNames = new Map<string, string>();
  for (const raw of await api.getPayees()) {
    const payee = normalizeDirectPayee(raw);
    if (payee) payeeNames.set(payee.id, payee.name);
  }

  const categoryNames = new Map<string, string>();
  for (const raw of await api.getCategories().catch(() => [])) {
    const category = toDirectCategory(raw);
    if (category?.id) categoryNames.set(category.id, category.name);
  }

  return { payeeNames, categoryNames };
}

function toSyncSplitLine(
  raw: ApiTransaction,
  lookup: NameLookup
): SyncSourceSplitLine {
  const payeeId = asString(raw.payee) ?? null;
  const categoryId = asString(raw.category) ?? null;
  return {
    id: asString(raw.id) ?? null,
    amount: typeof raw.amount === "number" ? raw.amount : 0,
    payeeId,
    payeeName: payeeId ? lookup.payeeNames.get(payeeId) ?? null : null,
    categoryId,
    categoryName: categoryId ? lookup.categoryNames.get(categoryId) ?? null : null,
    notes: asString(raw.notes) ?? null,
  };
}

function toSyncSourceTransaction(
  raw: ApiTransaction,
  lookup: NameLookup
): SyncSourceTransaction {
  const payeeId = asString(raw.payee) ?? null;
  const categoryId = asString(raw.category) ?? null;
  const isParent = raw.is_parent === true;
  const splitLines = isParent && Array.isArray(raw.subtransactions)
    ? raw.subtransactions.map((child) => toSyncSplitLine(child, lookup))
    : [];

  return {
    id: raw.id,
    accountId: raw.account,
    date: raw.date,
    amount: typeof raw.amount === "number" ? raw.amount : 0,
    payeeId,
    payeeName: payeeId ? lookup.payeeNames.get(payeeId) ?? null : null,
    categoryId,
    categoryName: categoryId ? lookup.categoryNames.get(categoryId) ?? null : null,
    notes: asString(raw.notes) ?? null,
    cleared: raw.cleared === true,
    reconciled: raw.reconciled === true,
    importedId: asString(raw.imported_id) ?? null,
    isParent,
    isChild: raw.is_child === true,
    parentId: asString(raw.parent_id) ?? null,
    splitLines,
  };
}

async function listBrowserTransactionsForSync(
  connection: BrowserApiConnection,
  input: ListTransactionsForSyncInput
): Promise<SyncSourceTransaction[]> {
  const api = await getBrowserApiRuntime(connection);
  const lookup = await loadSyncNameLookup(api);
  // Empty date bounds are treated as open-ended by the runtime's grouped query.
  const rows = await api.getTransactions(
    input.accountId,
    input.startDate ?? "",
    input.endDate ?? ""
  );
  return rows
    .filter((row): row is ApiTransaction => isRecord(row) && typeof row.id === "string")
    // Split children arrive inline under their parent; skip any that also leak
    // in at the top level so we never double-count a split line.
    .filter((row) => row.is_child !== true)
    .map((row) => toSyncSourceTransaction(row, lookup));
}

async function createOrResolveBrowserPayee(
  connection: BrowserApiConnection,
  name: string
): Promise<ResolvedSyncPayee> {
  const api = await getBrowserApiRuntime(connection);
  const target = normalizeName(name);
  for (const raw of await api.getPayees()) {
    const payee = normalizeDirectPayee(raw);
    if (payee && normalizeName(payee.name) === target) {
      return { id: payee.id, name: payee.name, created: false };
    }
  }
  const id = await api.createPayee({ name });
  return { id, name, created: true };
}

async function createBrowserTransactionsForSync(
  connection: BrowserApiConnection,
  inputs: SyncTargetTransactionInput[]
): Promise<CreateTransactionsForSyncResult> {
  const api = await getBrowserApiRuntime(connection);
  if (inputs.length === 0) return { created: [] };

  // 1. Resolve/create every payee ONCE for the whole batch (load payees once,
  //    create missing ones on demand), instead of a lookup per transaction.
  const payeeIdByName = new Map<string, string>();
  for (const raw of await api.getPayees()) {
    const payee = normalizeDirectPayee(raw);
    if (payee) payeeIdByName.set(normalizeName(payee.name), payee.id);
  }
  async function resolvePayeeId(input: SyncTargetTransactionInput): Promise<string | null> {
    if (input.payeeId) return input.payeeId;
    if (!input.payeeName) return null;
    const key = normalizeName(input.payeeName);
    const existing = payeeIdByName.get(key);
    if (existing) return existing;
    const id = await api.createPayee({ name: input.payeeName });
    payeeIdByName.set(key, id);
    return id;
  }

  // 2. Build payloads with resolved payees, grouped by target account (Budget
  //    File Sync uses a single account, but grouping keeps this general).
  type Entry = { index: number; input: SyncTargetTransactionInput; payload: ApiImportTransaction; payeeId: string | null };
  const byAccount = new Map<string, { entries: Entry[]; minDate: string; maxDate: string }>();
  for (let index = 0; index < inputs.length; index++) {
    const input = inputs[index];
    const payeeId = await resolvePayeeId(input);
    const payload: ApiImportTransaction = {
      date: input.date,
      amount: input.amount,
      payee: payeeId,
      category: input.categoryId ?? null,
      notes: input.notes ?? null,
      // Actual defaults missing `cleared` to true; be explicit for synced rows.
      cleared: input.cleared ?? false,
    };
    if (input.importedId) payload.imported_id = input.importedId;

    const group = byAccount.get(input.accountId);
    if (group) {
      group.entries.push({ index, input, payload, payeeId });
      if (input.date < group.minDate) group.minDate = input.date;
      if (input.date > group.maxDate) group.maxDate = input.date;
    } else {
      byAccount.set(input.accountId, { entries: [{ index, input, payload, payeeId }], minDate: input.date, maxDate: input.date });
    }
  }

  // 3. One addTransactions per account (a plain insert — no dedupe/reconcile, so
  //    created rows match the planned payloads; see the Slice 1 spike notes for
  //    why this is preferred over importTransactions), then ONE range read per
  //    account to recover ids + persisted fields by marker.
  const created: SyncCreatedTransaction[] = new Array(inputs.length);
  for (const [accountId, group] of byAccount) {
    await api.addTransactions(accountId, group.entries.map((e) => e.payload), {
      learnCategories: false,
      runTransfers: false,
    });

    const rowByMarker = new Map<string, ApiTransaction>();
    const rows = await api.getTransactions(accountId, group.minDate, group.maxDate);
    for (const row of rows) {
      if (!isRecord(row)) continue;
      const marker = asString(row.imported_id);
      if (marker && !rowByMarker.has(marker)) rowByMarker.set(marker, row as ApiTransaction);
    }

    for (const entry of group.entries) {
      const marker = entry.input.importedId ?? null;
      const row = marker ? rowByMarker.get(marker) : undefined;
      created[entry.index] = {
        requestIndex: entry.index,
        transactionId: row ? asString(row.id) ?? null : null,
        importedId: marker,
        resolvedPayeeId: entry.payeeId,
        applied: row ? appliedFromRow(row, entry.input.date) : null,
      };
    }
  }

  return { created };
}

function appliedFromRow(row: ApiTransaction, fallbackDate: string): SyncAppliedSnapshot {
  return {
    amount: typeof row.amount === "number" ? row.amount : 0,
    date: asString(row.date) ?? fallbackDate,
    cleared: row.cleared === true,
    categoryId: asString(row.category) ?? null,
    payeeId: asString(row.payee) ?? null,
    notes: asString(row.notes) ?? null,
  };
}

async function getBrowserTargetLookupForSync(
  connection: BrowserApiConnection,
  input: ListTransactionsForSyncInput
): Promise<SyncTargetLookup> {
  const api = await getBrowserApiRuntime(connection);
  const payees = (await api.getPayees())
    .map(normalizeDirectPayee)
    .filter((payee): payee is Payee => payee !== null);
  const payeeNameById = new Map(payees.map((p) => [p.id, p.name]));

  // Single range read serves BOTH the marker index and the dedupe transaction
  // list, so the caller does not need a second listTransactionsForSync (which
  // would reload payees + categories again).
  const importedIdIndex = new Map<string, string>();
  const transactions: SyncTargetLookupTransaction[] = [];
  const rows = await api.getTransactions(
    input.accountId,
    input.startDate ?? "",
    input.endDate ?? ""
  );
  for (const row of rows) {
    if (!isRecord(row) || row.is_child === true) continue;
    const id = asString(row.id);
    if (!id) continue;
    const importedId = asString(row.imported_id);
    if (importedId && !importedIdIndex.has(importedId)) importedIdIndex.set(importedId, id);
    const payeeId = asString(row.payee);
    transactions.push({
      id,
      date: asString(row.date) ?? "",
      amount: typeof row.amount === "number" ? row.amount : 0,
      payeeName: payeeId ? payeeNameById.get(payeeId) ?? null : null,
      categoryId: asString(row.category) ?? null,
    });
  }

  return { payees, importedIdIndex, transactions };
}

export function createBrowserApiTransport(
  connection: BrowserApiConnection
): ActualBenchTransport {
  return {
    mode: connection.mode,
    sync: () => syncBrowserApiRuntime(connection),
    batchBudgetUpdates: (operation) => runBrowserBudgetBatch(connection, operation),
    runQuery: (body) => runBrowserQuery(connection, body),
    getServerVersion: async () => {
      const api = await getBrowserApiRuntime(connection);
      if (typeof api.getServerVersion !== "function") return null;
      const result = await api.getServerVersion().catch(() => null);
      return result && "version" in result ? result.version : null;
    },
    getAccounts: () => getBrowserAccounts(connection),
    getAccountBalances: () => getBrowserAccountBalances(connection),
    createAccount: async (input) => {
      const api = await getBrowserApiRuntime(connection);
      const id = await api.createAccount(
        {
          name: input.name,
          offbudget: input.offBudget,
          closed: false,
        },
        input.initialBalance !== undefined
          ? Math.round(input.initialBalance * 100)
          : undefined
      );
      if (input.closed) await api.closeAccount(id);
      return { id, ...input };
    },
    updateAccount: async (id, patch) => {
      const api = await getBrowserApiRuntime(connection);
      const fields: Partial<ApiAccount> = {};
      if (patch.name !== undefined) fields.name = patch.name;
      if (patch.offBudget !== undefined) fields.offbudget = patch.offBudget;
      if (Object.keys(fields).length > 0) await api.updateAccount(id, fields);
      if (patch.closed === true) await api.closeAccount(id);
      if (patch.closed === false) await api.reopenAccount(id);
    },
    deleteAccount: async (id) => {
      const api = await getBrowserApiRuntime(connection);
      await api.deleteAccount(id);
    },

    getPayees: async () => {
      const api = await getBrowserApiRuntime(connection);
      return (await api.getPayees())
        .map(normalizeDirectPayee)
        .filter((payee): payee is Payee => payee !== null);
    },
    createPayee: async (input) => {
      const api = await getBrowserApiRuntime(connection);
      const id = await api.createPayee({ name: input.name });
      return { id, name: input.name };
    },
    updatePayee: async (id, patch) => {
      const api = await getBrowserApiRuntime(connection);
      const fields: Partial<ApiPayee> = {};
      if (patch.name !== undefined) fields.name = patch.name;
      await api.updatePayee(id, fields);
    },
    deletePayee: async (id) => {
      const api = await getBrowserApiRuntime(connection);
      await api.deletePayee(id);
    },
    mergePayees: async (targetId, mergeIds) => {
      const api = await getBrowserApiRuntime(connection);
      await api.mergePayees(targetId, mergeIds);
    },

    getCategoryGroups: () => getBrowserCategoryGroups(connection),
    createCategoryGroup: async (input) => {
      const api = await getBrowserApiRuntime(connection);
      return api.createCategoryGroup({
        name: input.name,
        is_income: input.isIncome,
        hidden: input.hidden,
      });
    },
    updateCategoryGroup: async (id, patch) => {
      const api = await getBrowserApiRuntime(connection);
      const fields: Partial<ApiCategoryGroup> = {};
      if (patch.name !== undefined) fields.name = patch.name;
      if (patch.hidden !== undefined) fields.hidden = patch.hidden;
      await api.updateCategoryGroup(id, fields);
    },
    deleteCategoryGroup: async (id) => {
      const api = await getBrowserApiRuntime(connection);
      await api.deleteCategoryGroup(id);
    },
    createCategory: async (input) => {
      const api = await getBrowserApiRuntime(connection);
      return api.createCategory({
        name: input.name,
        group_id: input.groupId,
        is_income: input.isIncome,
        hidden: input.hidden,
      });
    },
    updateCategory: async (id, patch) => {
      const api = await getBrowserApiRuntime(connection);
      const fields: Partial<ApiCategory> = {};
      if (patch.name !== undefined) fields.name = patch.name;
      if (patch.hidden !== undefined) fields.hidden = patch.hidden;
      await api.updateCategory(id, fields);
    },
    deleteCategory: async (id) => {
      const api = await getBrowserApiRuntime(connection);
      await api.deleteCategory(id);
    },

    getTags: async () => {
      const api = await getBrowserApiRuntime(connection);
      return (await api.getTags())
        .map(normalizeDirectTag)
        .filter((tag): tag is Tag => tag !== null);
    },
    createTag: async (input) => {
      const api = await getBrowserApiRuntime(connection);
      const id = await api.createTag({
        tag: input.name,
        color: input.color ?? null,
        description: input.description ?? null,
      });
      return { id, name: input.name, color: input.color, description: input.description };
    },
    updateTag: async (id, patch) => {
      const api = await getBrowserApiRuntime(connection);
      const fields: Partial<Omit<ApiTag, "id">> = {};
      if (patch.name !== undefined) fields.tag = patch.name;
      if ("color" in patch) fields.color = patch.color ?? null;
      if ("description" in patch) fields.description = patch.description ?? null;
      await api.updateTag(id, fields);
    },
    deleteTag: async (id) => {
      const api = await getBrowserApiRuntime(connection);
      await api.deleteTag(id);
    },

    getRules: async () => {
      const api = await getBrowserApiRuntime(connection);
      return (await api.getRules())
        .map(normalizeDirectRule)
        .filter((rule): rule is Rule => rule !== null);
    },
    createRule: async (input) => {
      const api = await getBrowserApiRuntime(connection);
      return normalizeRule(
        await api.createRule(denormalizeRuleForBrowser(input) as unknown as Omit<ApiRule, "id">)
      );
    },
    updateRule: async (id, patch) => {
      const api = await getBrowserApiRuntime(connection);
      await api.updateRule(denormalizeRulePatchForBrowser(id, patch) as unknown as ApiRule);
    },
    deleteRule: async (id) => {
      const api = await getBrowserApiRuntime(connection);
      await api.deleteRule(id);
    },

    getSchedules: async () => {
      const api = await getBrowserApiRuntime(connection);
      return (await api.getSchedules())
        .map(normalizeDirectSchedule)
        .filter((schedule): schedule is Schedule => schedule !== null);
    },
    createSchedule: async (input) => {
      const api = await getBrowserApiRuntime(connection);
      const id = await api.createSchedule(denormalizeSchedule(input));
      return {
        id,
        completed: false,
        ...input,
      };
    },
    updateSchedule: async (id, input) => {
      const api = await getBrowserApiRuntime(connection);
      await api.updateSchedule(id, denormalizeSchedule(input));
    },
    deleteSchedule: async (id) => {
      const api = await getBrowserApiRuntime(connection);
      await api.deleteSchedule(id);
    },

    getBudgetMonths: async () => {
      const api = await getBrowserApiRuntime(connection);
      return api.getBudgetMonths();
    },
    getBudgetMonth: async (month) => {
      const api = await getBrowserApiRuntime(connection);
      return normalizeBudgetMonth(await api.getBudgetMonth(month));
    },
    setBudgetAmount: async (month, categoryId, amount) => {
      const api = await getBrowserApiRuntime(connection);
      await api.setBudgetAmount(month, categoryId, toBudgetAmount(amount));
    },
    setBudgetCarryover: async (month, categoryId, flag) => {
      const api = await getBrowserApiRuntime(connection);
      await api.setBudgetCarryover(month, categoryId, flag);
    },
    transferBudget: async (month, input) => {
      await runBrowserBudgetBatch(connection, async () => {
        const api = await getBrowserApiRuntime(connection);
        const monthData = normalizeBudgetMonth(await api.getBudgetMonth(month));
        const fromBudgeted = findBudgetedAmount(monthData, input.fromCategoryId);
        const toBudgeted = findBudgetedAmount(monthData, input.toCategoryId);
        const amount = toBudgetAmount(input.amount);

        // Actual's browser API does not expose the server's category-transfer
        // endpoint. Setting both final budget values inside one batch keeps
        // the transfer atomic for the Direct transport.
        await api.setBudgetAmount(month, input.fromCategoryId, fromBudgeted - amount);
        await api.setBudgetAmount(month, input.toCategoryId, toBudgeted + amount);
      });
    },
    holdBudgetForNextMonth: async (month, amount) => {
      const api = await getBrowserApiRuntime(connection);
      await api.holdBudgetForNextMonth(month, toBudgetAmount(amount));
    },
    resetBudgetHold: async (month) => {
      const api = await getBrowserApiRuntime(connection);
      await api.resetBudgetHold(month);
    },

    getSyncCapabilities: () => getBudgetFileSyncCapabilities(connection),
    listTransactionsForSync: (input) =>
      listBrowserTransactionsForSync(connection, input),
    createOrResolvePayee: (input) =>
      createOrResolveBrowserPayee(connection, input.name),
    createTransactionsForSync: (inputs) =>
      createBrowserTransactionsForSync(connection, inputs),
    getTargetLookupForSync: (input) =>
      getBrowserTargetLookupForSync(connection, input),

    getNotesIndex: async () => {
      const notes = await getBrowserAllNotes(connection);
      return parseNotesIndexIds([...notes.keys()]);
    },
    getAccountNote: async (accountId) => {
      const api = await getBrowserApiRuntime(connection);
      return extractNote(await api.getNote(toAccountNoteId(accountId)));
    },
    getAllNotes: () => getBrowserAllNotes(connection),
    getCategoryLikeNote: async (id) => {
      const api = await getBrowserApiRuntime(connection);
      return extractNote(await api.getNote(id));
    },
    setAccountNote: async (accountId, note) => {
      const api = await getBrowserApiRuntime(connection);
      await api.updateNote(toAccountNoteId(accountId), note);
    },
    deleteAccountNote: async (accountId) => {
      const api = await getBrowserApiRuntime(connection);
      await api.updateNote(toAccountNoteId(accountId), null);
    },
    setCategoryNote: async (id, note) => {
      const api = await getBrowserApiRuntime(connection);
      await api.updateNote(id, note);
    },
    deleteCategoryNote: async (id) => {
      const api = await getBrowserApiRuntime(connection);
      await api.updateNote(id, null);
    },
    setBudgetMonthNote: async (month, note) => {
      const api = await getBrowserApiRuntime(connection);
      await api.updateNote(toBudgetNoteId(month), note);
    },
    deleteBudgetMonthNote: async (month) => {
      const api = await getBrowserApiRuntime(connection);
      await api.updateNote(toBudgetNoteId(month), null);
    },
  };
}
