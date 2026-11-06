"use client";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { X } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Checkbox } from "@/components/ui/checkbox";
import { selectActiveInstance, useConnectionStore } from "@/store/connection";
import type { ComboboxOption } from "@/components/ui/combobox";
import { DataTable, Text, type Column, type SortState } from "@/features/credit-cards/components/primitives/DataTable";
import { shortDate } from "@/features/credit-cards/components/primitives/format";
import { formatAmount } from "@/features/assets-debt/lib/money";
import { ALL_FILTERS, TransactionFilterBar, type LockedKey, type PickerFilterKey } from "./TransactionFilterBar";
import { PickerInsights, pickChips, type InsightsOptions } from "./PickerInsights";
import { emptyFilterState, emptyPicks, fetchNoteTags, hasPicks, tagsOf, withPicks, type InsightPicks, type PickedTransaction, type PickerConstraints, type PickerFilterState } from "./transactionPickerQuery";
import { useTransactionReference } from "./useTransactionReference";
import { useTransactionSearch } from "./useTransactionSearch";

export type { PickerFilterKey };
export type PickerColumn = "date" | "account" | "payee" | "category" | "notes" | "amount";
const ALL_COLUMNS: PickerColumn[] = ["date", "account", "payee", "category", "notes", "amount"];
/**
 * Decided by the caller before the dialog opens: what the list shows and which filters the user gets.
 * A filter that is not offered still applies its `defaults` value, which makes it a fixed rule.
 */
export type TransactionPickerPanelProps = {
  /** Restrictions the user cannot lift (sign, accounts left out, transfers, category required); shown as locked chips. */
  constraints?: PickerConstraints;
  /** Reword a locked chip, for example to name the saved rule: `{ where: "Rule: Rent unit 4" }`. */
  lockedLabels?: Partial<Record<LockedKey, string>>;
  /** Initial filters. The date defaults to All time. */
  defaults?: Partial<PickerFilterState>;
  multiple?: boolean;
  /** Filters offered to the user (default: all). */
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
  /** Single choice: Enter on the chosen row confirms. */
  onSubmit?: () => void;
  /**
   * Charts above the list, on demand: where the money came from or went (categories, groups, accounts, payees) and a
   * timeline by month or year. They total the same filter the list uses and narrow it when selected. Left off, the list is
   * unchanged. Not offered together with `rowFilter` (a client-side check the totals cannot apply).
   */
  insights?: InsightsOptions;
  /** Replaces the Notes column with a reason per row (for lists that say why each entry is there). */
  noteColumn?: { header: string; of: (row: PickedTransaction) => string | null };
  /** Always write the year in the Date column (`22 Oct 2026`), not only for other years. */
  fullDates?: boolean;
  /** A list to read: no selection column and no "selected only" switch. */
  readOnly?: boolean;
  /** Keep loading pages until every match is here (up to the page cap), so the rows can be totalled. */
  loadAll?: boolean;
  /** Told what is listed after each change: the sum of the rows, whether every match is loaded, and whether the user narrowed the view. */
  onListChange?: (info: { totalMinor: number; count: number; complete: boolean; narrowed: boolean }) => void;
  /** `YYYY-MM-DD` of today in the budget's time zone, for date presets and short dates. */
  today: string;
};
export const money = (minor: number) => formatAmount(minor, 2);
/** Sorting by anything but newest-first needs every row; load them all, up to this many pages. */
const SORT_PAGE_CAP = 40;

/**
 * The app's generic transaction picker body: smart search, facet chips (date, amount, type, account, category, payee, tags,
 * transfers, Advanced conditions) that apply at once, the screen's own rules as locked chips, and a virtualised, paged list
 * of whole Actual transactions. A split parent is never offered, only its real children. Selection survives filter changes.
 */
