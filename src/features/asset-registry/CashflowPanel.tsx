"use client";
import { useState } from "react";
import { Plus, Unlink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DateInput } from "@/components/ui/date-input";
import { Select } from "@/components/ui/select";
import { InfoHint } from "@/components/ui/info-hint";
import { SearchInput } from "@/components/ui/search-input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { TransactionPickerDialog } from "@/components/transactions/TransactionPickerDialog";
import type { PickedTransaction } from "@/components/transactions/transactionPickerQuery";
import { DataTable, Text, type Column, type SortState } from "@/features/credit-cards/components/primitives/DataTable";
import { shortDate } from "@/features/credit-cards/components/primitives/format";
import { CASHFLOW_GROUPS, CASHFLOW_TYPES, type Asset, type CashflowMetadata, type CashflowType, type Registry } from "@/lib/asset-registry/models";
import { cashflowChoices, sourceEvidence, type CashflowChange, type ExternalSnapshot } from "@/lib/asset-registry/cashflows";
import { capitalEvidence, type CapitalContext } from "@/lib/asset-registry/capitalActions";
import { ruleMatches, ruleWhere, type LinkRule } from "@/lib/asset-registry/linkRules";
import { LinkRulesDialog } from "./LinkRulesDialog";
import type { CashflowFocus } from "./TimelineSection";
import { registryRequest } from "./api";
import { assetMoney } from "./AssetPresentation";

