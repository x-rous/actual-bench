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
import type { Account, Payee, Rule, Schedule, Tag } from "@/types/entities";
import { getBrowserApiRuntime, type ActualBrowserApi } from "./browser/runtime";
import type { ActualBenchTransport } from "./transport";

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
    getServerVersion: async () => {
      const api = await getBrowserApiRuntime(connection);
      if (typeof api.getServerVersion !== "function") return null;
      const result = await api.getServerVersion().catch(() => null);
      return result && "version" in result ? result.version : null;
    },
    getAccounts: () => getBrowserAccounts(connection),
    getAccountBalances: () => getBrowserAccountBalances(connection),
    getPayees: async () => {
      const api = await getBrowserApiRuntime(connection);
      return (await api.getPayees())
        .map(normalizeDirectPayee)
        .filter((payee): payee is Payee => payee !== null);
    },
    getCategoryGroups: () => getBrowserCategoryGroups(connection),
    getTags: async () => {
      const api = await getBrowserApiRuntime(connection);
      return (await api.getTags())
        .map(normalizeDirectTag)
        .filter((tag): tag is Tag => tag !== null);
    },
    getRules: async () => {
      const api = await getBrowserApiRuntime(connection);
      return (await api.getRules())
        .map(normalizeDirectRule)
        .filter((rule): rule is Rule => rule !== null);
    },
    getSchedules: async () => {
      const api = await getBrowserApiRuntime(connection);
      return (await api.getSchedules())
        .map(normalizeDirectSchedule)
        .filter((schedule): schedule is Schedule => schedule !== null);
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
  };
}
