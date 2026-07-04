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
} from "./browser/runtime";
import { prepareRuleForTransport, prepareRulePatchForTransport } from "./ruleMutation";
import { unsupportedTransportOperation, type ActualBenchTransport, type ScheduleWriteInput, type TransportBudgetMonth } from "./transport";

type RecordLike = Record<string, unknown>;

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

function getWrappedActualQuery(body: object): RecordLike {
  const wrapped = assertRecord(body, "the query body");
  return assertRecord(wrapped.ActualQLquery, "ActualQLquery");
}

function createBrowserQuery(api: ActualBrowserApi, body: object): unknown {
  if (typeof api.q !== "function") {
    throw unsupportedTransportOperation("browser-api", "ActualQL queries");
  }

  const query = getWrappedActualQuery(body);
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
  if (query.filter !== undefined) {
    browserQuery = browserQuery.filter(assertRecord(query.filter, "ActualQLquery.filter"));
  }
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
  if (query.groupBy !== undefined) browserQuery = browserQuery.groupBy(query.groupBy);
  if (query.orderBy !== undefined) browserQuery = browserQuery.orderBy(query.orderBy);
  if (query.limit !== undefined) {
    const limit = query.limit;
    if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 0) {
      throw new Error("Direct browser API query adapter requires a non-negative integer limit.");
    }
    browserQuery = browserQuery.limit(limit);
  }
  if (query.offset !== undefined) {
    const offset = query.offset;
    if (typeof offset !== "number" || !Number.isInteger(offset) || offset < 0) {
      throw new Error("Direct browser API query adapter requires a non-negative integer offset.");
    }
    browserQuery = browserQuery.offset(offset);
  }

  return browserQuery;
}

async function runBrowserQuery<T>(
  connection: BrowserApiConnection,
  body: object
): Promise<T> {
  const api = await getBrowserApiRuntime(connection);
  const runner = api.aqlQuery ?? api.runQuery;
  if (!runner) throw unsupportedTransportOperation("browser-api", "ActualQL queries");
  return (await runner(createBrowserQuery(api, body))) as T;
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

async function runBrowserBudgetBatch<T>(
  connection: BrowserApiConnection,
  operation: () => Promise<T>
): Promise<T> {
  const api = await getBrowserApiRuntime(connection);
  let result: T | undefined;
  await api.batchBudgetUpdates(async () => {
    result = await operation();
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

async function getBrowserAccountBalances(
  connection: BrowserApiConnection
): Promise<Map<string, number>> {
  const api = await getBrowserApiRuntime(connection);
  const accounts = await getBrowserAccounts(connection);
  const entries = await Promise.all(
    accounts.map(async (account) => {
      const balance = await api.getAccountBalance(account.id);
      return [account.id, balance / 100] as const;
    })
  );

  return new Map(entries);
}

async function getBrowserCategoryGroups(
  connection: BrowserApiConnection
): Promise<CategoryGroupsResponse> {
  const api = await getBrowserApiRuntime(connection);
  const groupRows = (await api.getCategoryGroups())
    .map(toDirectCategoryGroup)
    .filter((group): group is ApiCategoryGroup => group !== null);

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

  const groups = groupRows.map((group) => {
    const categoriesForGroup = categoryRows.filter(
      (category) => category.group_id === group.id
    );
    return normalizeCategoryGroup({ ...group, categories: categoriesForGroup });
  });
  const categories = categoryRows.map((category) =>
    normalizeCategory(category, category.group_id)
  );

  return { groups, categories };
}

async function getBrowserAllNotes(
  connection: BrowserApiConnection
): Promise<Map<string, string>> {
  const api = await getBrowserApiRuntime(connection);
  const query = buildActualQuery(api, "notes", "*");
  const runner = api.aqlQuery ?? api.runQuery;
  const rows = runner
    ? responseRows<NoteRow>(await runner(query).catch(() => []))
    : [];

  const map = new Map<string, string>();
  for (const row of rows) {
    if (row.id && row.note) map.set(row.id, row.note);
  }
  return map;
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
      const api = await getBrowserApiRuntime(connection);
      const monthData = normalizeBudgetMonth(await api.getBudgetMonth(month));
      const fromBudgeted = findBudgetedAmount(monthData, input.fromCategoryId);
      const toBudgeted = findBudgetedAmount(monthData, input.toCategoryId);
      const amount = toBudgetAmount(input.amount);

      // Actual's browser API does not expose the server's category-transfer
      // endpoint. Inside a budget batch, setting both final budget values is
      // the same persisted budget state for the Direct transport.
      await api.setBudgetAmount(month, input.fromCategoryId, fromBudgeted - amount);
      await api.setBudgetAmount(month, input.toCategoryId, toBudgeted + amount);
    },
    holdBudgetForNextMonth: async (month, amount) => {
      const api = await getBrowserApiRuntime(connection);
      await api.holdBudgetForNextMonth(month, toBudgetAmount(amount));
    },
    resetBudgetHold: async (month) => {
      const api = await getBrowserApiRuntime(connection);
      await api.resetBudgetHold(month);
    },

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
