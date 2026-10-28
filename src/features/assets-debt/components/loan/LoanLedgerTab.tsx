"use client";

import { useMemo, useState } from "react";
import { ChevronDown, Landmark, Pencil, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ClearedHeader, ClearedStatus } from "@/components/ui/cleared-status";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { InfoHint } from "@/components/ui/info-hint";
import { SearchInput } from "@/components/ui/search-input";
import { DateChip, FacetChip } from "@/components/transactions/filterChips";
import type { IdFilter } from "@/components/transactions/transactionPickerQuery";
import { DataTable, Text, type Column, type SortState } from "@/features/credit-cards/components/primitives/DataTable";
import { EmptyState, SummaryStrip } from "@/features/asset-registry/AssetPresentation";
import { ALL_TIME, inRange, type AssetRange } from "@/features/asset-registry/dateRange";
import { matchesIds } from "@/features/asset-registry/rowFilters";
import type { EntryType, LedgerRow } from "@/lib/assets-debt/tracking/plan";
import type { LedgerChange } from "@/lib/app-db/debtTrackingRepository";
import { cn } from "@/lib/utils";
import { formatAmount } from "../../lib/money";
import type { LoanTracking } from "../../lib/useLoanTracking";
import { LoanMenuContent, ENTRY_LABELS, dt, entryChoices } from "./presentation";
import { TextField } from "../fields";

/**
 * Loan Ledger (design spec 06 §7.3): every row in the loan account with its type. Bench suggests a type from what Actual
 * says (dashed, "suggested"); suggestions already count in the calculation, and choosing a type saves it in Bench only.
 * Notes are edited in Actual from here; a transfer's date and amount are edited from its paying side.
 */