/** Grouped Select options (income, expenses, capital & disposal) limited to the types `allowed` accepts. */
const typeGroups = (allowed: (type: CashflowType) => boolean) => CASHFLOW_GROUPS.map((g) => ({ label: g.label, options: g.types.filter(allowed).map((value) => ({ value, label: CASHFLOW_TYPES[value] })) })).filter((g) => g.options.length > 0);
export function CashflowPanel({ asset, registry, external, from, to, onFrom, onTo, today, fresh, ensureExternal, onSaved, onCapitalize, financialBlocked, focus, onClearFocus }: {
  /** A period (and type) chosen from a chart event; shown as a chip with Clear. */ focus?: CashflowFocus | null; onClearFocus?: () => void;
  asset: Asset; registry: Registry; external: ExternalSnapshot; from: string; to: string; onFrom: (date: string) => void; onTo: (date: string) => void; today: string;
  fresh: (date: string, accountIds?: string[]) => Promise<CapitalContext>; /** Reads just these accounts (plus the linked ones) so picked rows can be validated. */ ensureExternal: (accountIds: string[]) => Promise<ExternalSnapshot>;
  financialBlocked: boolean; onSaved: (registry?: Registry) => Promise<void>; onCapitalize: () => void;
}) {
  const [search, setSearch] = useState(""); const [filter, setFilter] = useState(""); const [selected, setSelected] = useState<string[]>([]); const [linking, setLinking] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false); const [applying, setApplying] = useState<LinkRule | null>(null);
  const [bulkType, setBulkType] = useState(""); const [linkType, setLinkType] = useState(""); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const [sort, setSort] = useState<SortState | null>({ key: "date", direction: "desc" });
  const assetAccounts = [...new Set(registry.assets.map((a) => a.actualAccountId))];
  const linked = (registry.cashflows ?? []).filter((m) => m.assetId === asset.id).map((meta) => ({ meta, row: external.rows.find((r) => r.id === meta.actualTransactionId && r.accountId === meta.actualAccountId) }));
  const filtered = linked.filter(({ meta, row }) => (!row || (row.date >= from && row.date <= to) || meta.context?.data.kind === "selling-cost") && (!(focus?.type ?? filter) || meta.classification === (focus?.type ?? filter)) && `${row?.label ?? "missing"} ${row?.notes ?? ""} ${row?.categoryName ?? ""}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  const dir = sort?.direction === "asc" ? 1 : -1;
  filtered.sort((a, b) => {
    if (!a.row || !b.row) return a.row ? 1 : b.row ? -1 : 0; // sources that went missing stay on top so they are noticed
    const key = sort?.key ?? "date";
    return dir * (key === "amount" ? a.row.amountMinor - b.row.amountMinor : key === "payee" ? a.row.label.localeCompare(b.row.label) : key === "type" ? String(a.meta.classification).localeCompare(String(b.meta.classification)) : a.row.date.localeCompare(b.row.date));
  });
  type Entry = typeof linked[number];
  async function save(changes: CashflowChange[], before: ExternalSnapshot = external) {
    const context = await fresh(to, [...new Set(changes.map((c) => c.actualAccountId))]);
    for (const change of changes.filter((c) => !c.remove)) {
      const was = before.rows.find((r) => r.id === change.actualTransactionId);
      const now = context.external.rows.find((r) => r.id === change.actualTransactionId);
      if (!was || !now || JSON.stringify(was) !== JSON.stringify(now)) throw new Error("Source changed. Refresh and review the link again.");
    }
    await onSaved(await registryRequest(asset.budgetSyncId, "PUT", { changes, sources: sourceEvidence(capitalEvidence(context)) }));
    setSelected([]);
  }
  const changeFor = (m: CashflowMetadata, type: string | null, remove = false): CashflowChange => ({ role: "cashflow", actualTransactionId: m.actualTransactionId, actualAccountId: m.actualAccountId, assetId: asset.id, classification: type, revision: m.revision, remove });
  async function run(action: () => Promise<void>) { setBusy(true); setError(""); try { await action(); } catch (e) { setError(e instanceof Error ? e.message : "Could not save links"); } finally { setBusy(false); } }
  const label = (e: Entry) => `${e.row?.label ?? "missing source"} ${e.row?.date ?? ""}`.trim();
  const columns: Column<Entry>[] = [
    { key: "select", header: "Select", width: 34, headerIcon: <Checkbox aria-label="Select visible cashflows" checked={filtered.length > 0 && filtered.every((e) => selected.includes(e.meta.actualTransactionId))} onCheckedChange={(v) => setSelected(v ? filtered.map((e) => e.meta.actualTransactionId) : [])} />, cell: (e) => <Checkbox aria-label={`Select linked ${label(e)}`} checked={selected.includes(e.meta.actualTransactionId)} onCheckedChange={(v) => setSelected((ids) => v ? [...ids, e.meta.actualTransactionId] : ids.filter((id) => id !== e.meta.actualTransactionId))} /> },
    { key: "date", header: "Actual date", width: 105, sortable: true, cell: ({ row }) => row ? <Text title={row.date}>{shortDate(row.date, today)}</Text> : "Missing" },
    { key: "account", header: "Account", width: 150, cell: ({ meta }) => <Text>{external.accounts.find((a) => a.id === meta.actualAccountId)?.name ?? "Unavailable"}</Text> },
    { key: "payee", header: "Payee", width: 160, sortable: true, cell: ({ row }) => <Text>{row?.label ?? "Missing / moved source"}</Text> },
    { key: "category", header: "Actual category", width: 155, cell: ({ row }) => <Text>{row?.categoryName ?? "-"}</Text> },
    { key: "notes", header: "Actual Notes", width: 180, grow: true, cell: ({ row, meta }) => <Text title={row?.notes ?? undefined}>{meta.context?.data.kind === "selling-cost" ? `Selling cost · reported with disposal; ${row?.notes ?? ""}` : row?.notes ?? "-"}</Text> },
    { key: "type", header: "Type", width: 190, sortable: true, cell: (e) => <Popover><PopoverTrigger render={<Button size="xs" variant="outline" aria-label={`${CASHFLOW_TYPES[e.meta.classification as CashflowType] ?? "Unclassified"}: change type of ${label(e)}`} disabled={!e.row || busy || !!e.meta.context || registry.metadata.some((m) => m.capitalizedFromTransactionId === e.meta.actualTransactionId)} />}>{CASHFLOW_TYPES[e.meta.classification as CashflowType] ?? "Unclassified"}</PopoverTrigger><PopoverContent className="w-72 p-3" align="start"><Select aria-label={`Classify ${e.row?.label}`} value={e.meta.classification ?? ""} options={[{ value: "", label: "Unclassified" }]} groups={typeGroups((t) => cashflowChoices(e.row?.amountMinor ?? 0).includes(t))} onValueChange={(value) => void run(() => save([changeFor(e.meta, value || null)]))} /></PopoverContent></Popover> },
    { key: "amount", header: "Amount", width: 120, align: "right", sortable: true, cell: ({ row }) => assetMoney(row?.amountMinor) },
    { key: "unlink", header: "Actions", width: 56, align: "right", cell: (e) => <Button size="icon-xs" variant="ghost" aria-label={`Unlink ${label(e)}`} title="Unlink metadata; keep the Actual transaction" disabled={busy} onClick={() => void run(() => save([changeFor(e.meta, e.meta.classification, true)]))}><Unlink className="size-3.5" /></Button> },
  ];
  const reasonOf = (row: PickedTransaction) => { const m = (registry.cashflows ?? []).find((c) => c.actualTransactionId === row.id); return m ? (m.assetId === asset.id ? "Already linked to this asset" : "Already linked to another asset") : null; };
  const selectedEntries = linked.filter((e) => selected.includes(e.meta.actualTransactionId));
  return <div className="flex min-h-0 flex-1 flex-col">
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-4 py-2"><InfoHint label="Income & Expenses">Money earned or spent from your other accounts that belongs to this asset (rent, repairs, interest). It never changes the asset&apos;s value; only the Account Transactions do.</InfoHint><SearchInput size="sm" className="w-48" aria-label="Search linked cashflows" value={search} onValueChange={setSearch} /><Select size="sm" className="w-52" aria-label="Cashflow type filter" value={filter} onValueChange={setFilter} options={[{ value: "", label: "All classifications" }]} groups={typeGroups(() => true)} />
      {focus && <span role="status" className="inline-flex h-7 items-center gap-1.5 rounded-md border bg-accent/40 px-2 text-xs">From the chart: {focus.label}<Button size="xs" variant="ghost" className="h-5 px-1.5" aria-label={`Clear filter ${focus.label}`} onClick={() => onClearFocus?.()}>Clear</Button></span>}<span className="ml-2 text-xs text-muted-foreground">From</span><DateInput size="sm" className="w-36" aria-label="From date" value={from} onValueChange={onFrom} /><span className="text-xs text-muted-foreground">To</span><DateInput size="sm" className="w-36" aria-label="To date" value={to} onValueChange={onTo} />
      <span role="status" className="ml-auto text-xs text-muted-foreground">{filtered.length} linked {filtered.length === 1 ? "row" : "rows"} · based on linked transactions</span><Button size="sm" variant="outline" onClick={() => setRulesOpen(true)}>Link rules{(registry.linkRules ?? []).filter((r) => r.assetId === asset.id).length ? ` (${(registry.linkRules ?? []).filter((r) => r.assetId === asset.id).length})` : ""}</Button><Button size="sm" variant="outline" disabled={financialBlocked} onClick={onCapitalize}>Add expense to asset value</Button><Button size="sm" onClick={() => setLinking(true)}><Plus className="size-3.5" />Link existing transactions</Button></div>
    {selected.length > 0 && <div role="region" aria-label="Selected linked cashflows" className="flex shrink-0 flex-wrap items-center gap-2 border-b bg-accent/40 px-4 py-1.5 text-xs"><strong className="text-xs">{selected.length} selected</strong><Select size="sm" className="w-64" aria-label="Bulk cashflow classification" value={bulkType} onValueChange={setBulkType} options={[{ value: "", label: "Unclassified" }]} groups={typeGroups((type) => selectedEntries.every((e) => cashflowChoices(e.row?.amountMinor ?? 0).includes(type)))} /><Button size="xs" variant="outline" disabled={busy} onClick={() => void run(() => save(selectedEntries.map((e) => changeFor(e.meta, bulkType || null))))}>Save classifications</Button><Button size="xs" variant="outline" disabled={busy} onClick={() => void run(() => save(selectedEntries.map((e) => changeFor(e.meta, e.meta.classification, true))))}>Unlink selected</Button><Button size="xs" variant="ghost" className="ml-auto" onClick={() => setSelected([])}>Clear selection</Button></div>}
    {error && <p role="alert" className="border-b p-3 text-sm text-destructive">{error}</p>}
    <DataTable label="Asset income and expenses" rows={filtered} columns={columns} rowKey={(e) => e.meta.actualTransactionId} rowLabel={(e) => `${label(e)}`} rowHeight={30} dense sort={sort} onSort={setSort} empty="No linked transactions in this period. Link existing income and expenses from Actual." />
    {rulesOpen && !applying && <LinkRulesDialog asset={asset} registry={registry} assetAccountIds={assetAccounts} onSaved={async (next) => { await onSaved(next); }} onApply={(rule) => { setLinkType(rule.classification ?? ""); setApplying(rule); }} onClose={() => setRulesOpen(false)} />}
    {(linking || applying) && <TransactionPickerDialog key={applying?.id ?? "manual"} title={applying ? `Apply rule: ${applying.name}` : "Link existing income & expenses"} description={applying ? "Every matching transaction not yet linked is chosen. Untick any you do not want, then link. Nothing in Actual changes." : undefined} autoSelect={!!applying} rowFilter={applying ? (row) => ruleMatches(applying, row) : undefined} confirmLabel="Link selected transactions" today={today} constraints={{ excludeAccountIds: assetAccounts, excludeTransfers: true, ...(applying ? { where: ruleWhere(applying) } : {}) }} disabledReason={reasonOf} onClose={() => { setLinking(false); setApplying(null); setLinkType(""); }}
      footerSlot={(picked) => <label className="flex items-center gap-2 text-xs">Link as<Select size="sm" className="w-56" aria-label="Link as" value={linkType} onValueChange={setLinkType} options={[{ value: "", label: "Unclassified" }]} groups={typeGroups((type) => picked.every((r) => cashflowChoices(r.amountMinor).includes(type)))} /></label>}
      onConfirm={async (rows) => { const before = await ensureExternal([...new Set(rows.map((r) => r.accountId))]); await save(rows.map((row) => ({ role: "cashflow" as const, actualTransactionId: row.id, actualAccountId: row.accountId, assetId: asset.id, classification: linkType || null, revision: (registry.cashflows ?? []).find((m) => m.actualTransactionId === row.id)?.revision ?? 0 })), before); setLinkType(""); }} />}
  </div>;
}
