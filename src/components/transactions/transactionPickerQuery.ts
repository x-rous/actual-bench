import { runQuery } from "@/lib/api/query";
import { ruleConditionSchema, ruleMatches, ruleWhere, tagsOf, type ConditionSet } from "@/lib/transactions/conditions";
import type { ConnectionInstance } from "@/store/connection";

/** One Actual transaction as the picker returns it. `amountMinor` is signed integer minor units. */
export type PickedTransaction = {
  id: string; accountId: string; accountName: string; date: string; amountMinor: number;
  payeeId: string | null; payeeName: string | null; categoryId: string | null; categoryName: string | null;
  notes: string | null; /** Set when the row is one leg of a transfer. */ transferId: string | null;
};
/** Restrictions a caller imposes; the user cannot lift them. */
export type PickerConstraints = {
  /** Accounts that never appear (for example the asset book accounts). */
  excludeAccountIds?: string[];
  amountSign?: "positive" | "negative";
  excludeTransfers?: boolean;
  /** Only rows that are one leg of a transfer. */
  transfersOnly?: boolean;
  /** Only rows that carry a category. */
  requireCategory?: boolean;
  /** An extra ActualQL condition ANDed with everything else (for example a saved rule's conditions). */
  where?: object;
};

export type DatePreset = "30d" | "90d" | "this-year" | "last-year" | "all" | "custom";
/** A set of ids with an "is" / "is not" switch. */
export type IdFilter = { ids: string[]; not: boolean };
/** What the user has chosen in the picker. Amounts are absolute integer minor units (the sign is the Type filter's job). */
export type PickerFilterState = {
  search: string;
  date: { preset: DatePreset; from?: string; to?: string };
  amount: { mode: "any" | "equals" | "between" | "more" | "less"; a?: number; b?: number };
  type: "all" | "expenses" | "income";
  transfers: "include" | "exclude" | "only";
  accounts: IdFilter;
  categories: IdFilter & { uncategorized: boolean };
  payees: IdFilter & { none: boolean };
  /** Tag names with their `#`, lower case. `match` is Any / All; `none` adds "No tags"; `not` inverts the whole tag test. */
  tags: { names: string[]; match: "any" | "all"; none: boolean; not: boolean };
  /** The Advanced conditions (Actual-style field → operation → value); incomplete ones are ignored. */
  advanced: ConditionSet | null;
};
export const emptyFilterState = (override: Partial<PickerFilterState> = {}): PickerFilterState => ({
  search: "", date: { preset: "all" }, amount: { mode: "any" }, type: "all", transfers: "include",
  accounts: { ids: [], not: false }, categories: { ids: [], not: false, uncategorized: false }, payees: { ids: [], not: false, none: false },
  tags: { names: [], match: "any", none: false, not: false }, advanced: null, ...override,
});
export const PICKER_PAGE_SIZE = 500;
const FIELDS = ["id", "date", "amount", "account", "account.name", "payee", "payee.name", "category", "category.name", "notes", "transfer_id"] as const;

const isoDay = (date: Date) => date.toISOString().slice(0, 10);
const daysBefore = (today: string, days: number) => isoDay(new Date(Date.parse(`${today}T00:00:00Z`) - days * 86_400_000));
/** The inclusive `YYYY-MM-DD` range a date filter means today; either end is absent when open. */
export function resolveDateRange(date: PickerFilterState["date"], today: string): { from?: string; to?: string } {
  const year = Number(today.slice(0, 4));
  switch (date.preset) {
    case "30d": return { from: daysBefore(today, 30), to: today };
    case "90d": return { from: daysBefore(today, 90), to: today };
    case "this-year": return { from: `${year}-01-01`, to: today };
    case "last-year": return { from: `${year - 1}-01-01`, to: `${year - 1}-12-31` };
    case "custom": return { ...(date.from ? { from: date.from } : {}), ...(date.to ? { to: date.to } : {}) };
    default: return {};
  }
}