export function TransactionPickerPanel({ constraints, lockedLabels, defaults, multiple = true, autoSelect = false, rowFilter, filters: offered = ALL_FILTERS, columns: shown = ALL_COLUMNS, emptyMessage, disabledReason, readOnly = false, loadAll = false, insights, noteColumn, fullDates = false, onListChange, onSelectionChange, onSubmit, today }: TransactionPickerPanelProps) {
  const base = useMemo(() => emptyFilterState(defaults), [defaults]);
  const [filters, setFilters] = useState<PickerFilterState>(base);
  const [searchDraft, setSearchDraft] = useState(base.search);
  const [advancedOpen, setAdvancedOpen] = useState(!!base.advanced);
  const [chosen, setChosen] = useState<Map<string, PickedTransaction>>(new Map());
  const [auto, setAuto] = useState(autoSelect);
  const [onlySelected, setOnlySelected] = useState(false);
  const [sort, setSort] = useState<SortState | null>({ key: "date", direction: "desc" });
  const searchRef = useRef<HTMLInputElement | null>(null);
  const lastIndex = useRef<number | null>(null); const shiftHeld = useRef(false);
  const [picks, setPicks] = useState<InsightPicks>(emptyPicks);
  const [showCharts, setShowCharts] = useState(true);
  const chartsOn = !!insights && !rowFilter;
  const insightsState = useMemo(() => ({ ...filters, search: searchDraft }), [filters, searchDraft]);
  const baseConstraints = useMemo(() => constraints ?? {}, [constraints]);
  const searchConstraints = useMemo(() => (chartsOn ? withPicks(baseConstraints, picks) : constraints), [chartsOn, baseConstraints, constraints, picks]);
  // The search hook waits for typing to settle, so the typed text goes straight into the filters it is given.
  const search = useTransactionSearch(insightsState, searchConstraints, today);
  const reference = useTransactionReference({ excludeAccountIds: constraints?.excludeAccountIds, excludeTransferPayees: !!(constraints?.excludeTransfers || constraints?.excludeTransferPayees) });
  const loaded = useMemo(() => search.rows.filter((r) => !rowFilter || rowFilter(r)), [search.rows, rowFilter]);
  // Tags: Actual's defined ones, every #word used in any Notes in the budget, and any in the loaded rows.
  const connection = useConnectionStore(selectActiveInstance);
  const used = useQuery({ queryKey: ["transactionPickerTags", connection?.id], enabled: !!connection, queryFn: () => fetchNoteTags(connection!) });
  const tagOptions = useMemo<ComboboxOption[]>(() => {
    const defined = new Map(reference.tags.map((t) => [t.id, t.name]));
    for (const tag of used.data ?? []) if (!defined.has(tag)) defined.set(tag, tag);
    for (const r of search.rows) for (const tag of tagsOf(r.notes)) if (!defined.has(tag)) defined.set(tag, tag);
    return [...defined].sort((a, b) => a[1].localeCompare(b[1])).map(([id, name]) => ({ id, name }));
  }, [reference.tags, used.data, search.rows]);
  const dateSorted = sort?.key === "date";
  const rows = useMemo(() => {
    const list = [...loaded];
    if (sort && sort.key !== "date") { const dir = sort.direction === "asc" ? 1 : -1; list.sort((a, b) => dir * (sort.key === "amount" ? a.amountMinor - b.amountMinor : String(sort.key === "payee" ? a.payeeName : a.accountName).localeCompare(String(sort.key === "payee" ? b.payeeName : b.accountName)))); }
    else if (constraints?.namedIds) list.sort((a, b) => (sort?.direction === "asc" ? 1 : -1) * (a.date.localeCompare(b.date) || a.id.localeCompare(b.id)));
    else if (sort?.direction === "asc") list.reverse();
    return list;
  }, [loaded, sort, constraints?.namedIds]);
  const reasonOf = (r: PickedTransaction) => disabledReason?.(r) ?? null;
  // While `auto` holds, every selectable match counts as chosen; the first manual change freezes that choice.
  const selected = useMemo(() => auto ? new Map(rows.filter((r) => !disabledReason?.(r)).map((r) => [r.id, r])) : chosen, [auto, rows, chosen, disabledReason]);
  const picked = [...selected.values()];
  const shownRows = onlySelected ? [...picked].sort((a, b) => b.date.localeCompare(a.date)) : rows;
  const sortAll = !dateSorted || sort?.direction === "asc";
  const { hasMore, loadMore, isFetching, pageCount } = search;
  // Also keep loading while an auto-selection is being built (it must see every match) or while the loaded pages show nothing
  // (client-side tests can empty a page, and an empty table never scrolls to trigger the next one).
  const needsMore = sortAll || auto || loadAll || loaded.length === 0;
  useEffect(() => { if (needsMore && hasMore && !isFetching && (constraints?.namedIds || pageCount < SORT_PAGE_CAP)) loadMore(); }, [needsMore, hasMore, isFetching, pageCount, loadMore, constraints?.namedIds]);
  const toggle = (r: PickedTransaction) => { if (reasonOf(r)) return; const current = selected; setAuto(false); setChosen(() => { const next = new Map(multiple ? current : []); if (current.has(r.id)) next.delete(r.id); else next.set(r.id, r); return next; }); };
  const rangeSelect = (r: PickedTransaction) => {
    const to = shownRows.findIndex((x) => x.id === r.id); const from = lastIndex.current ?? to;
    const current = selected; setAuto(false);
    setChosen(() => { const next = new Map(current); for (const x of shownRows.slice(Math.min(from, to), Math.max(from, to) + 1)) if (!reasonOf(x)) next.set(x.id, x); return next; });
  };
  const choose = (r: PickedTransaction) => { const index = shownRows.findIndex((x) => x.id === r.id); if (multiple && shiftHeld.current && lastIndex.current !== null) rangeSelect(r); else toggle(r); lastIndex.current = index; };
  const open = (r: PickedTransaction) => { if (!multiple && selected.has(r.id) && onSubmit) { onSubmit(); return; } choose(r); };
  const pickedKey = picked.map((r) => r.id).join("|");
  // The parent hears about every change of choice, not about every render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { onSelectionChange(picked); }, [pickedKey]);
  const allColumns: Record<PickerColumn, Column<PickedTransaction>> = {
    date: { key: "date", header: "Date", width: 100, sortable: true, cell: (r) => <Text title={r.date}>{shortDate(r.date, fullDates ? undefined : today)}</Text> },
    account: { key: "account", header: "Account", width: 180, sortable: true, cell: (r) => <Text>{r.accountName}</Text> },
    payee: { key: "payee", header: "Payee", width: 220, sortable: true, cell: (r) => <Text>{r.payeeName ?? "-"}</Text> },
    category: { key: "category", header: "Category", width: 200, cell: (r) => <Text>{r.categoryName ?? "-"}</Text> },
    notes: { key: "notes", header: noteColumn?.header ?? "Notes", width: noteColumn ? 420 : 200, grow: true, cell: (r) => { const text = reasonOf(r) ?? noteColumn?.of(r) ?? r.notes ?? "-"; return <Text title={text === "-" ? undefined : text}>{text}</Text>; } },
    amount: { key: "amount", header: "Amount", width: 120, align: "right", sortable: true, cell: (r) => <span className="tabular-nums">{money(r.amountMinor)}</span> },
  };
  const columns: Column<PickedTransaction>[] = [
    ...(readOnly ? [] : [{ key: "select", header: "Select", hiddenHeader: true, width: 34, cell: (r) => <span onClickCapture={(e) => { shiftHeld.current = e.shiftKey; }}><Checkbox aria-label={`Select ${r.payeeName ?? "no payee"} ${r.date}`} checked={selected.has(r.id)} disabled={!!reasonOf(r)} onCheckedChange={() => choose(r)} /></span> } as Column<PickedTransaction>]),
    ...shown.map((key) => allColumns[key]),
  ];
  const clear = () => { setPicks(emptyPicks()); setSearchDraft(base.search); setFilters(base); setAdvancedOpen(!!base.advanced); };
  const narrowed = JSON.stringify({ ...filters, search: searchDraft }) !== JSON.stringify(base) || hasPicks(picks);
  const total = rows.reduce((s, r) => s + r.amountMinor, 0);
  // What the unnarrowed list adds up to, remembered once it is fully loaded, so a narrowed list can say what share of the whole it is.
  const [baseline, setBaseline] = useState<{ count: number; total: number } | null>(null);
  if (!narrowed && !hasMore && !search.isFetching && !search.isPending && (baseline?.count !== rows.length || baseline.total !== total)) setBaseline({ count: rows.length, total });
  const listKey = `${rows.length}|${total}|${hasMore}|${narrowed}|${search.isFetching}`;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (!search.isFetching) onListChange?.({ totalMinor: total, count: rows.length, complete: !hasMore, narrowed }); }, [listKey]);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (event.key === "/" && !/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) && !target.isContentEditable) { event.preventDefault(); searchRef.current?.focus(); }
  };
  return <div className="flex min-h-0 flex-1 flex-col gap-3" onKeyDown={onKeyDown}>
    <TransactionFilterBar state={{ ...filters, search: searchDraft }} onChange={(next) => { setSearchDraft(next.search); setFilters((f) => ({ ...next, search: f.search })); }} onClear={clear} offered={offered} constraints={constraints} lockedLabels={lockedLabels}
      reference={{ accountOptions: reference.accountOptions, categoryOptions: reference.categoryOptions, payeeOptions: reference.payeeOptions, tagOptions, names: reference.names }}
      searchRef={searchRef} advancedOpen={advancedOpen} onAdvancedOpen={setAdvancedOpen} extraActive={hasPicks(picks)} />
    {chartsOn && insights && showCharts && <PickerInsights options={insights} state={insightsState} constraints={baseConstraints} picks={picks} onPicks={setPicks} reference={{ names: reference.names, groupOf: reference.groupOf }} today={today} onHide={() => setShowCharts(false)} />}
    {/* One result bar for the list: what is listed now, how that compares with the whole, and what is selected in the charts. */}
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-border bg-muted/30 px-3 py-1.5 text-xs text-muted-foreground">
      <span role="status" className="text-sm">
        {search.isFetching && rows.length === 0 ? "Searching…" : (
          <>
            <span className="font-semibold text-foreground">{rows.length.toLocaleString()}{hasMore ? "+" : ""}</span>
            {narrowed && baseline ? <> of {baseline.count.toLocaleString()} {baseline.count === 1 ? "entry" : "entries"}</> : <> {rows.length === 1 ? "match" : "matches"}</>}
            {" · "}<span className="font-semibold tabular-nums text-foreground">{money(total)}</span>
            {narrowed && baseline && <> of <span className="tabular-nums">{money(baseline.total)}</span>{baseline.total !== 0 && !hasMore ? <> ({Math.round((total / baseline.total) * 100)}%)</> : null}</>}
            {hasMore ? " so far (scroll for more)" : ""}{search.isFetching && rows.length > 0 ? " · loading…" : ""}
          </>
        )}
      </span>
      {chartsOn && pickChips(picks, setPicks, reference.names).map((c) => (
        <span key={c.key} className="inline-flex h-6 items-center gap-1 rounded-md border border-foreground/30 bg-accent pl-2 text-foreground">
          <span className="max-w-48 truncate">{c.label}</span>
          <button type="button" aria-label={`Remove ${c.label}`} onClick={c.remove} className="mr-0.5 inline-flex size-4 items-center justify-center rounded hover:bg-muted"><X className="size-3" aria-hidden /></button>
        </span>
      ))}
      {chartsOn && !showCharts && <button type="button" className="hover:text-foreground" onClick={() => setShowCharts(true)}>Show charts</button>}
      {!readOnly && <label className="ml-auto flex cursor-pointer items-center gap-1.5"><Checkbox checked={onlySelected} onCheckedChange={(c) => setOnlySelected(c === true)} aria-label="Show selected only" disabled={picked.length === 0 && !onlySelected} />Show selected only</label>}
    </div>
    {search.isError && <p role="alert" className="text-sm text-destructive">{search.error instanceof Error ? search.error.message : "The transaction query failed"}</p>}
    <div className="flex min-h-0 flex-1"><DataTable label="Transactions to choose from" rows={shownRows} columns={columns} rowKey={(r) => r.id} rowLabel={(r) => `${r.payeeName ?? "No payee"} · ${r.date} · ${money(r.amountMinor)}`} onOpen={open}
      onRowKeys={(event, r) => { if (event.key === " ") { event.preventDefault(); choose(r); return true; } return false; }} onNearEnd={onlySelected ? undefined : loadMore}
      rowClassName={(r) => selected.has(r.id) ? "bg-accent/40" : reasonOf(r) ? "opacity-60" : undefined} rowHeight={30} dense sort={sort} onSort={setSort}
      empty={search.isPending ? "Searching…" : emptyMessage && !narrowed ? emptyMessage : onlySelected ? "Nothing is selected." : "No transactions match. Clear a filter or widen the dates."} /></div>
  </div>;
}
