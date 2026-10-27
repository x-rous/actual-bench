"use client";
import { type RefObject } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ComboboxOption } from "@/components/ui/combobox";
import { SearchInput } from "@/components/ui/search-input";
import { ConditionsEditor, newCondition } from "./ConditionsEditor";
import { AmountChip, DateChip, FacetChip, LockedChip, Segmented, TagsChip, TransfersChip } from "./filterChips";
import type { PickerConstraints, PickerFilterState } from "./transactionPickerQuery";

/** The filters a caller can offer. A filter that is not offered keeps the value the caller's `defaults` gave it (a fixed rule). */
export type PickerFilterKey = "search" | "date" | "amount" | "type" | "accounts" | "categories" | "payees" | "tags" | "transfers" | "advanced";
export const ALL_FILTERS: PickerFilterKey[] = ["search", "date", "amount", "type", "accounts", "categories", "payees", "tags", "transfers", "advanced"];
export type LockedKey = "sign" | "transfers" | "category" | "accounts" | "where";
export type LockedChipSpec = { key: LockedKey; label: string; reason: string };
/** The rules a screen has set, as chips. A caller can reword any of them (for example name the saved rule). */
export function lockedChipsFor(constraints: PickerConstraints = {}, labels: Partial<Record<LockedKey, string>> = {}): LockedChipSpec[] {
  const out: LockedChipSpec[] = [];
  if (constraints.amountSign) out.push({ key: "sign", label: labels.sign ?? (constraints.amountSign === "negative" ? "Expenses only" : "Income only"), reason: constraints.amountSign === "negative" ? "only money paid out can be used here" : "only money received can be used here" });
  if (constraints.excludeTransfers) out.push({ key: "transfers", label: labels.transfers ?? "No transfers", reason: "transfers between your accounts cannot be used here" });
  if (constraints.transfersOnly) out.push({ key: "transfers", label: labels.transfers ?? "Transfers only", reason: "only transfers can be used here" });
  if (constraints.requireCategory) out.push({ key: "category", label: labels.category ?? "Has a category", reason: "the transaction needs a category" });
  if (constraints.excludeAccountIds?.length) out.push({ key: "accounts", label: labels.accounts ?? "Some accounts excluded", reason: "those accounts cannot be used here" });
  if (constraints.where) out.push({ key: "where", label: labels.where ?? "Saved filter", reason: "a saved filter limits the list" });
  return out;
}

export type FilterReference = {
  accountOptions: ComboboxOption[]; categoryOptions: ComboboxOption[]; payeeOptions: ComboboxOption[]; tagOptions: ComboboxOption[];
  names: { account: (id: string) => string; category: (id: string) => string; payee: (id: string) => string };
};
/**
 * The picker's filters: a wide search box, one chip per facet and the rules the screen has set. Every change applies
 * at once. Reusable on its own wherever a list of transactions needs narrowing.
 */
export function TransactionFilterBar({ state, onChange, onClear, offered, constraints, lockedLabels, reference, searchRef, advancedOpen, onAdvancedOpen }: {
  state: PickerFilterState; onChange: (next: PickerFilterState) => void; onClear: () => void; offered: PickerFilterKey[];
  constraints?: PickerConstraints; lockedLabels?: Partial<Record<LockedKey, string>>; reference: FilterReference;
  searchRef?: RefObject<HTMLInputElement | null>; advancedOpen: boolean; onAdvancedOpen: (open: boolean) => void;
}) {
  const set = (patch: Partial<PickerFilterState>) => onChange({ ...state, ...patch });
  const locked = lockedChipsFor(constraints, lockedLabels);
  const has = (key: PickerFilterKey) => offered.includes(key);
  const active = !!(state.search || state.date.preset !== "all" || state.amount.mode !== "any" || state.type !== "all" || state.transfers !== "include" || state.accounts.ids.length || state.categories.ids.length || state.categories.uncategorized || state.payees.ids.length || state.payees.none || state.tags.names.length || state.tags.none || state.advanced);
  return <div className="grid gap-2" role="group" aria-label="Transaction filters">
    {has("search") && <SearchInput size="default" inputRef={searchRef} autoFocus aria-label="Search transactions" placeholder="Search payee, notes, category, account or amount" className="w-full" value={state.search} onValueChange={(search) => set({ search })} />}
    <div className="flex flex-wrap items-center gap-1.5">
      {has("date") && <DateChip value={state.date} onChange={(date) => set({ date })} />}
      {has("amount") && <AmountChip value={state.amount} onChange={(amount) => set({ amount })} />}
      {has("type") && !constraints?.amountSign && <Segmented label="Type" value={state.type} options={[{ value: "all", label: "All" }, { value: "expenses", label: "Expenses" }, { value: "income", label: "Income" }]} onChange={(type) => set({ type })} />}
      {has("accounts") && <FacetChip name="Account" plural="accounts" options={reference.accountOptions} value={state.accounts} onChange={(accounts) => set({ accounts })} onReset={() => set({ accounts: { ids: [], not: false } })} nameOf={reference.names.account} />}
      {has("categories") && <FacetChip name="Category" plural="categories" options={reference.categoryOptions} value={state.categories} onChange={(v) => set({ categories: { ...state.categories, ...v } })} onReset={() => set({ categories: { ids: [], not: false, uncategorized: false } })} nameOf={reference.names.category} extra={{ label: "Uncategorized", checked: state.categories.uncategorized, onChange: (uncategorized) => set({ categories: { ...state.categories, uncategorized } }) }} />}
      {has("payees") && <FacetChip name="Payee" plural="payees" options={reference.payeeOptions} value={state.payees} onChange={(v) => set({ payees: { ...state.payees, ...v } })} onReset={() => set({ payees: { ids: [], not: false, none: false } })} nameOf={reference.names.payee} extra={{ label: "No payee", checked: state.payees.none, onChange: (none) => set({ payees: { ...state.payees, none } }) }} />}
      {has("tags") && <TagsChip options={reference.tagOptions} value={state.tags} onChange={(tags) => set({ tags })} />}
      {has("transfers") && !constraints?.excludeTransfers && !constraints?.transfersOnly && <TransfersChip value={state.transfers} onChange={(transfers) => set({ transfers })} />}
      {locked.map((l) => <LockedChip key={`${l.key}:${l.label}`} label={l.label} reason={l.reason} />)}
      <span className="ml-auto flex items-center gap-1">
        {has("advanced") && <Button size="xs" variant="ghost" aria-expanded={advancedOpen} onClick={() => { const open = !advancedOpen; onAdvancedOpen(open); set({ advanced: open ? (state.advanced ?? { match: "all", conditions: [newCondition()] }) : null }); }}>Advanced</Button>}
        {active && <Button size="xs" variant="ghost" onClick={onClear}><X className="size-3" aria-hidden />Clear all</Button>}
      </span>
    </div>
    {has("advanced") && advancedOpen && state.advanced && <div className="rounded-lg border bg-muted/20 p-3"><ConditionsEditor value={state.advanced} onChange={(advanced) => set({ advanced })} excludeAccountIds={constraints?.excludeAccountIds} excludeTransferPayees={!!constraints?.excludeTransfers} /></div>}
  </div>;
}
