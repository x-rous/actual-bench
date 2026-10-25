"use client";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DateInput } from "@/components/ui/date-input";
import { MultiSearchableCombobox } from "@/components/ui/combobox";
import { SearchInput } from "@/components/ui/search-input";
import { DataTable, Text, type Column, type SortState } from "@/features/credit-cards/components/primitives/DataTable";
import { shortDate } from "@/features/credit-cards/components/primitives/format";
import { formatAmount } from "@/features/assets-debt/lib/money";
import { selectActiveInstance, useConnectionStore } from "@/store/connection";
import { useTransactionReference } from "./useTransactionReference";
import { fetchPickerTransactions, PICKER_ROW_LIMIT, type PickedTransaction, type PickerConstraints, type PickerFilters } from "./transactionPickerQuery";

export type PickerColumn = "date" | "account" | "payee" | "category" | "notes" | "amount";
export type PickerFilterKey = "dates" | "accounts" | "categories" | "payees" | "search";
const ALL_COLUMNS: PickerColumn[] = ["date", "account", "payee", "category", "notes", "amount"];
const ALL_FILTERS: PickerFilterKey[] = ["dates", "accounts", "categories", "payees", "search"];
/**
 * Decided by the caller before the dialog opens: what the list shows and which filters the user gets.
 * A hidden filter still applies its `defaults` value, which makes it a fixed rule (for example a locked account).
 */
export type TransactionPickerPanelProps = {
  /** Restrictions the user cannot lift (sign, accounts left out, transfers, category required). */
  constraints?: PickerConstraints;
  /** Initial filters; the date range defaults to the last 12 months. */
  defaults?: Partial<PickerFilters>;
  multiple?: boolean;
  /** Filters offered to the user (default: all). A hidden filter keeps its `defaults` value. */
  filters?: PickerFilterKey[];
  /** Columns shown, in table order (default: all). The selection checkbox is always first. */
  columns?: PickerColumn[];
  /** Exact client-side check applied to the rows the query returns (a rule's conditions the query cannot express). */
  rowFilter?: (row: PickedTransaction) => boolean;
  /** Start with every selectable match chosen (used to review what a saved rule would link before confirming). */
  autoSelect?: boolean;
  /** Replaces the default empty-list text. */
  emptyMessage?: string;
  /** A reason a row cannot be chosen (shown instead of its Notes); null when it can. */
  disabledReason?: (row: PickedTransaction) => string | null;
  /** Called with the chosen rows whenever the choice changes. */
  onSelectionChange: (rows: PickedTransaction[]) => void;
  /** `YYYY-MM-DD` of today in the budget's time zone, for the default range and short dates. */
  today: string;
};
export const money = (minor: number) => formatAmount(minor, 2);
const lastYear = (today: string) => `${Number(today.slice(0, 4)) - 1}${today.slice(4)}`;

/**
 * The app's generic transaction list picker body: one filtered ActualQL query (never a per-account read), a virtualized
 * table, and filters for date range, accounts, categories, payees and free text. Rows are whole Actual transactions;
 * a split parent is never offered, only its real children. Selection survives filter changes. Used in a dialog or inline.
 */
