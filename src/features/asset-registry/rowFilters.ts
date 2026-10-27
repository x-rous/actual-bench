import type { ComboboxOption } from "@/components/ui/combobox";
import type { IdFilter, PickerFilterState } from "@/components/transactions/transactionPickerQuery";

/** The picker's filter chips, applied to a table of rows already in memory (the Asset Ledger and Income & Expenses). */
export type RowFilters = { amount: PickerFilterState["amount"]; payees: IdFilter; categories: IdFilter; accounts: IdFilter; types: IdFilter };
const none = (): IdFilter => ({ ids: [], not: false });
export const emptyRowFilters = (): RowFilters => ({ amount: { mode: "any" }, payees: none(), categories: none(), accounts: none(), types: none() });
export const rowFiltersActive = (f: RowFilters): boolean => f.amount.mode !== "any" || !!(f.payees.ids.length || f.categories.ids.length || f.accounts.ids.length || f.types.ids.length);

/** Compared without the sign, as the picker does, so a payment and a refund of the same size both match. */
export function matchesAmount(amountMinor: number, { mode, a = 0, b = 0 }: RowFilters["amount"]): boolean {
  const size = Math.abs(amountMinor);
  switch (mode) {
    case "equals": return size === a;
    case "between": return size >= Math.min(a, b) && size <= Math.max(a, b);
    case "more": return size > a;
    case "less": return size < a;
    default: return true;
  }
}
/** An empty filter lets everything through; "is not" keeps the rows that have none of the chosen values. */
export function matchesIds(id: string | null, filter: IdFilter): boolean {
  if (!filter.ids.length) return true;
  const hit = id !== null && filter.ids.includes(id);
  return filter.not ? !hit : hit;
}
/** Choices for a chip, from the distinct values in the table, sorted by name. */
export function optionsFrom(values: Iterable<[string, string]>): ComboboxOption[] {
  return [...new Map(values)].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}