/** What a search box term can also mean: an amount (either sign unless typed with one) or a month / day. */
export function parseSearchTerm(term: string): { amountMinor: number | null; signed: boolean; datePrefix: string | null } {
  const text = term.trim();
  const plain = text.replace(/,/g, "");
  const amount = /^[+-]?\d+(\.\d{1,2})?$/.test(plain) && (!text.includes(",") || /^[+-]?\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(text));
  return {
    amountMinor: amount ? Math.round(Math.abs(Number(plain)) * 100) : null,
    signed: amount && /^[+-]/.test(plain),
    datePrefix: /^\d{4}-\d{2}(-\d{2})?$/.test(text) ? text : null,
  };
}
/** A month (`2026-10`) or a day (`2026-10-05`) as a date condition. Actual's dates cannot be matched with LIKE, so a month is a range. */
export function dateMatch(prefix: string): object {
  if (prefix.length === 10) return { date: prefix };
  const [y, m] = prefix.split("-").map(Number);
  return { $and: [{ date: { $gte: `${prefix}-01` } }, { date: { $lte: `${prefix}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}` } }] };
}
export { tagsOf };
const validConditions = (set: ConditionSet | null): ConditionSet | null => {
  if (!set) return null;
  const conditions = set.conditions.filter((c) => ruleConditionSchema.safeParse(c).success);
  return conditions.length ? { match: set.match, conditions } : null;
};
const notEqualAny = (field: string, ids: string[], nullable: boolean) => ({ $and: ids.map((id) => nullable ? { $or: [{ [field]: null }, { [field]: { $ne: id } }] } : { [field]: { $ne: id } }) });

/**
 * ActualQL filter for the picker. Everything the query language can express is pushed into it; "is not" on a payee or
 * category keeps rows that have none. Tag tests are a superset here and exact in `rowMatchesState`. Split parents are
 * never returned (`splits: "inline"` yields the real child rows), so a parent and its children can never both be picked.
 */