export function TransactionPickerPanel({ constraints, defaults, multiple = true, autoSelect = false, rowFilter, filters: offered = ALL_FILTERS, columns: shown = ALL_COLUMNS, emptyMessage, disabledReason, onSelectionChange, today }: TransactionPickerPanelProps) {
  const connection = useConnectionStore(selectActiveInstance);
  const [filters, setFilters] = useState<PickerFilters>({ dateFrom: lastYear(today), dateTo: today, accountIds: [], categoryIds: [], payeeIds: [], search: "", ...defaults });
  const [searchDraft, setSearchDraft] = useState(filters.search);
  const [chosen, setChosen] = useState<Map<string, PickedTransaction>>(new Map());
  const [auto, setAuto] = useState(autoSelect);
  const [sort, setSort] = useState<SortState | null>({ key: "date", direction: "desc" });
  useEffect(() => { const t = setTimeout(() => setFilters((f) => (f.search === searchDraft ? f : { ...f, search: searchDraft })), 250); return () => clearTimeout(t); }, [searchDraft]);
  const key = useMemo(() => JSON.stringify([connection?.id, filters, constraints]), [connection?.id, filters, constraints]);
  const result = useQuery({ queryKey: ["transactionPicker", key], enabled: !!connection, queryFn: () => fetchPickerTransactions(connection!, filters, constraints) });
  const { accountOptions, categoryOptions, payeeOptions } = useTransactionReference({ excludeAccountIds: constraints?.excludeAccountIds, excludeTransferPayees: constraints?.excludeTransfers });
  const rows = useMemo(() => {
    const list = (result.data ?? []).filter((r) => !rowFilter || rowFilter(r));
    if (sort && sort.key !== "date") { const dir = sort.direction === "asc" ? 1 : -1; list.sort((a, b) => dir * (sort.key === "amount" ? a.amountMinor - b.amountMinor : String(sort.key === "payee" ? a.payeeName : a.accountName).localeCompare(String(sort.key === "payee" ? b.payeeName : b.accountName)))); }
    else if (sort?.direction === "asc") list.reverse();
    return list;
  }, [result.data, sort, rowFilter]);
  const reasonOf = (r: PickedTransaction) => disabledReason?.(r) ?? null;
  // While `auto` holds, every selectable match counts as chosen; the first manual change freezes that choice.
  const selected = useMemo(() => auto ? new Map(rows.filter((r) => !disabledReason?.(r)).map((r) => [r.id, r])) : chosen, [auto, rows, chosen, disabledReason]);
  const picked = [...selected.values()];
  const toggle = (r: PickedTransaction) => { if (reasonOf(r)) return; const base = selected; setAuto(false); setChosen(() => { const next = new Map(multiple ? base : []); if (base.has(r.id)) next.delete(r.id); else next.set(r.id, r); return next; }); };
  const pickedKey = picked.map((r) => r.id).join("|");
  // The parent hears about every change of choice, not about every render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { onSelectionChange(picked); }, [pickedKey]);
  const active = !!(filters.accountIds.length || filters.categoryIds.length || filters.payeeIds.length || searchDraft);
  const allColumns: Record<PickerColumn, Column<PickedTransaction>> = {
    date: { key: "date", header: "Date", width: 100, sortable: true, cell: (r) => <Text title={r.date}>{shortDate(r.date, today)}</Text> },
    account: { key: "account", header: "Account", width: 150, sortable: true, cell: (r) => <Text>{r.accountName}</Text> },
    payee: { key: "payee", header: "Payee", width: 160, sortable: true, cell: (r) => <Text>{r.payeeName ?? "-"}</Text> },
    category: { key: "category", header: "Category", width: 150, cell: (r) => <Text>{r.categoryName ?? "-"}</Text> },
    notes: { key: "notes", header: "Notes", width: 200, grow: true, cell: (r) => <Text title={r.notes ?? undefined}>{reasonOf(r) ?? r.notes ?? "-"}</Text> },
    amount: { key: "amount", header: "Amount", width: 120, align: "right", sortable: true, cell: (r) => <span className="tabular-nums">{money(r.amountMinor)}</span> },
  };
  const columns: Column<PickedTransaction>[] = [
    { key: "select", header: "Select", hiddenHeader: true, width: 34, cell: (r) => <Checkbox aria-label={`Select ${r.payeeName ?? "no payee"} ${r.date}`} checked={selected.has(r.id)} disabled={!!reasonOf(r)} onCheckedChange={() => toggle(r)} /> },
    ...shown.map((key) => allColumns[key]),
  ];
  const truncated = (result.data?.length ?? 0) >= PICKER_ROW_LIMIT;
  return <div className="flex min-h-0 flex-1 flex-col gap-3">
    <div className="flex flex-wrap items-end gap-3" role="group" aria-label="Transaction filters">
      {offered.includes("dates") && <div className="flex items-center gap-1.5"><span className="text-xs text-muted-foreground">From</span><DateInput className="w-36" aria-label="From date" value={filters.dateFrom} onValueChange={(v) => setFilters((f) => ({ ...f, dateFrom: v }))} /><span className="text-xs text-muted-foreground">To</span><DateInput className="w-36" aria-label="To date" value={filters.dateTo} onValueChange={(v) => setFilters((f) => ({ ...f, dateTo: v }))} /></div>}
      {offered.includes("accounts") && <div className="w-48"><MultiSearchableCombobox options={accountOptions} values={filters.accountIds} onChange={(v) => setFilters((f) => ({ ...f, accountIds: v }))} onClear={() => setFilters((f) => ({ ...f, accountIds: [] }))} placeholder="All accounts" ariaLabel="Filter by accounts" triggerClassName="min-h-7 py-0.5" /></div>}
      {offered.includes("categories") && <div className="w-48"><MultiSearchableCombobox options={categoryOptions} values={filters.categoryIds} onChange={(v) => setFilters((f) => ({ ...f, categoryIds: v }))} onClear={() => setFilters((f) => ({ ...f, categoryIds: [] }))} placeholder="All categories" ariaLabel="Filter by categories" triggerClassName="min-h-7 py-0.5" /></div>}
      {offered.includes("payees") && <div className="w-48"><MultiSearchableCombobox options={payeeOptions} values={filters.payeeIds} onChange={(v) => setFilters((f) => ({ ...f, payeeIds: v }))} onClear={() => setFilters((f) => ({ ...f, payeeIds: [] }))} placeholder="All payees" ariaLabel="Filter by payees" triggerClassName="min-h-7 py-0.5" /></div>}
      {offered.includes("search") && <SearchInput size="sm" className="w-52" aria-label="Search payee, category or Notes" placeholder="Search payee, category, Notes…" value={searchDraft} onValueChange={setSearchDraft} />}
      {active && <Button size="sm" variant="ghost" onClick={() => { setSearchDraft(""); setFilters((f) => ({ ...f, accountIds: [], categoryIds: [], payeeIds: [], search: "" })); }}><X className="size-3.5" aria-hidden />Clear filters</Button>}
      <span role="status" className="ml-auto text-xs text-muted-foreground">{result.isFetching ? "Searching…" : `${rows.length.toLocaleString()}${truncated ? "+" : ""} ${rows.length === 1 ? "transaction" : "transactions"}`}{truncated ? " · narrow the filters to see all" : ""}</span>
    </div>
    {result.isError && <p role="alert" className="text-sm text-destructive">{result.error instanceof Error ? result.error.message : "The transaction query failed"}</p>}
    <div className="flex min-h-0 flex-1"><DataTable label="Transactions to choose from" rows={rows} columns={columns} rowKey={(r) => r.id} rowLabel={(r) => `${r.payeeName ?? "No payee"} · ${r.date} · ${money(r.amountMinor)}`} onOpen={toggle} rowClassName={(r) => selected.has(r.id) ? "bg-accent/40" : undefined} rowHeight={30} dense sort={sort} onSort={setSort}
      empty={result.isPending ? "Searching…" : emptyMessage && !active ? emptyMessage : active || filters.dateFrom || filters.dateTo ? "No transactions match your filters." : "No transactions."} /></div>
  </div>;
}