export function LoanLedgerTab({ tracking, digits, onLinkToActual, onSaveEntries, onSaveNotes, onAddAdjustment, onStatement, writesLocked }: {
  tracking: LoanTracking; digits: number; onLinkToActual: () => void;
  onSaveEntries: (changes: LedgerChange[]) => Promise<void>;
  /** Write a row's Notes to Actual (one update, recorded in the journal). */ onSaveNotes: (row: LedgerRow, notes: string) => Promise<void>;
  onAddAdjustment: () => void; onStatement: () => void; writesLocked: boolean;
}) {
  const money = (minor: number) => formatAmount(minor, digits);
  const [search, setSearch] = useState("");
  const [range, setRange] = useState<AssetRange>(ALL_TIME);
  const [types, setTypes] = useState<IdFilter>({ ids: [], not: false });
  const [selected, setSelected] = useState<string[]>([]);
  const [sort, setSort] = useState<SortState | null>({ key: "date", direction: "desc" });
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const result = tracking.result?.ok ? tracking.result : null;
  const ledger = useMemo(() => result?.ledger ?? [], [result]);

  if (!tracking.tracked) return <EmptyState icon={Landmark} title="Not tracked in Actual yet" action={<Button size="sm" onClick={onLinkToActual}>Link to Actual</Button>}>Link the loan to its account in Actual to see every row of it here.</EmptyState>;
  if (tracking.error && !tracking.result) return <p role="alert" className="m-4 text-sm text-destructive">{tracking.error}</p>;
  if (tracking.loading || !tracking.result) return <p role="status" className="p-4 text-sm text-muted-foreground">Reading the loan account in Actual…</p>;
  if (!result) return <p role="alert" className="m-4 text-sm">{!tracking.result.ok ? tracking.result.message : ""}</p>;

  const start = result.opening.date;
  const needle = search.trim().toLowerCase();
  const rows = ledger.filter((l) => inRange(range, tracking.today, l.row.date) && matchesIds(l.type, types) && `${l.row.payeeName ?? ""} ${l.row.notes ?? ""} ${ENTRY_LABELS[l.type]}`.toLowerCase().includes(needle));
  const dir = sort?.direction === "asc" ? 1 : -1;
  const sorted = [...rows].sort((a, b) => dir * (sort?.key === "amount" ? a.row.amount - b.row.amount : sort?.key === "type" ? ENTRY_LABELS[a.type].localeCompare(ENTRY_LABELS[b.type]) : a.row.date.localeCompare(b.row.date) || a.row.id.localeCompare(b.row.id)));
  const sum = (filter: (l: LedgerRow) => boolean) => ledger.filter(filter).reduce((s, l) => s + l.row.amount, 0);
  const unclassified = ledger.filter((l) => l.type === "unclassified");
  const balance = ledger.at(-1)?.runningMinor ?? 0;

  async function classify(ids: string[], type: EntryType | null) {
    setBusy(true); setError("");
    try {
      await onSaveEntries(ids.map((id): LedgerChange => {
        const l = ledger.find((x) => x.row.id === id)!;
        return { actualTransactionId: id, actualAccountId: l.row.accountId, entryType: type === "unclassified" ? null : type, revision: l.entryRevision };
      }));
      setSelected([]);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save the type"); }
    finally { setBusy(false); }
  }

  const typeMenu = (l: LedgerRow) => (
    <DropdownMenu>
      <DropdownMenuTrigger render={<button type="button" aria-label={`Type of ${l.row.payeeName ?? "row"} on ${l.row.date}: ${ENTRY_LABELS[l.type]}`} title={l.suggested ? `${ENTRY_LABELS[l.type]} (suggested from Actual; choose a type to confirm)` : ENTRY_LABELS[l.type]}
        className={cn("max-w-full truncate rounded border px-1.5 py-0.5 text-[11px] outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring", l.type === "unclassified" ? "border-dashed text-amber-700 dark:text-amber-400" : l.suggested ? "border-dashed text-foreground/70" : "bg-muted/30")} />}>
        {ENTRY_LABELS[l.type]}{l.suggested ? <span className="ml-1 text-[10px] text-muted-foreground italic">suggested</span> : null}
      </DropdownMenuTrigger>
      <LoanMenuContent align="start">
        {entryChoices(l.row.amount).map((t) => <DropdownMenuItem key={t} disabled={busy} onClick={() => void classify([l.row.id], t)}>{ENTRY_LABELS[t]}{t === l.type && !l.suggested ? " ✓" : ""}</DropdownMenuItem>)}
        {l.entryRevision ? <DropdownMenuItem disabled={busy} onClick={() => void classify([l.row.id], null)}>Back to Bench&apos;s suggestion</DropdownMenuItem> : null}
      </LoanMenuContent>
    </DropdownMenu>
  );

  const columns: Column<LedgerRow>[] = [
    { key: "select", header: "Select", width: 34, align: "center", headerIcon: <Checkbox aria-label="Select all visible rows" checked={rows.length > 0 && rows.every((l) => selected.includes(l.row.id))} onCheckedChange={(on) => setSelected(on ? rows.map((l) => l.row.id) : [])} />, cell: (l) => <Checkbox aria-label={`Select ${l.row.payeeName ?? "row"} ${l.row.date}`} checked={selected.includes(l.row.id)} onCheckedChange={() => setSelected((s) => (s.includes(l.row.id) ? s.filter((x) => x !== l.row.id) : [...s, l.row.id]))} /> },
    { key: "date", header: "Date", width: 104, sortable: true, cell: (l) => <Text>{dt(l.row.date)}</Text> },
    { key: "payee", header: "Payee", width: 220, cell: (l) => <Text>{l.row.payeeName ?? (l.row.transferId ? "Transfer" : "-")}</Text> },
    { key: "notes", header: "Notes", width: 160, grow: true, cell: (l) => <Text className="text-foreground/70" title={l.row.notes ?? undefined}>{l.row.notes ?? ""}</Text> },
    { key: "type", header: "Type", width: 230, sortable: true, cell: (l) => <span className="inline-flex max-w-full items-center gap-1">{typeMenu(l)}{l.includesInterestMinor ? <InfoHint label={`Includes ${money(l.includesInterestMinor)} interest`}>This whole transfer still includes {money(l.includesInterestMinor)} of interest. Apply installment {l.installment} in Repayments to split it.</InfoHint> : null}</span> },
    { key: "installment", header: "Installment", width: 92, align: "right", cell: (l) => <span className="tabular-nums">{l.installment ?? "-"}</span> },
    { key: "amount", header: "Amount", width: 124, align: "right", sortable: true, cell: (l) => <span className="tabular-nums">{l.row.amount > 0 ? "+" : ""}{money(l.row.amount)}</span> },
    { key: "cleared", header: "Cleared", headerIcon: <ClearedHeader />, width: 32, align: "center", cell: (l) => <ClearedStatus cleared={l.row.cleared} /> },
    { key: "running", header: "Balance", width: 132, align: "right", cell: (l) => <span className="tabular-nums">{money(l.runningMinor)}</span> },
    { key: "actions", header: "Actions", hiddenHeader: true, width: 44, align: "right", sticky: "end", cell: (l) => <Button size="icon-xs" variant="ghost" aria-label={`Edit ${l.row.payeeName ?? "row"} on ${l.row.date}`} onClick={() => setEditing(l.row.id)}><Pencil className="size-3" /></Button> },
  ];
  const editRow = ledger.find((l) => l.row.id === editing) ?? null;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <SummaryStrip label="Loan Ledger summary" items={[
          { label: "Account balance", value: money(balance), detail: tracking.reads?.complete === false ? "Didn't read completely: refresh" : "Loan account today · as Actual shows it", wrap: true },
          { label: "Repayments", value: money(sum((l) => l.type === "principal-repayment" && l.row.date > start)), detail: "Into the loan account since the tracking start", wrap: true },
          { label: "Extra principal", value: money(sum((l) => l.type === "extra-principal")), detail: `${ledger.filter((l) => l.type === "extra-principal").length} entries · counted in the calculation`, wrap: true },
          { label: "Draws and fees", value: money(sum((l) => l.type === "draw" || l.type === "fee")), detail: `${ledger.filter((l) => l.type === "draw" || l.type === "fee").length} entries`, wrap: true },
          { label: "Unclassified", value: <span className={unclassified.length ? "text-amber-700 dark:text-amber-400" : undefined}>{unclassified.length}</span>, detail: unclassified.length ? <button type="button" className="underline underline-offset-2" onClick={() => { setTypes({ ids: ["unclassified"], not: false }); setRange(ALL_TIME); setSearch(""); }}>Show them · all dates</button> : "All classified · all dates", wrap: true },
        ]} />
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-4 py-2">
          <InfoHint label="Loan Ledger">Every transaction in the loan&apos;s account in Actual, with what it is. Its balance is the debt Actual shows.</InfoHint>
          <SearchInput size="sm" aria-label="Search entries" className="w-48" value={search} onValueChange={setSearch} />
          <DateChip value={range} onChange={setRange} />
          <FacetChip name="Type" plural="types" options={(Object.keys(ENTRY_LABELS) as EntryType[]).map((id) => ({ id, name: ENTRY_LABELS[id] }))} value={types} onChange={setTypes} onReset={() => setTypes({ ids: [], not: false })} nameOf={(id) => ENTRY_LABELS[id as EntryType] ?? id} />
          {search || types.ids.length || range.preset !== "all" ? <Button size="sm" variant="ghost" onClick={() => { setSearch(""); setTypes({ ids: [], not: false }); setRange(ALL_TIME); }}>Clear filters</Button> : null}
          <span className="ml-auto" />
          <DropdownMenu><DropdownMenuTrigger render={<Button size="sm" disabled={writesLocked} />}><Plus className="size-3.5" aria-hidden />Add entry<ChevronDown className="size-3.5" aria-hidden /></DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-80 p-1.5">
              <DropdownMenuItem onClick={onAddAdjustment} className="flex-col items-start gap-0.5 px-2 py-1.5"><span className="text-sm font-medium">Adjustment</span><span className="text-xs whitespace-normal text-muted-foreground">An amount straight into the loan account to correct its balance.</span></DropdownMenuItem>
              <DropdownMenuItem onClick={onStatement} className="flex-col items-start gap-0.5 px-2 py-1.5"><span className="text-sm font-medium">Lender statement</span><span className="text-xs whitespace-normal text-muted-foreground">Compare your lender&apos;s balance with Actual and the calculation.</span></DropdownMenuItem>
              <p className="px-2 pt-1.5 pb-1 text-[11px] text-muted-foreground">Repayments and extra payments made in Actual appear here by themselves.</p>
            </DropdownMenuContent></DropdownMenu>
        </div>
        {selected.length ? <div role="region" aria-label="Selected entries" className="flex shrink-0 items-center gap-2 border-b bg-accent/40 px-4 py-1.5 text-xs"><strong>{selected.length} selected</strong><span className="mr-2 text-muted-foreground">Visible rows</span>
          <DropdownMenu><DropdownMenuTrigger render={<Button size="xs" variant="outline" disabled={busy} />}>Classify…</DropdownMenuTrigger><LoanMenuContent align="start">
            {(() => { const signs = new Set(selected.map((id) => Math.sign(ledger.find((l) => l.row.id === id)?.row.amount ?? 0))); const choices = signs.size === 1 ? entryChoices([...signs][0]) : (["adjustment"] as const); return choices.map((t) => <DropdownMenuItem key={t} onClick={() => void classify(selected, t)}>{ENTRY_LABELS[t]}</DropdownMenuItem>); })()}
          </LoanMenuContent></DropdownMenu>
          <Button size="xs" variant="ghost" className="ml-auto" onClick={() => setSelected([])}>Clear selection</Button></div> : null}
        {error ? <p role="alert" className="border-b p-3 text-sm text-destructive">{error}</p> : null}
        {/* The entry editor opens beside the table only: the figures and the toolbar keep the full width. */}
        <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <DataTable label="Loan Ledger" columns={columns} rows={sorted} rowKey={(l) => l.row.id} rowLabel={(l) => `${l.row.payeeName ?? "Row"} · ${l.row.date} · ${money(l.row.amount)}`} activeKey={editing} onOpen={(l) => setEditing(l.row.id)} sort={sort} onSort={setSort} dense rowHeight={30}
          rowClassName={(l) => (selected.includes(l.row.id) ? "bg-accent/40" : undefined)}
          onRowKeys={(e, l) => { if (e.key === " ") { setSelected((s) => (s.includes(l.row.id) ? s.filter((x) => x !== l.row.id) : [...s, l.row.id])); return true; } return false; }}
          empty={ledger.length ? "No entries match your filters." : "The loan account has no transactions yet."} />
        </div>
      {editRow ? <EntryEditor key={editRow.row.id} row={editRow} money={money} writesLocked={writesLocked} onClose={() => setEditing(null)} onSaveNotes={onSaveNotes} onClassify={(t) => classify([editRow.row.id], t)} /> : null}
        </div>
    </div>
  );
}