export function buildSearchFilter(state: PickerFilterState, constraints: PickerConstraints = {}, today = isoDay(new Date())) {
  const and: object[] = [];
  const { from, to } = resolveDateRange(state.date, today);
  if (from) and.push({ date: { $gte: from } });
  if (to) and.push({ date: { $lte: to } });
  if (state.accounts.ids.length) and.push(state.accounts.not ? notEqualAny("account", state.accounts.ids, false) : { account: { $oneof: state.accounts.ids } });
  for (const id of constraints.excludeAccountIds ?? []) and.push({ account: { $ne: id } });
  const cats = state.categories;
  if (cats.ids.length || cats.uncategorized) {
    if (cats.not) { if (cats.ids.length) and.push(notEqualAny("category", cats.ids, true)); if (cats.uncategorized) and.push({ category: { $ne: null } }); }
    else if (!cats.uncategorized) and.push({ category: { $oneof: cats.ids } });
    else and.push(cats.ids.length ? { $or: [{ category: { $oneof: cats.ids } }, { category: null }] } : { category: null });
  }
  const payees = state.payees;
  if (payees.ids.length || payees.none) {
    if (payees.not) { if (payees.ids.length) and.push(notEqualAny("payee", payees.ids, true)); if (payees.none) and.push({ payee: { $ne: null } }); }
    else if (!payees.none) and.push({ payee: { $oneof: payees.ids } });
    else and.push(payees.ids.length ? { $or: [{ payee: { $oneof: payees.ids } }, { payee: null }] } : { payee: null });
  }
  if (constraints.amountSign === "positive" || state.type === "income") and.push({ amount: { $gt: 0 } });
  if (constraints.amountSign === "negative" || state.type === "expenses") and.push({ amount: { $lt: 0 } });
  const { mode, a = 0, b = 0 } = state.amount;
  if (mode === "equals") and.push({ $or: [{ amount: a }, { amount: -a }] });
  if (mode === "between") and.push({ $or: [{ $and: [{ amount: { $gte: Math.min(a, b) } }, { amount: { $lte: Math.max(a, b) } }] }, { $and: [{ amount: { $lte: -Math.min(a, b) } }, { amount: { $gte: -Math.max(a, b) } }] }] });
  if (mode === "more") and.push({ $or: [{ amount: { $gt: a } }, { amount: { $lt: -a } }] });
  if (mode === "less") and.push({ $and: [{ amount: { $lt: a } }, { amount: { $gt: -a } }] });
  if (constraints.excludeTransfers || state.transfers === "exclude") and.push({ transfer_id: null });
  if (constraints.transfersOnly || state.transfers === "only") and.push({ transfer_id: { $ne: null } });
  if (constraints.requireCategory) and.push({ category: { $ne: null } });
  if (state.tags.names.length && !state.tags.not && !state.tags.none) {
    const likes = state.tags.names.map((tag) => ({ notes: { $like: `%${tag}%` } }));
    and.push(state.tags.match === "all" ? { $and: likes } : { $or: likes });
  }
  const advanced = validConditions(state.advanced);
  const where = advanced ? ruleWhere(advanced) : undefined;
  if (where) and.push(where);
  if (constraints.where) and.push(constraints.where);
  const term = state.search.trim();
  if (term) {
    const like = `%${term}%`; const parsed = parseSearchTerm(term);
    and.push({ $or: [{ "payee.name": { $like: like } }, { "category.name": { $like: like } }, { "account.name": { $like: like } }, { notes: { $like: like } },
      ...(parsed.amountMinor !== null ? [{ amount: parsed.amountMinor }, { amount: -parsed.amountMinor }].filter((c) => !parsed.signed || (/^-/.test(term.trim()) ? c.amount < 0 : c.amount > 0)) : []),
      ...(parsed.datePrefix ? [dateMatch(parsed.datePrefix)] : [])] });
  }
  return { $and: and };
}
/** The tests ActualQL cannot make exactly: complete tag tokens (Any / All / none / not) and the Advanced conditions. */
export function rowMatchesState(row: PickedTransaction, state: PickerFilterState): boolean {
  // LIKE treats % and _ as wildcards, so a search containing one is checked again here against the text it should be in.
  const term = state.search.trim().toLocaleLowerCase();
  if (/[%_]/.test(term) && ![row.payeeName, row.categoryName, row.accountName, row.notes].some((field) => field?.toLocaleLowerCase().includes(term))) return false;
  const { names, match, none, not } = state.tags;
  if (names.length || none) {
    const have = new Set(tagsOf(row.notes));
    const named = names.length ? (match === "all" ? names.every((n) => have.has(n)) : names.some((n) => have.has(n))) : false;
    const hit = named || (none && have.size === 0);
    if (not ? hit : !hit) return false;
  }
  const advanced = validConditions(state.advanced);
  return !advanced || ruleMatches(advanced, row);
}
export function buildPickerQuery(state: PickerFilterState, constraints: PickerConstraints = {}, today?: string, offset = 0, limit = PICKER_PAGE_SIZE) {
  return { ActualQLquery: { table: "transactions", options: { splits: "inline" }, filter: buildSearchFilter(state, constraints, today), select: [...FIELDS], orderBy: [{ date: "desc" }, { id: "desc" }], limit, ...(offset ? { offset } : {}) } };
}
const text = (v: unknown) => (typeof v === "string" && v.length > 0 ? v : null);
export function parsePickerRows(response: { data?: unknown } | null | undefined): PickedTransaction[] {
  if (!response || !Array.isArray(response.data)) throw new Error("The transaction query returned an invalid response");
  const rows: PickedTransaction[] = [];
  for (const raw of response.data as Record<string, unknown>[]) {
    const id = text(raw.id), date = text(raw.date), accountId = text(raw.account);
    if (!id || !date || !accountId || typeof raw.amount !== "number" || !Number.isSafeInteger(raw.amount)) continue;
    rows.push({ id, date, accountId, accountName: text(raw["account.name"]) ?? "Unknown account", amountMinor: raw.amount, payeeId: text(raw.payee), payeeName: text(raw["payee.name"]),
      categoryId: text(raw.category), categoryName: text(raw["category.name"]), notes: text(raw.notes), transferId: text(raw.transfer_id) });
  }
  return rows;
}
/** One page of matches. `fetched` is how many rows Actual returned (a full page means there may be more); `rows` are those that also pass the exact client-side tests. */
export async function fetchPickerPage(connection: ConnectionInstance, state: PickerFilterState, constraints: PickerConstraints, today: string, offset: number, limit = PICKER_PAGE_SIZE): Promise<{ rows: PickedTransaction[]; fetched: number }> {
  const all = parsePickerRows(await runQuery<{ data: unknown }>(connection, buildPickerQuery(state, constraints, today, offset, limit)));
  return { rows: all.filter((r) => rowMatchesState(r, state)), fetched: all.length };
}
/** Every `#tag` used in any transaction's Notes (lower case), read as the distinct Notes values so it stays small. */
export async function fetchNoteTags(connection: ConnectionInstance): Promise<string[]> {
  const response = await runQuery<{ data: unknown }>(connection, { ActualQLquery: { table: "transactions", filter: { notes: { $like: "%#%" } }, groupBy: ["notes"], select: ["notes"], limit: 50_000 } });
  if (!response || !Array.isArray(response.data)) throw new Error("The tag query returned an invalid response");
  const tags = new Set<string>();
  for (const raw of response.data as { notes?: unknown }[]) for (const tag of tagsOf(typeof raw.notes === "string" ? raw.notes : null)) tags.add(tag);
  return [...tags].sort();
}
