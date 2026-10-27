"use client";
import { useState } from "react";
import { Plus, Unlink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { InfoHint } from "@/components/ui/info-hint";
import { SearchInput } from "@/components/ui/search-input";
import { TransactionPickerDialog } from "@/components/transactions/TransactionPickerDialog";
import { AmountChip, DateChip, FacetChip } from "@/components/transactions/filterChips";
import type { PickedTransaction } from "@/components/transactions/transactionPickerQuery";
import { DataTable, Text, type Column, type SortState } from "@/features/credit-cards/components/primitives/DataTable";
import { shortDate } from "@/features/credit-cards/components/primitives/format";
import { CASHFLOW_TYPES, type Asset, type CashflowMetadata, type Registry } from "@/lib/asset-registry/models";
import { sourceEvidence, type CashflowChange, type ExternalSnapshot } from "@/lib/asset-registry/cashflows";
import { capitalEvidence, type CapitalContext } from "@/lib/asset-registry/capitalActions";
import { ruleMatches, ruleWhere, type LinkRule } from "@/lib/asset-registry/linkRules";
import { LinkRulesDialog } from "./LinkRulesDialog";
import { ALL_TIME, inRange, isAllTime, type AssetRange } from "./dateRange";
import { emptyRowFilters, matchesAmount, matchesIds, optionsFrom, rowFiltersActive } from "./rowFilters";
import type { CashflowFocus } from "./TimelineSection";
import { registryRequest } from "./api";
import { assetMoney } from "./AssetPresentation";

/** Rows of the grouped table: group headers, the linked transactions, subtotals and the final result. */
type TableRow = { kind: "entry"; entry: { meta: CashflowMetadata; row: ExternalSnapshot["rows"][number] | undefined } } | { kind: "header" | "total"; key: string; label: string; detail?: string; amountMinor?: number };
type Group = "missing" | "income" | "expenses" | "sale";
const GROUP_LABEL: Record<Group, string> = { missing: "Not found in Actual", income: "Income", expenses: "Expenses", sale: "Sale proceeds & costs" };
const GROUPS: Group[] = ["missing", "income", "expenses", "sale"];
export function CashflowPanel({ asset, registry, external, today, categories = [], fresh, ensureExternal, onSaved, focus, onClearFocus, range, onRangeChange }: {
  /** The dates the table shows (the whole history by default); a chart click-through takes over until cleared. */ range: AssetRange; onRangeChange: (range: AssetRange) => void;
  /** A period (and type) chosen from a chart event; shown as a chip with Clear. */ focus?: CashflowFocus | null; onClearFocus?: () => void;
  asset: Asset; registry: Registry; external: ExternalSnapshot; today: string;
  /** Actual's categories: a linked row is income when its category is an income category (so a refund nets into it). */ categories?: { id: string; isIncome: boolean }[];
  fresh: (date: string, accountIds?: string[]) => Promise<CapitalContext>; /** Reads just these accounts (plus the linked ones) so picked rows can be validated. */ ensureExternal: (accountIds: string[]) => Promise<ExternalSnapshot>;
  onSaved: (registry?: Registry) => Promise<void>;
}) {
  const [filters, setFilters] = useState(emptyRowFilters);
  const [search, setSearch] = useState(""); const [selected, setSelected] = useState<string[]>([]); const [linking, setLinking] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false); const [applying, setApplying] = useState<LinkRule | null>(null);
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const [sort, setSort] = useState<SortState | null>({ key: "date", direction: "desc" });
  const assetAccounts = [...new Set(registry.assets.map((a) => a.actualAccountId))];
  const linked = (registry.cashflows ?? []).filter((m) => m.assetId === asset.id).map((meta) => ({ meta, row: external.rows.find((r) => r.id === meta.actualTransactionId && r.accountId === meta.actualAccountId) }));
  const categoryOf = (row: NonNullable<typeof linked[number]["row"]>) => row.categoryId ?? "uncategorized";
  const narrowed = rowFiltersActive(filters);
  const filtered = linked.filter(({ meta, row }) => (!row ? !narrowed : matchesIds(row.label, filters.payees) && matchesIds(categoryOf(row), filters.categories) && matchesIds(row.accountId, filters.accounts) && matchesAmount(row.amountMinor, filters.amount)) && (!row || (focus ? row.date >= focus.from && row.date <= focus.to : inRange(range, today, row.date)) || meta.context?.data.kind === "selling-cost") && (!focus?.type || meta.classification === focus.type) && `${row?.label ?? "missing"} ${row?.notes ?? ""} ${row?.categoryName ?? ""}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  const dir = sort?.direction === "asc" ? 1 : -1;
  type Entry = typeof linked[number];
  /** Income and expenses follow Actual's category type; a sale's own rows (proceeds, selling costs) are listed apart. */
  const groupOf = (e: Entry): Group => !e.row ? "missing" : e.meta.context || (e.meta.classification && Object.hasOwn(CASHFLOW_TYPES, e.meta.classification)) ? "sale" : (categories.find((c) => c.id === e.row!.categoryId)?.isIncome ?? e.row.amountMinor > 0) ? "income" : "expenses";
  const compare = (a: Entry, b: Entry) => {
    if (!a.row || !b.row) return 0;
    const key = sort?.key ?? "date";
    return dir * (key === "amount" ? a.row.amountMinor - b.row.amountMinor : key === "payee" ? a.row.label.localeCompare(b.row.label) : a.row.date.localeCompare(b.row.date));
  };
  const rows: TableRow[] = [];
  const subtotal: Partial<Record<Group, number>> = {};
  for (const group of GROUPS) {
    const members = filtered.filter((e) => groupOf(e) === group).sort(compare);
    if (!members.length) continue;
    // The subtotal sits on the group's own heading row, above its transactions.
    if (group !== "missing") subtotal[group] = members.reduce((sum, e) => sum + (e.row?.amountMinor ?? 0), 0);
    rows.push({ kind: "header", key: `h:${group}`, label: GROUP_LABEL[group], amountMinor: subtotal[group], detail: `${members.length} ${members.length === 1 ? "transaction" : "transactions"}${search || focus || narrowed || !isAllTime(range) ? " (filtered)" : ""}${group === "sale" ? " · not part of the operating result" : ""}` });
    rows.push(...members.map((entry): TableRow => ({ kind: "entry", entry })));
  }
  if (subtotal.income !== undefined || subtotal.expenses !== undefined) rows.push({ kind: "total", key: "total", label: "Operating result · income + expenses", amountMinor: (subtotal.income ?? 0) + (subtotal.expenses ?? 0) });
  async function save(changes: CashflowChange[], before: ExternalSnapshot = external) {
    const context = await fresh(today, [...new Set(changes.map((c) => c.actualAccountId))]);
    for (const change of changes.filter((c) => !c.remove)) {
      const was = before.rows.find((r) => r.id === change.actualTransactionId);
      const now = context.external.rows.find((r) => r.id === change.actualTransactionId);
      if (!was || !now || JSON.stringify(was) !== JSON.stringify(now)) throw new Error("Source changed. Refresh and review the link again.");
    }
    await onSaved(await registryRequest(asset.budgetSyncId, "PUT", { changes, sources: sourceEvidence(capitalEvidence(context)) }));
    setSelected([]);
  }
  const unlinkChange = (m: CashflowMetadata): CashflowChange => ({ role: "cashflow", actualTransactionId: m.actualTransactionId, actualAccountId: m.actualAccountId, assetId: asset.id, classification: m.classification, revision: m.revision, remove: true });
  async function run(action: () => Promise<void>) { setBusy(true); setError(""); try { await action(); } catch (e) { setError(e instanceof Error ? e.message : "Could not save links"); } finally { setBusy(false); } }
  const label = (e: Entry) => `${e.row?.label ?? "missing source"} ${e.row?.date ?? ""}`.trim();
  const onEntry = (render: (e: Entry) => React.ReactNode) => (r: TableRow) => r.kind === "entry" ? render(r.entry) : null;
  const columns: Column<TableRow>[] = [
    { key: "select", header: "Select", width: 34, headerIcon: <Checkbox aria-label="Select visible cashflows" checked={filtered.length > 0 && filtered.every((e) => selected.includes(e.meta.actualTransactionId))} onCheckedChange={(v) => setSelected(v ? filtered.map((e) => e.meta.actualTransactionId) : [])} />, cell: onEntry((e) => <Checkbox aria-label={`Select linked ${label(e)}`} checked={selected.includes(e.meta.actualTransactionId)} onCheckedChange={(v) => setSelected((c) => v ? [...c, e.meta.actualTransactionId] : c.filter((id) => id !== e.meta.actualTransactionId))} />) },
    { key: "date", header: "Actual date", width: 105, sortable: true, cell: (r) => r.kind === "header" ? <span className="font-semibold">{r.label}</span> : r.kind === "entry" ? (r.entry.row ? <Text title={r.entry.row.date}>{shortDate(r.entry.row.date, today)}</Text> : "Missing") : null },
    { key: "account", header: "Account", width: 215, cell: onEntry(({ meta }) => <Text>{external.accounts.find((a) => a.id === meta.actualAccountId)?.name ?? "Unavailable"}</Text>) },
    { key: "payee", header: "Payee", width: 230, sortable: true, cell: onEntry(({ row }) => <Text>{row?.label ?? "Missing / moved source"}</Text>) },
    { key: "category", header: "Actual category", width: 230, cell: onEntry(({ row }) => <Text>{row?.categoryName ?? "-"}</Text>) },
    { key: "notes", header: "Actual Notes", width: 180, grow: true, cell: (r) => r.kind === "entry" ? <Text title={r.entry.row?.notes ?? undefined}>{r.entry.meta.context?.data.kind === "selling-cost" ? `Selling cost · reported with the sale; ${r.entry.row?.notes ?? ""}` : r.entry.row?.notes ?? "-"}</Text> : r.kind === "header" ? <span className="text-muted-foreground">{r.detail}</span> : <span className="font-medium">{r.label}</span> },
    { key: "amount", header: "Amount", width: 130, align: "right", sortable: true, cell: (r) => r.kind === "entry" ? assetMoney(r.entry.row?.amountMinor) : r.amountMinor === undefined ? null : <span className="font-semibold tabular-nums">{assetMoney(r.amountMinor)}</span> },
    { key: "unlink", header: "Actions", width: 56, align: "right", cell: onEntry((e) => <Button size="icon-xs" variant="ghost" aria-label={`Unlink ${label(e)}`} title="Unlink metadata; keep the Actual transaction" disabled={busy} onClick={() => void run(() => save([unlinkChange(e.meta)]))}><Unlink className="size-3.5" /></Button>) },
  ];
  const reasonOf = (row: PickedTransaction) => { const m = (registry.cashflows ?? []).find((c) => c.actualTransactionId === row.id); return m ? (m.assetId === asset.id ? "Already linked to this asset" : "Already linked to another asset") : null; };
  // Only rows still shown can be unlinked, so a search, date range or chip applied after selecting never widens the action.
  const selectedEntries = filtered.filter((e) => selected.includes(e.meta.actualTransactionId));
  return <div className="flex min-h-0 flex-1 flex-col">
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-4 py-2"><InfoHint label="Income & Expenses">Money earned or spent from your other accounts that belongs to this asset (rent, repairs, interest). Whether a row is income or an expense follows its Actual category type (a refund nets into its income category); without a category, the amount sign decides. It never changes the asset&apos;s value; only the Asset Ledger does.</InfoHint><SearchInput size="sm" className="w-48" aria-label="Search linked income and expenses" value={search} onValueChange={setSearch} />
      {!focus && <DateChip value={range} onChange={onRangeChange} />}
      <AmountChip value={filters.amount} onChange={(amount) => setFilters((f) => ({ ...f, amount }))} />
      <FacetChip name="Payee" plural="payees" options={optionsFrom(linked.flatMap(({ row }): [string, string][] => row ? [[row.label, row.label]] : []))} value={filters.payees} onChange={(payees) => setFilters((f) => ({ ...f, payees }))} onReset={() => setFilters((f) => ({ ...f, payees: { ids: [], not: false } }))} nameOf={(id) => id} />
      <FacetChip name="Category" plural="categories" options={optionsFrom(linked.flatMap(({ row }): [string, string][] => row ? [[categoryOf(row), row.categoryName ?? "Uncategorized"]] : []))} value={filters.categories} onChange={(categories) => setFilters((f) => ({ ...f, categories }))} onReset={() => setFilters((f) => ({ ...f, categories: { ids: [], not: false } }))} nameOf={(id) => linked.find(({ row }) => row && categoryOf(row) === id)?.row?.categoryName ?? "Uncategorized"} />
      <FacetChip name="Account" plural="accounts" options={optionsFrom(linked.flatMap(({ meta }): [string, string][] => [[meta.actualAccountId, external.accounts.find((a) => a.id === meta.actualAccountId)?.name ?? "Unavailable"]]))} value={filters.accounts} onChange={(accounts) => setFilters((f) => ({ ...f, accounts }))} onReset={() => setFilters((f) => ({ ...f, accounts: { ids: [], not: false } }))} nameOf={(id) => external.accounts.find((a) => a.id === id)?.name ?? "Unavailable"} />
      {(narrowed || search || !isAllTime(range)) && <Button size="sm" variant="ghost" onClick={() => { setFilters(emptyRowFilters()); setSearch(""); onRangeChange(ALL_TIME); }}>Clear filters</Button>}
      {focus && <span role="status" className="inline-flex h-7 items-center gap-1.5 rounded-md border bg-accent/40 px-2 text-xs">From the chart: {focus.label}<Button size="xs" variant="ghost" className="h-5 px-1.5" aria-label={`Clear filter ${focus.label}`} onClick={() => onClearFocus?.()}>Clear</Button></span>}
      <span role="status" className="ml-auto text-xs text-muted-foreground">{filtered.length} linked {filtered.length === 1 ? "row" : "rows"}</span><Button size="sm" variant="outline" onClick={() => setRulesOpen(true)}>Link rules{(registry.linkRules ?? []).filter((r) => r.assetId === asset.id).length ? ` (${(registry.linkRules ?? []).filter((r) => r.assetId === asset.id).length})` : ""}</Button><Button size="sm" onClick={() => setLinking(true)}><Plus className="size-3.5" />Link existing transactions</Button></div>
    {selectedEntries.length > 0 && <div role="region" aria-label="Selected linked cashflows" className="flex shrink-0 flex-wrap items-center gap-2 border-b bg-accent/40 px-4 py-1.5 text-xs"><strong className="text-xs">{selectedEntries.length} selected</strong><Button size="xs" variant="outline" disabled={busy} onClick={() => void run(() => save(selectedEntries.map((e) => unlinkChange(e.meta))))}>Unlink selected</Button><Button size="xs" variant="ghost" className="ml-auto" onClick={() => setSelected([])}>Clear selection</Button></div>}
    {error && <p role="alert" className="border-b p-3 text-sm text-destructive">{error}</p>}
    <DataTable label="Asset income and expenses" rows={rows} columns={columns} rowKey={(r) => r.kind === "entry" ? r.entry.meta.actualTransactionId : r.key} rowLabel={(r) => r.kind === "entry" ? label(r.entry) : r.label} rowClassName={(r) => r.kind === "header" ? "bg-muted/40" : r.kind === "total" ? "border-t-2 bg-muted/40" : undefined} rowHeight={30} dense sort={sort} onSort={setSort} empty="Nothing is linked yet. Link existing income and expenses from Actual." />
    {rulesOpen && !applying && <LinkRulesDialog asset={asset} registry={registry} assetAccountIds={assetAccounts} onSaved={async (next) => { await onSaved(next); }} onApply={(rule) => setApplying(rule)} onClose={() => setRulesOpen(false)} />}
    {(linking || applying) && <TransactionPickerDialog key={applying?.id ?? "manual"} title={applying ? `Apply rule: ${applying.name}` : "Link existing income & expenses"} description={applying ? "Every matching transaction not yet linked is chosen. Untick any you do not want, then link. Nothing in Actual changes." : undefined} autoSelect={!!applying} rowFilter={applying ? (row) => ruleMatches(applying, row) : undefined} confirmLabel="Link selected transactions" today={today} constraints={{ excludeAccountIds: assetAccounts, excludeTransfers: true, ...(applying ? { where: ruleWhere(applying) } : {}) }} disabledReason={reasonOf} lockedLabels={{ accounts: "Asset accounts excluded", ...(applying ? { where: `Rule: ${applying.name}` } : {}) }} onClose={() => { setLinking(false); setApplying(null); }}
      onConfirm={async (rows) => { const before = await ensureExternal([...new Set(rows.map((r) => r.accountId))]); await save(rows.map((row) => ({ role: "cashflow" as const, actualTransactionId: row.id, actualAccountId: row.accountId, assetId: asset.id, classification: null, revision: (registry.cashflows ?? []).find((m) => m.actualTransactionId === row.id)?.revision ?? 0 })), before); }} />}
  </div>;
}
