import { runQuery } from "@/lib/api/query";
import type { ConnectionInstance } from "@/store/connection";

/** One Actual transaction as the picker returns it. `amountMinor` is signed integer minor units. */
export type PickedTransaction = {
  id: string; accountId: string; accountName: string; date: string; amountMinor: number;
  payeeId: string | null; payeeName: string | null; categoryId: string | null; categoryName: string | null;
  notes: string | null; /** Set when the row is one leg of a transfer. */ transferId: string | null;
};
export type PickerFilters = { dateFrom: string; dateTo: string; accountIds: string[]; categoryIds: string[]; payeeIds: string[]; search: string };
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
export const PICKER_ROW_LIMIT = 10_000;
const FIELDS = ["id", "date", "amount", "account", "account.name", "payee", "payee.name", "category", "category.name", "notes", "transfer_id"] as const;

/**
 * ActualQL filter for the picker. Split parents are never returned (`splits: "inline"` yields the real child
 * rows), so a parent and its children can never both be picked. Search matches payee, category or Notes.
 */
export function buildPickerFilter(filters: PickerFilters, constraints: PickerConstraints = {}) {
  const and: object[] = [];
  if (filters.dateFrom) and.push({ date: { $gte: filters.dateFrom } });
  if (filters.dateTo) and.push({ date: { $lte: filters.dateTo } });
  if (filters.accountIds.length) and.push({ account: { $oneof: filters.accountIds } });
  for (const id of constraints.excludeAccountIds ?? []) and.push({ account: { $ne: id } });
  if (filters.categoryIds.length) and.push({ category: { $oneof: filters.categoryIds } });
  if (filters.payeeIds.length) and.push({ payee: { $oneof: filters.payeeIds } });
  if (constraints.amountSign === "positive") and.push({ amount: { $gt: 0 } });
  if (constraints.amountSign === "negative") and.push({ amount: { $lt: 0 } });
  if (constraints.excludeTransfers) and.push({ transfer_id: null });
  if (constraints.transfersOnly) and.push({ transfer_id: { $ne: null } });
  if (constraints.requireCategory) and.push({ category: { $ne: null } });
  if (constraints.where) and.push(constraints.where);
  const term = filters.search.trim();
  if (term) { const like = `%${term}%`; and.push({ $or: [{ "payee.name": { $like: like } }, { "category.name": { $like: like } }, { notes: { $like: like } }] }); }
  return { $and: and };
}
export function buildPickerQuery(filters: PickerFilters, constraints: PickerConstraints = {}, limit = PICKER_ROW_LIMIT) {
  return { ActualQLquery: { table: "transactions", options: { splits: "inline" }, filter: buildPickerFilter(filters, constraints), select: [...FIELDS], orderBy: [{ date: "desc" }], limit } };
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
export async function fetchPickerTransactions(connection: ConnectionInstance, filters: PickerFilters, constraints: PickerConstraints = {}, limit = PICKER_ROW_LIMIT): Promise<PickedTransaction[]> {
  return parsePickerRows(await runQuery<{ data: unknown }>(connection, buildPickerQuery(filters, constraints, limit)));
}
