"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, Pencil, Plus, Trash2 } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ClearedHeader, ClearedStatus } from "@/components/ui/cleared-status";
import { PillGroup } from "@/components/ui/pill-group";
import { Checkbox } from "@/components/ui/checkbox";
import { InfoHint } from "@/components/ui/info-hint";
import { SearchInput } from "@/components/ui/search-input";
import { Button } from "@/components/ui/button";
import { DataTable, Text, type Column, type SortState } from "@/features/credit-cards/components/primitives/DataTable";
import { AmountChip, DateChip, FacetChip } from "@/components/transactions/filterChips";
import { resolveDateRange } from "@/components/transactions/transactionPickerQuery";
import { BOOK_TYPES, type Asset, type BookType, type MetadataChange, type Registry } from "@/lib/asset-registry/models";
import { attributeBook, type AttributedRow, type BookSnapshot } from "@/lib/asset-registry/ledger";
import { boundTreatment, protectedReason, writeTypeTags, type ActionContext, type BookEdit } from "@/lib/asset-registry/actions";
import { isBenchCreated } from "@/lib/asset-registry/tags";
import { valueBridge } from "@/lib/asset-registry/valueBridge";
import { cn } from "@/lib/utils";
import { assetMoney, AttentionBadge, bookNotes, bookTypeLabel, NA, SummaryStrip } from "./AssetPresentation";
import { ALL_TIME, inRange, isAllTime, type AssetRange } from "./dateRange";
import { emptyRowFilters, matchesAmount, matchesIds, optionsFrom, rowFiltersActive } from "./rowFilters";
import { shortDate } from "@/features/credit-cards/components/primitives/format";
import { BookTypeMenu } from "./BookTypeMenu";
import { bookTypeChoices } from "./bookTypes";
import { BookActionEditor } from "./BookActionEditor";
import type { BookFocus } from "./TimelineSection";
import { registryRequest } from "./api";