function EntryEditor({ row, money, writesLocked, onClose, onSaveNotes, onClassify }: { row: LedgerRow; money: (m: number) => string; writesLocked: boolean; onClose: () => void; onSaveNotes: (row: LedgerRow, notes: string) => Promise<void>; onClassify: (t: EntryType) => Promise<void> }) {
  const [notes, setNotes] = useState(row.row.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const changed = notes !== (row.row.notes ?? "");
  const locked = row.row.reconciled ? "This row is reconciled in Actual." : null;
  async function save() {
    setBusy(true); setError("");
    try { await onSaveNotes(row, notes); setDone(true); } catch (e) { setError(e instanceof Error ? e.message : "Could not save the Notes"); } finally { setBusy(false); }
  }
  return (
    <aside aria-label="Entry editor" className="flex min-h-0 w-[394px] shrink-0 flex-col border-l border-border/60 bg-background">
      <header className="flex h-[45px] shrink-0 items-center justify-between gap-2 border-b border-border/60 px-4"><h3 className="text-sm font-semibold">Edit entry</h3><Button variant="ghost" size="icon" className="size-7" aria-label="Close entry editor" disabled={busy} onClick={onClose}><X className="size-4" /></Button></header>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 text-xs">
        <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1"><dt className="text-muted-foreground">Date</dt><dd className="text-right">{dt(row.row.date)}</dd><dt className="text-muted-foreground">Payee</dt><dd className="text-right">{row.row.payeeName ?? "-"}</dd><dt className="text-muted-foreground">Amount</dt><dd className="text-right tabular-nums">{row.row.amount > 0 ? "+" : ""}{money(row.row.amount)}</dd>{row.installment ? <><dt className="text-muted-foreground">Installment</dt><dd className="text-right">{row.installment}</dd></> : null}</dl>
        {row.row.transferId ? <p className="text-muted-foreground">This is a transfer. Its date and amount are edited from the account it was paid from{row.installment ? `, or by applying installment ${row.installment} in Repayments` : ""}.</p> : row.benchMade ? <p className="text-muted-foreground">Bench created this row. To change its amount, delete it in Actual and add a new adjustment.</p> : null}
        <div className="flex flex-col gap-1"><span className="font-medium">Type</span>
          <div className="flex flex-wrap gap-1">{entryChoices(row.row.amount).map((t) => <Button key={t} size="xs" variant={row.type === t ? "default" : "outline"} disabled={busy} onClick={() => void onClassify(t)}>{ENTRY_LABELS[t]}</Button>)}</div>
          <span className="text-muted-foreground">Saved in Bench only. Nothing is written to Actual for a type.{row.suggested ? " The highlighted type is Bench's suggestion." : ""}</span>
        </div>
        <TextField label="Notes" value={notes} onChange={(v) => { setNotes(v); setDone(false); }} hint="Written to the Notes of this transaction in Actual." />
        {locked ? <p className="text-muted-foreground">{locked} Its Notes can still be changed.</p> : null}
        {done ? <p role="status">Notes saved in Actual.</p> : null}
        {error ? <p role="alert" className="text-destructive">{error}</p> : null}
      </div>
      <footer className="flex shrink-0 justify-end gap-2 border-t p-3"><Button variant="outline" size="sm" disabled={busy} onClick={onClose}>Close</Button><Button size="sm" disabled={!changed || busy || writesLocked} onClick={() => void save()}>{busy ? "Saving…" : "Save Notes"}</Button></footer>
    </aside>
  );
}