/** The entries that set what the asset is worth by hand; scheduled depreciation does not count as someone looking at the value. */
const VALUE_UPDATES = ["opening-balance", "revaluation", "impairment", "other-adjustment"];
export type BookView = "asset" | "unclassified" | "unassigned" | "all";
export function BookPanel({ asset, registry, snapshot, fresh, onSaved, view, onViewChange, accountName, financialBlocked = false, onUncertain, focus, onClearFocus, onCapitalAction, recordDisabled = false, payeeOptions }: {
  /** Opens a financial entry from the Add Entry menu: a payment into the asset, or a sale or write-off. */ onCapitalAction?: (kind: "dispose" | "payment") => void; recordDisabled?: boolean;
  /** Payees loaded by the workspace for the entry editor's payee picker. */ payeeOptions?: { id: string; name: string; transferAccountId?: string | null }[];
  financialBlocked?: boolean; onUncertain?: () => void;
  /** A period (and types) chosen from a chart event; rows outside it are hidden until cleared. */ focus?: BookFocus | null; onClearFocus?: () => void;
  asset: Asset; registry: Registry; snapshot: BookSnapshot;
  fresh: (date: string) => Promise<ActionContext>; onSaved: (registry?: Registry) => Promise<void>;
  accountName?: string; view?: BookView; onViewChange?: (view: BookView) => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [localView, setLocalView] = useState<BookView>("asset");
  const filter = view ?? localView;
  const [search, setSearch] = useState("");
  /** In a shared account, whether the list also shows the other assets' transactions (off by default). */
  const [showOthers, setShowOthers] = useState(false);
  /** The picker's Type, Payee and Amount chips. A type is a book type, or "unclassified" for an entry without one. */
  const [filters, setFilters] = useState(emptyRowFilters);
  /** The dates the list and the KPI strip cover: the whole history until the user picks another range. */
  const [range, setRange] = useState<AssetRange>(ALL_TIME);
  const [typeMenu, setTypeMenu] = useState<{ row: AttributedRow; anchor: Element } | null>(null);
  const [bulkAnchor, setBulkAnchor] = useState<Element | null>(null);
  const [sort, setSort] = useState<SortState | null>({ key: "date", direction: "desc" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [uncertainAt, setUncertainAt] = useState<string | null>(null);
  const unknownWrite = uncertainAt === snapshot.fetchedAt;
  const [action, setAction] = useState<{ kind: BookEdit["kind"]; rowId?: string } | null>(null);
  const navigationGuard = useRef<((action: () => void) => void) | null>(null);
  const registerNavigationGuard = useCallback((guard: ((action: () => void) => void) | null) => { navigationGuard.current = guard; }, []);
  function openAction(next: NonNullable<typeof action>) {
    const navigate = () => { setTypeMenu(null); setAction(next); };
    if (navigationGuard.current) navigationGuard.current(navigate); else navigate();
  }
  const book = attributeBook(snapshot, registry.assets, registry.metadata);
  const own = book.rows.filter((r) => r.assetId === asset.id);
  const unassigned = book.rows.filter((r) => !r.assetId);
  const members = registry.assets.filter((a) => a.actualAccountId === asset.actualAccountId);
  const unclassified = own.filter((r) => bookTypeLabel(r.classification) === "Unclassified");
  const needle = search.trim().toLocaleLowerCase();
  const inView = (r: AttributedRow) => filter === "all" || (filter === "unassigned" ? !r.assetId : showOthers || r.assetId === asset.id || !r.assetId);
  const typeOf = (r: AttributedRow) => bookTypeLabel(r.classification) === "Unclassified" ? "unclassified" : r.classification;
  const rows = book.rows.filter((r) => inView(r) && matchesIds(typeOf(r), filters.types) && matchesIds(r.label, filters.payees) && matchesAmount(r.amountMinor, filters.amount) && (focus ? r.date >= focus.from && r.date <= focus.to && (!focus.types || focus.types.includes(r.classification ?? "")) : inRange(range, snapshot.date, r.date)) && `${r.label} ${r.notes ?? ""} ${bookTypeLabel(r.classification)}`.toLocaleLowerCase().includes(needle));
  const dir = sort?.direction === "asc" ? 1 : -1; const sortKey = sort?.key ?? "date";
  const sorted = [...rows].sort((a, b) => dir * (sortKey === "amount" ? a.amountMinor - b.amountMinor : sortKey === "payee" ? a.label.localeCompare(b.label) : sortKey === "type" ? bookTypeLabel(a.classification).localeCompare(bookTypeLabel(b.classification)) : a.date.localeCompare(b.date)));
  const writesBlocked = financialBlocked || asset.status !== "active" || !book.available || unknownWrite;
  const reasonFor = (r: AttributedRow | undefined) => protectedReason(snapshot.source.find((s) => s.id === r?.id), snapshot.transferKnown);
  /** Only a row Bench itself created gets its Notes tagged; a transaction made elsewhere is never edited. */
  const taggable = (r: AttributedRow) => !reasonFor(r) && isBenchCreated(snapshot.source.find((s) => s.id === r.id)?.importedId);
  const selectRow = (id: string) => setSelected((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  function changeView(value: BookView) { (onViewChange ?? setLocalView)(value); setSelected([]); }
  // A link that asks for the unclassified entries (the Overview, the KPI tile) becomes a Type filter, then the view goes back to normal.
  useEffect(() => { if (filter === "unclassified") { setFilters({ ...emptyRowFilters(), types: { ids: ["unclassified"], not: false } }); setRange(ALL_TIME); setSearch(""); changeView("asset"); } }, [filter]); // eslint-disable-line react-hooks/exhaustive-deps
  function openBulk(anchor: Element, ids = selected) { setSelected(ids); setError(""); setBulkAnchor(anchor); }
  const columns: Column<AttributedRow>[] = [
    { key: "selected", header: "Select", width: 34, align: "center", headerIcon: <Checkbox aria-label="Select all visible entries" checked={rows.length > 0 && rows.every((r) => selected.includes(r.id))} indeterminate={rows.some((r) => selected.includes(r.id)) && !rows.every((r) => selected.includes(r.id))} onCheckedChange={(checked) => setSelected(checked ? rows.map((r) => r.id) : [])} />, cell: (r) => <Checkbox aria-label={`Select ${r.label} ${r.date}`} checked={selected.includes(r.id)} onCheckedChange={() => selectRow(r.id)} /> },
    { key: "date", header: "Date", width: 104, sortable: true, cell: (r) => <Text title={r.date}>{shortDate(r.date, snapshot.date)}</Text> },
    { key: "payee", header: "Payee", width: 240, sortable: true, cell: (r) => <Text>{r.label}</Text> },
    { key: "notes", header: "Notes", width: 160, grow: true, cell: (r) => <Text title={r.notes ?? undefined} className="text-foreground/70">{bookNotes(r.notes)}</Text> },
    { key: "type", header: "Type", width: 250, sortable: true, cell: (r) => <button type="button" aria-label={`Classify ${r.label} on ${r.date}`} title={r.suggested ? `${bookTypeLabel(r.classification)} (suggested from Actual; choose a type to confirm)` : bookTypeLabel(r.classification)} onClick={(event) => setTypeMenu({ row: r, anchor: event.currentTarget })} className={cn("max-w-full truncate rounded border px-1.5 py-0.5 text-[11px] outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring", bookTypeLabel(r.classification) === "Unclassified" || r.suggested ? "border-dashed text-foreground/70" : "bg-muted/30 text-foreground")}>{bookTypeLabel(r.classification)}{r.suggested && <span className="ml-1 text-[10px] text-muted-foreground italic">suggested</span>}</button> },
    { key: "assignment", header: "Attribution", width: 115, cell: (r) => r.reason ? <AttentionBadge status={{ label: r.reason === "Unassigned" ? "Unassigned" : "Conflict", tone: "attention", detail: r.reason }} /> : <Text title={`Assigned to ${registry.assets.find((a) => a.id === r.assetId)?.name}. ${registry.metadata.find((m) => m.actualTransactionId === r.id)?.assetId ? "Bench-only whole-row mapping" : members.length > 1 ? "Asset hashtag in Actual Notes" : "Dedicated account"}`}>{filter === "all" ? registry.assets.find((a) => a.id === r.assetId)?.name ?? "Assigned" : members.length < 2 ? "Dedicated" : registry.metadata.find((m) => m.actualTransactionId === r.id)?.assetId ? "Bench mapping" : "Tagged"}</Text> },
    { key: "amount", header: "Amount", width: 115, align: "right", sortable: true, cell: (r) => <span className="tabular-nums">{r.amountMinor > 0 ? "+" : ""}{assetMoney(r.amountMinor)}</span> },
    { key: "cleared", header: "Cleared", headerIcon: <ClearedHeader />, width: 32, align: "center", cell: (r) => <ClearedStatus cleared={r.cleared} /> },
    { key: "running", header: "Running value", width: 125, align: "right", cell: (r) => <span className="tabular-nums">{r.runningMinor === null ? "-" : assetMoney(r.runningMinor)}</span> },
    { key: "actions", header: "Actions", hiddenHeader: true, width: 64, align: "right", sticky: "end", cell: (r) => { const reason = reasonFor(r); return <div className="flex justify-end gap-0.5">
      <Button size="icon" variant="ghost" className="size-6" aria-label={`Edit entry ${r.date} ${assetMoney(r.amountMinor)}`} title={reason ? "Edit classification and shared assignment" : "Edit entry"} onClick={() => openAction({ kind: "edit", rowId: r.id })}><Pencil className="size-3" /></Button>
      <Button size="icon" variant="ghost" className="size-6" aria-label={`Delete entry ${r.date} ${assetMoney(r.amountMinor)}`} title={reason ?? "Delete from Actual"} disabled={!!reason || writesBlocked || r.assetId !== asset.id} onClick={() => openAction({ kind: "delete", rowId: r.id })}><Trash2 className="size-3" /></Button>
    </div>; } },
  ];
  async function saveClassification(ids: string[], nextType: string) {
    setBusy(true); setError("");
    try {
      const context = await fresh(snapshot.date);
      const current = attributeBook(context.snapshot, context.registry.assets, context.registry.metadata);
      const changes: MetadataChange[] = ids.map((id) => {
        const old = book.rows.find((r) => r.id === id);
        const row = current.rows.find((r) => r.id === id);
        const meta = registry.metadata.find((m) => m.actualTransactionId === id);
        if (!old || !row || old.evidenceFingerprint !== row.evidenceFingerprint || old.notes !== row.notes || old.assetId !== row.assetId) throw new Error("Selected rows changed. Refresh and review classification again.");
        const bound = boundTreatment(context.registry, id);
        if (bound && (nextType || null) !== bound) throw new Error("A selected row belongs to a capital or disposal treatment; its type cannot be changed here.");
        if (nextType && nextType !== bound && !bookTypeChoices(row.amountMinor).includes(nextType as BookType)) throw new Error("Choose a type allowed for every selected amount.");
        return { actualTransactionId: id, actualAccountId: row.accountId, assetId: meta?.assetId ?? null, classification: (nextType || null) as MetadataChange["classification"], revision: meta?.revision ?? 0 };
      });
      // Tag the Notes in Actual first: if the metadata save then fails, the tag still carries the type.
      await writeTypeTags(context, ids, (nextType || null) as BookType | null);
      await onSaved(await registryRequest(asset.budgetSyncId, "PATCH", { changes }));
      setSelected([]);
    } catch (e) { if (typeMenu) throw e; setError(e instanceof Error ? e.message : "Classification failed"); }
    finally { setBusy(false); }
  }
  const panelOpen = !!action && (action.kind === "edit" || action.kind === "delete");
  const editingRow = book.rows.find((row) => row.id === action?.rowId);
  const financialLock = action?.rowId ? reasonFor(editingRow) ?? (editingRow?.assetId !== asset.id ? "Assign this row to the current asset before editing financial fields." : writesBlocked ? "Refresh or restore this asset before financial changes." : null) : writesBlocked ? "Refresh or restore this asset before financial changes." : null;
  const signedMoney = (minor: number) => `${minor > 0 ? "+" : ""}${assetMoney(minor)}`;
  // The KPIs follow the rows shown; the last value update and the unclassified count look at every date, so a problem outside the dates cannot hide.
  const shown = valueBridge(rows.filter((r) => r.assetId === asset.id), null, "9999-12-31");
  // Against what the dates started with plus what was put in during them; unknown (no percentage) when that is not above zero.
  const startsFrom = resolveDateRange(range, snapshot.date).from;
  const base = (startsFrom && !focus ? own.filter((r) => r.date < startsFrom).reduce((sum, r) => sum + r.amountMinor, 0) : 0) + shown.capitalMinor;
  const change = shown.revaluationMinor + shown.depreciationMinor;
  const lastUpdate = own.filter((r) => !r.suggested && VALUE_UPDATES.includes(r.classification ?? "")).map((r) => r.date).sort().at(-1);
  const daysSince = lastUpdate ? Math.max(0, Math.round((Date.parse(`${snapshot.date}T00:00:00Z`) - Date.parse(`${lastUpdate}T00:00:00Z`)) / 86_400_000)) : null;
  return <div className="flex min-h-0 flex-1 overflow-hidden"><div className="flex min-w-0 flex-1 flex-col">
    <SummaryStrip label="Asset Ledger summary" items={[
      { label: "Entries shown", value: String(rows.length), detail: rows.length === book.rows.filter(inView).length ? "All entries in this view" : `of ${book.rows.filter(inView).length} in this view`, wrap: true },
      { label: "Capital added", value: signedMoney(shown.capitalMinor), detail: "Opening value, purchases and added capital", wrap: true },
      { label: "Value change", value: signedMoney(change), detail: base > 0 ? `${change > 0 ? "+" : ""}${((change / base) * 100).toFixed(2)}% of opening value and capital added` : "Revaluation, depreciation and write-downs", wrap: true },
      { label: "Last value update", value: lastUpdate ? shortDate(lastUpdate, snapshot.date) : NA, detail: daysSince === null ? "No value entered by hand yet" : `${daysSince === 0 ? "Today" : `${daysSince} ${daysSince === 1 ? "day" : "days"} ago`} · all dates`, wrap: true },
      { label: "Unclassified", value: <span className={unclassified.length > 0 ? "text-amber-600 dark:text-amber-500" : undefined}>{unclassified.length}</span>, detail: unclassified.length === 0 ? "All classified · all dates" : <button type="button" className="underline underline-offset-2" onClick={() => { setFilters((f) => ({ ...f, types: { ids: ["unclassified"], not: false } })); setRange(ALL_TIME); setSearch(""); }}>Show them · all dates</button>, wrap: true },
    ]} />
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-4 py-2">
      <InfoHint label="Asset Ledger">The entries in this asset&apos;s own account in Actual. They set its recorded value, and this list matches that account in Actual.</InfoHint>
      <SearchInput size="sm" aria-label="Search entries" className={panelOpen ? "w-36" : "w-48"} value={search} onValueChange={(value) => { setSearch(value); setSelected([]); }} />
      {!focus && <DateChip value={range} onChange={(next) => { setRange(next); setSelected([]); }} />}
      <AmountChip value={filters.amount} onChange={(amount) => { setFilters((f) => ({ ...f, amount })); setSelected([]); }} />
      <FacetChip name="Payee" plural="payees" options={optionsFrom(book.rows.map((r): [string, string] => [r.label, r.label]))} value={filters.payees} onChange={(payees) => { setFilters((f) => ({ ...f, payees })); setSelected([]); }} onReset={() => { setFilters((f) => ({ ...f, payees: { ids: [], not: false } })); setSelected([]); }} nameOf={(id) => id} />
      <FacetChip name="Type" plural="types" options={[...Object.entries(BOOK_TYPES).map(([id, name]) => ({ id, name })), { id: "unclassified", name: "Unclassified" }]} value={filters.types} onChange={(types) => { setFilters((f) => ({ ...f, types })); setSelected([]); }} onReset={() => { setFilters((f) => ({ ...f, types: { ids: [], not: false } })); setSelected([]); }} nameOf={(id) => id === "unclassified" ? "Unclassified" : bookTypeLabel(id)} />
      {focus && <span role="status" className="inline-flex h-7 items-center gap-1.5 rounded-md border bg-accent/40 px-2 text-xs">From the chart: {focus.label}<Button size="xs" variant="ghost" className="h-5 px-1.5" aria-label={`Clear filter ${focus.label}`} onClick={() => { setSelected([]); onClearFocus?.(); }}>Clear</Button></span>}
      {(members.length > 1 || unassigned.length > 0) && <div role="group" aria-label="Asset Ledger views"><PillGroup<BookView> value={filter} onChange={(value) => changeView(value)} options={[{ value: "asset", label: "All", count: own.length + unassigned.length + (showOthers ? book.rows.length - own.length - unassigned.length : 0) }, { value: "unassigned" as const, label: "Unassigned", count: unassigned.length }]} /></div>}
      {members.length > 1 && <label className="flex items-center gap-1.5 text-xs text-muted-foreground"><Checkbox aria-label="Show other assets' entries" checked={showOthers} onCheckedChange={(v) => { setShowOthers(v === true); setSelected([]); }} />Show other assets&apos; entries</label>}
      {(search || rowFiltersActive(filters) || !isAllTime(range)) && <Button size="sm" variant="ghost" onClick={() => { setSearch(""); setFilters(emptyRowFilters()); setRange(ALL_TIME); setSelected([]); }}>Clear filters</Button>}
      <span className="ml-auto" /><Button size="sm" variant="outline" disabled={writesBlocked} onClick={() => openAction({ kind: "set-value" })}>Update value</Button>
      <DropdownMenu><DropdownMenuTrigger render={<Button size="sm" disabled={writesBlocked} />}><Plus className="size-3.5" aria-hidden />Add Entry<ChevronDown className="size-3.5" aria-hidden /></DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-[22rem] p-1.5">
          <DropdownMenuItem disabled={recordDisabled || !onCapitalAction} onClick={() => onCapitalAction?.("payment")} className="flex-col items-start gap-0.5 px-2 py-1.5"><span className="text-sm font-medium">Add a payment</span><span className="text-xs whitespace-normal text-muted-foreground">Adds to the asset&apos;s value as capital: a purchase, instalment or improvement paid from another account.</span></DropdownMenuItem>
          <DropdownMenuItem onClick={() => openAction({ kind: "create" })} className="flex-col items-start gap-0.5 px-2 py-1.5"><span className="text-sm font-medium">Value adjustment</span><span className="text-xs whitespace-normal text-muted-foreground">Type an amount straight into this asset&apos;s account to correct or adjust its value.</span></DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={recordDisabled || !onCapitalAction} onClick={() => onCapitalAction?.("dispose")} className="flex-col items-start gap-0.5 px-2 py-1.5"><span className="text-sm font-medium">Sale or write-off</span><span className="text-xs whitespace-normal text-muted-foreground">Remove value, with or without proceeds.</span></DropdownMenuItem>
          <p className="px-2 pt-1.5 pb-1 text-[11px] text-muted-foreground">Already transferred in Actual? It appears here by itself.</p>
        </DropdownMenuContent></DropdownMenu>
    </div>
    {unassigned.length > 0 && filter !== "unassigned" && <div className="flex shrink-0 items-center justify-between gap-3 border-b bg-muted/30 px-4 py-1.5 text-xs"><span>{members.length > 1 ? "Shared account" : "Account attribution"} · {unassigned.length} unassigned {unassigned.length === 1 ? "row" : "rows"} <strong className="ml-1 tabular-nums">{book.available ? assetMoney(book.unassignedMinor) : "Unavailable"}</strong></span><Button size="xs" variant="outline" onClick={() => changeView("unassigned")}>Review unassigned</Button></div>}
    {selected.length > 0 && <div role="region" aria-label="Selected entries" className="flex shrink-0 items-center gap-2 border-b bg-accent/40 px-4 py-1.5 text-xs"><strong>{selected.length} selected</strong><span className="mr-2 text-muted-foreground">Visible rows</span><Button size="xs" variant="outline" disabled={busy} onClick={(event) => openBulk(event.currentTarget)}>Classify…</Button><Button size="xs" variant="ghost" className="ml-auto" onClick={() => setSelected([])}>Clear selection</Button></div>}
    {error && <p role="alert" className="border-b p-3 text-sm text-destructive">{error}</p>}
    {unknownWrite && <p role="alert" className="border-b p-3 text-sm text-destructive">A previous Actual write has an uncertain outcome. Refresh and inspect the account before starting another financial action.</p>}
    <DataTable label="Asset Ledger" activeKey={action?.rowId} columns={members.length > 1 || unassigned.length > 0 ? columns : columns.filter((c) => c.key !== "assignment")} rows={sorted} sort={sort} onSort={setSort} rowKey={(r) => r.id} rowLabel={(r) => `${r.label} · ${r.date} · ${assetMoney(r.amountMinor)}`} rowClassName={(r) => selected.includes(r.id) ? "bg-accent/40" : undefined} onRowKeys={(e, r) => { if (e.key === " ") { selectRow(r.id); return true; } if (e.key.toLowerCase() === "t" && !e.ctrlKey && !e.metaKey && !e.altKey) { if (selected.length > 1) openBulk(e.currentTarget); else setTypeMenu({ row: book.rows.find((row) => row.id === selected[0]) ?? r, anchor: e.currentTarget }); return true; } return false; }} rowHeight={30} dense empty="No matching entries. Clear filters or refresh the linked account." />
    {bulkAnchor && <BookTypeMenu key="bulk" taggable={selected.filter((id) => { const r = book.rows.find((x) => x.id === id); return r && taggable(r); }).length} rows={selected.map((id) => book.rows.find((r) => r.id === id)).filter((r): r is AttributedRow => !!r)} anchor={bulkAnchor} onClose={() => setBulkAnchor(null)} onSave={async (type) => { await saveClassification(selected, type); }} />}
    {typeMenu && <BookTypeMenu key={typeMenu.row.id} taggable={taggable(typeMenu.row) ? 1 : 0} rows={[typeMenu.row]} anchor={typeMenu.anchor} onClose={() => setTypeMenu(null)} onSave={async (type) => { await saveClassification([typeMenu.row.id], type); }} />}
    </div>
    {action && <BookActionEditor key={`${action.kind}:${action.rowId ?? "new"}`} payeeOptions={payeeOptions} kind={action.kind} asset={asset} registry={registry} snapshot={snapshot} registerNavigationGuard={registerNavigationGuard} financialLock={financialLock} accountName={accountName} initialClassification={(editingRow && !editingRow.suggested ? editingRow.classification ?? undefined : undefined) as BookType | undefined} row={snapshot.source.find((r) => r.id === action.rowId)} fresh={fresh} onClose={() => setAction(null)} onSaved={onSaved} onUncertain={() => { setUncertainAt(snapshot.fetchedAt); onUncertain?.(); }} />}
  </div>;
}
