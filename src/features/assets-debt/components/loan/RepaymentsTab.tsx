"use client";

import { useMemo, useRef, useState } from "react";
import { Landmark, MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { InfoHint } from "@/components/ui/info-hint";
import { PillGroup } from "@/components/ui/pill-group";
import { SearchInput } from "@/components/ui/search-input";
import { DateChip } from "@/components/transactions/filterChips";
import { DataTable, Text, type Column, type SortState } from "@/features/credit-cards/components/primitives/DataTable";
import { EmptyState, SummaryStrip } from "@/features/asset-registry/AssetPresentation";
import { ALL_TIME, inRange, type AssetRange } from "@/features/asset-registry/dateRange";
import type { AccountDirectory } from "@/lib/assets-debt/actual/ledgerPort";
import type { Installment, InstallmentStatus, LedgerRow } from "@/lib/assets-debt/tracking/plan";
import type { Proposal } from "@/lib/assets-debt/tracking/proposals";
import { cn } from "@/lib/utils";
import { formatAmount } from "../../lib/money";
import type { LoanTracking } from "../../lib/useLoanTracking";
import { ENTRY_LABELS, StatusBadge, dt } from "./presentation";
import { InstallmentInspector, type InspectorActions } from "./InstallmentInspector";
import type { WriteOutcome } from "../../lib/trackingWrites";
import type { DebtWrite } from "@/lib/app-db/debtTrackingRepository";

/**
 * Repayments (design spec 06 §7.2): one row per installment from the tracking start, edge to edge, with the opening
 * adjustment, the ledger's extra principal, draws and fees in the same timeline, and one summary row for the
 * installments before tracking. Apply is on the row; details and edits open in a docked panel beside the table.
 */

type Row =
  | { key: string; kind: "installment"; date: string; inst: Installment }
  | { key: string; kind: "event"; date: string; ledger: LedgerRow }
  | { key: string; kind: "opening"; date: string; proposal: Proposal; amountMinor: number }
  | { key: string; kind: "before"; date: string; count: number; first: string | null; last: string | null; openingMinor: number };

type Filter = "all" | "todo" | "recorded" | "missing";
const TODO: ReadonlySet<InstallmentStatus> = new Set(["unrecorded", "check", "missing"]);

export type RunState = { done: number; total: number } | null;

export function RepaymentsTab({ tracking, directory, digits, onLinkToActual, onPaymentRules, apply, run, outcomes, onDismissOutcomes, actions, writesLocked, unresolved = [], onResolve }: {
  tracking: LoanTracking; directory: AccountDirectory | undefined; digits: number;
  onLinkToActual: () => void; onPaymentRules: () => void;
  /** Apply these writes, in order, as one run. */ apply: (proposals: Proposal[]) => void;
  run: RunState; outcomes: { list: WriteOutcome[]; clearingProblem: string | null } | null; onDismissOutcomes: () => void;
  actions: InspectorActions;
  /** A write ended uncertain: nothing more until someone checked Actual. */ writesLocked: boolean;
  unresolved?: DebtWrite[]; onResolve?: (writeId: string, inActual: boolean) => void;
}) {
  const money = (minor: number) => formatAmount(minor, digits);
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [range, setRange] = useState<AssetRange>(ALL_TIME);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [active, setActive] = useState<string | null>(null);
  const [sort, setSort] = useState<SortState | null>({ key: "date", direction: "desc" });
  const tableRef = useRef<HTMLDivElement>(null);
  const result = tracking.result?.ok ? tracking.result : null;
  const accountName = (id: string) => directory?.accounts.find((a) => a.id === id)?.name ?? "-";
  const busy = run !== null;

  const rows = useMemo((): Row[] => {
    if (!result) return [];
    const out: Row[] = result.installments.map((inst) => ({ key: `i:${inst.no}`, kind: "installment" as const, date: inst.payment?.date ?? inst.dueDate, inst }));
    const eventIds = new Set(result.events.map((e) => e.rowId));
    for (const l of result.ledger) if (eventIds.has(l.row.id)) out.push({ key: `e:${l.row.id}`, kind: "event", date: l.row.date, ledger: l });
    if (result.openingAdjustment?.output.kind === "create") {
      const op = result.openingAdjustment.output.operations[0];
      out.push({ key: "opening", kind: "opening", date: op.date, proposal: result.openingAdjustment, amountMinor: op.amountMinor });
    }
    return out;
  }, [result]);

  const needle = search.trim().toLowerCase();
  const visible = rows.filter((r) => {
    if (!inRange(range, tracking.today, r.date)) return false;
    if (filter === "todo" && !(r.kind === "opening" || (r.kind === "installment" && TODO.has(r.inst.status)))) return false;
    if (filter === "recorded" && !(r.kind === "installment" && r.inst.status === "recorded")) return false;
    if (filter === "missing" && !(r.kind === "installment" && r.inst.status === "missing")) return false;
    if (!needle) return true;
    const text = r.kind === "installment" ? `${r.inst.no} ${r.inst.payment?.row.payeeName ?? ""} ${r.inst.payment?.row.notes ?? ""} ${r.inst.note ?? ""}` : r.kind === "event" ? `${r.ledger.row.payeeName ?? ""} ${r.ledger.row.notes ?? ""} ${ENTRY_LABELS[r.ledger.type]}` : "opening adjustment";
    return text.toLowerCase().includes(needle);
  });
  const dir = sort?.direction === "asc" ? 1 : -1;
  const sorted = [...visible].sort((a, b) => dir * (a.date.localeCompare(b.date) || (a.kind === "installment" && b.kind === "installment" ? a.inst.no - b.inst.no : 0)));
  const all: Row[] = result && result.before.count > 0 && filter === "all" && !needle
    ? [...sorted, { key: "before", kind: "before", date: "", count: result.before.count, first: result.before.firstDueDate, last: result.before.lastDueDate, openingMinor: result.opening.principalMinor }]
    : sorted;

  const proposalOf = (r: Row): Proposal | null => (r.kind === "installment" ? (r.inst.status === "unrecorded" ? r.inst.proposal : null) : r.kind === "opening" ? r.proposal : null);
  const applicable = all.filter((r) => proposalOf(r));
  const chosen = applicable.filter((r) => selected.has(r.key));
  /** Writes run oldest first: each month's split builds on the ones before. */
  const inOrder = (list: Row[]) => [...list].sort((a, b) => a.date.localeCompare(b.date)).map(proposalOf).filter((p): p is Proposal => !!p);
  const toggle = (key: string) => setSelected((s) => { const next = new Set(s); if (next.has(key)) next.delete(key); else next.add(key); return next; });

  if (!tracking.tracked) {
    return <EmptyState icon={Landmark} title="Not tracked in Actual yet" action={<Button size="sm" onClick={onLinkToActual}>Link to Actual</Button>}>Choose the loan account and where tracking starts. Bench then lists each installment with what it would record in Actual.</EmptyState>;
  }
  if (tracking.error && !tracking.result) return <p role="alert" className="m-4 text-sm text-destructive">{tracking.error}</p>;
  if (tracking.loading || !tracking.result) return <p role="status" className="p-4 text-sm text-muted-foreground">Reading the loan account in Actual…</p>;
  if (!tracking.result.ok) return <p role="alert" className="m-4 rounded-md border border-destructive/40 px-3 py-2 text-sm">{tracking.result.message}</p>;
  const f = tracking.result.figures;
  const activeRow = all.find((r) => r.key === active) ?? null;
  const todo = f.counts.unrecorded + (result?.openingAdjustment ? 1 : 0);

  const columns: Column<Row>[] = [
    { key: "select", header: "Select", width: 34, align: "center", headerIcon: <Checkbox aria-label="Select every row that can be applied" checked={applicable.length > 0 && applicable.every((r) => selected.has(r.key))} indeterminate={chosen.length > 0 && chosen.length < applicable.length} onCheckedChange={(on) => setSelected(on ? new Set(applicable.map((r) => r.key)) : new Set())} disabled={busy || writesLocked} />,
      cell: (r) => proposalOf(r) ? <Checkbox aria-label={`Select ${rowName(r)}`} checked={selected.has(r.key)} onCheckedChange={() => toggle(r.key)} disabled={busy || writesLocked} /> : null },
    { key: "no", header: "No.", width: 52, align: "right", cell: (r) => r.kind === "installment" ? <span className="tabular-nums">{r.inst.no}</span> : r.kind === "before" ? <span className="tabular-nums text-muted-foreground">1–{r.count}</span> : null },
    { key: "date", header: "Due", width: 104, sortable: true, cell: (r) => r.kind === "installment" ? <Text>{dt(r.inst.dueDate)}</Text> : r.kind === "before" ? <Text className="text-muted-foreground italic">{r.first ? `${dt(r.first)} to ${dt(r.last ?? r.first)}` : ""}</Text> : <span className="text-muted-foreground">-</span> },
    { key: "paid", header: "Paid", width: 104, cell: (r) => <Text>{r.kind === "installment" ? (r.inst.payment ? dt(r.inst.payment.date) : "-") : r.kind === "event" ? dt(r.ledger.row.date) : r.kind === "opening" ? dt(r.date) : ""}</Text> },
    { key: "from", header: "From", width: 128, cell: (r) => <Text>{r.kind === "installment" ? (r.inst.payment ? accountName(r.inst.payment.row.accountId) : "-") : r.kind === "event" ? (r.ledger.row.transferId ? r.ledger.row.payeeName ?? "-" : "-") : ""}</Text> },
    { key: "payee", header: "Payee", width: 150, cell: (r) => <Text>{r.kind === "installment" ? (r.inst.payment ? (r.inst.payment.kind === "rule" ? r.inst.payment.row.payeeName ?? "-" : "Transfer") : "-") : r.kind === "event" ? (r.ledger.row.transferId ? "Transfer" : r.ledger.row.payeeName ?? "-") : r.kind === "opening" ? "Loan adjustment" : r.kind === "before" ? <span className="text-muted-foreground italic">Before tracking · assumed paid as contracted</span> : ""}</Text> },
    { key: "payment", header: "Payment", width: 112, align: "right", cell: (r) => <span className="tabular-nums">{r.kind === "installment" ? (r.inst.payment ? money(r.inst.payment.amountMinor) : r.inst.status === "upcoming" ? money(r.inst.scheduledMinor) : "-") : r.kind === "event" ? money(Math.abs(r.ledger.row.amount)) : r.kind === "opening" ? money(Math.abs(r.amountMinor)) : ""}</span> },
    { key: "principal", header: "Principal", width: 112, align: "right", cell: (r) => <span className="tabular-nums">{r.kind === "installment" ? (r.inst.status === "missing" ? "-" : money(r.inst.principalMinor)) : r.kind === "event" && r.ledger.type === "extra-principal" ? money(r.ledger.row.amount) : "-"}</span> },
    { key: "interest", header: "Interest", width: 112, align: "right", cell: (r) => r.kind === "installment" && r.inst.status !== "missing" ? <span className="inline-flex items-center gap-1 tabular-nums">{money(r.inst.interestMinor)}{r.inst.interestMinor !== r.inst.calculatedInterestMinor ? <InfoHint label={`Calculated interest ${money(r.inst.calculatedInterestMinor)}`}>Actual holds {money(r.inst.interestMinor)}; Bench calculates {money(r.inst.calculatedInterestMinor)} ({money(r.inst.interestMinor - r.inst.calculatedInterestMinor)}). Within the tolerance this is information only.</InfoHint> : null}</span> : <span className="text-muted-foreground">-</span> },
    { key: "balance", header: "Balance after", width: 124, align: "right", cell: (r) => <span className="tabular-nums">{r.kind === "installment" ? money(r.inst.balanceAfterMinor) : r.kind === "before" ? money(r.openingMinor) : "-"}</span> },
    { key: "notes", header: "Notes", width: 160, grow: true, cell: (r) => <Text className="text-foreground/70" title={notesOf(r) ?? undefined}>{notesOf(r) ?? ""}</Text> },
    { key: "status", header: "Status", width: 132, cell: (r) => r.kind === "installment" ? <StatusBadge status={r.inst.status} /> : r.kind === "opening" ? <StatusBadge status="unrecorded" /> : r.kind === "event" ? <span className={cn("rounded border px-1.5 py-0.5 text-[11px]", r.ledger.suggested ? "border-dashed text-foreground/70" : "bg-muted/30")} title={r.ledger.suggested ? "Suggested from Actual" : undefined}>{ENTRY_LABELS[r.ledger.type]}</span> : null },
    { key: "actions", header: "Actions", hiddenHeader: true, width: 150, align: "right", sticky: "end", cell: (r) => {
      const proposal = proposalOf(r);
      return <div className="flex items-center justify-end gap-1">
        {proposal ? <Button size="xs" disabled={busy || writesLocked} onClick={(e) => { e.stopPropagation(); apply([proposal]); }}>Apply</Button> : null}
        {r.kind === "installment" && r.inst.status === "check" ? <Button size="xs" variant="outline" onClick={() => setActive(r.key)}>Review</Button> : null}
        {r.kind === "installment" && r.inst.status === "missing" ? <Button size="xs" variant="outline" onClick={() => setActive(r.key)}>Choose payment</Button> : null}
        {r.kind !== "before" ? <DropdownMenu><DropdownMenuTrigger render={<Button size="icon-xs" variant="ghost" aria-label={`More for ${rowName(r)}`} />}><MoreHorizontal className="size-3.5" /></DropdownMenuTrigger>
          <DropdownMenuContent align="end"><DropdownMenuItem onClick={() => setActive(r.key)}>Details</DropdownMenuItem>
            {r.kind === "installment" && r.inst.payment ? <DropdownMenuItem onClick={() => actions.notThisPayment(r.inst)}>Not this payment</DropdownMenuItem> : null}
          </DropdownMenuContent></DropdownMenu> : null}
      </div>;
    } },
  ];

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      <div className="flex min-w-0 flex-1 flex-col">
        <SummaryStrip label="Repayments summary" items={[
          { label: "Owed in Actual", value: money(f.owedInActualMinor), detail: tracking.reads?.complete === false ? "The loan account didn't read completely: refresh" : "Loan account today", wrap: true },
          { label: "Calculated", value: money(f.calculatedMinor), detail: Math.abs(f.differenceMinor) <= (tracking.debt?.toleranceMinor ?? 100) ? "Agrees with Actual" : `Differs by ${money(Math.abs(f.differenceMinor))}${todo ? ` · ${todo} to apply` : ""}`, wrap: true },
          { label: "Next payment", value: f.nextPayment ? money(f.nextPayment.amountMinor) : "-", detail: f.nextPayment ? `Due ${dt(f.nextPayment.dueDate)} · installment ${f.nextPayment.no}` : "No more installments", wrap: true },
          { label: "To do", value: <span className={todo + f.counts.check + f.counts.missing ? "text-amber-700 dark:text-amber-400" : undefined}>{todo} <span className="text-sm font-medium text-muted-foreground">Unrecorded</span></span>, detail: `${f.counts.check} Check · ${f.counts.missing} Missing`, wrap: true },
          { label: "Interest this year", value: money(f.interestThisYearMinor), detail: "Recorded and unrecorded installments", wrap: true },
        ]} />
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-4 py-2">
          <SearchInput size="sm" aria-label="Search repayments" className="w-48" value={search} onValueChange={setSearch} />
          <DateChip value={range} onChange={setRange} />
          <PillGroup<Filter> value={filter} onChange={(v) => { setFilter(v); setSelected(new Set()); }} options={[
            { value: "all", label: "All", count: rows.length }, { value: "todo", label: "To do", count: rows.filter((r) => r.kind === "opening" || (r.kind === "installment" && TODO.has(r.inst.status))).length },
            { value: "recorded", label: "Recorded", count: f.counts.recorded }, { value: "missing", label: "Missing", count: f.counts.missing },
          ]} />
          <Button size="sm" variant="ghost" onClick={onPaymentRules}>Payment rules{tracking.bundle?.rules.length ? ` (${tracking.bundle.rules.length})` : ""}</Button>
          <span className="ml-auto" />
          {tracking.refreshing ? <span role="status" className="text-xs text-muted-foreground">Refreshing…</span> : null}
          <Button size="sm" disabled={!applicable.length || busy || writesLocked} onClick={() => apply(inOrder(applicable))}>Apply all Unrecorded ({applicable.length})</Button>
        </div>
        {chosen.length > 0 && !busy ? <div role="region" aria-label="Selected repayments" className="flex shrink-0 items-center gap-2 border-b bg-accent/40 px-4 py-1.5 text-xs"><strong>{chosen.length} selected</strong><span className="text-muted-foreground">Unrecorded rows only</span><Button size="xs" disabled={writesLocked} onClick={() => apply(inOrder(chosen))}>Apply {chosen.length}</Button><Button size="xs" variant="ghost" className="ml-auto" onClick={() => setSelected(new Set())}>Clear selection</Button></div> : null}
        {run ? <div role="status" className="flex shrink-0 items-center gap-2 border-b bg-accent/40 px-4 py-1.5 text-xs">Applying {Math.min(run.done + 1, run.total)} of {run.total}…</div> : null}
        {outcomes ? <Outcomes outcomes={outcomes} onDismiss={onDismissOutcomes} counts={f.counts} agrees={Math.abs(f.differenceMinor) <= (tracking.debt?.toleranceMinor ?? 100)} /> : null}
        {unresolved.map((w) => (
          <div key={w.id} role="alert" className="flex shrink-0 flex-wrap items-center gap-2 border-b bg-destructive/5 px-4 py-2 text-xs">
            <span className="text-destructive">A write to Actual {w.status === "applying" ? "was left unfinished" : "ended with an unknown outcome"}{w.installmentDueDate ? ` (installment due ${dt(w.installmentDueDate)})` : ""}. Nothing else is written until you check the payment in Actual.</span>
            <span className="ml-auto" />
            <Button size="xs" variant="outline" onClick={() => onResolve?.(w.id, true)}>The change is in Actual</Button>
            <Button size="xs" variant="outline" onClick={() => onResolve?.(w.id, false)}>It isn&apos;t</Button>
          </div>
        ))}
        <div ref={tableRef} className="flex min-h-0 flex-1 flex-col">
          <DataTable label="Repayments" columns={activeRow ? columns.filter((c) => c.key !== "notes") : columns} rows={all} rowKey={(r) => r.key} rowLabel={rowName} activeKey={active} onOpen={(r) => r.kind !== "before" && setActive(r.key)} sort={sort} onSort={setSort} dense
            rowClassName={(r) => cn(r.kind === "installment" && r.inst.status === "upcoming" && "text-muted-foreground", r.kind === "before" && "bg-muted/40", selected.has(r.key) && "bg-accent/40")}
            onRowKeys={(e, r) => {
              if (e.key === " " && proposalOf(r)) { toggle(r.key); return true; }
              if (e.key.toLowerCase() === "a" && !e.ctrlKey && !e.metaKey && !e.altKey) { const p = proposalOf(r); if (p && !busy && !writesLocked) { apply([p]); return true; } }
              return false;
            }}
            empty={rows.length ? "No repayments match your filters." : "No installments are due yet."} />
        </div>
      </div>
      {activeRow && activeRow.kind !== "before" ? <InstallmentInspector key={activeRow.key} row={activeRow.kind === "installment" ? { kind: "installment", inst: activeRow.inst } : activeRow.kind === "event" ? { kind: "event", ledger: activeRow.ledger } : { kind: "opening", proposal: activeRow.proposal, amountMinor: activeRow.amountMinor, date: activeRow.date }}
        tracking={tracking} directory={directory} digits={digits} busy={busy} writesLocked={writesLocked} onApply={(p) => apply([p])} actions={actions} onClose={() => setActive(null)} /> : null}
    </div>
  );
}

function rowName(r: Row): string {
  switch (r.kind) {
    case "installment": return `Installment ${r.inst.no} due ${r.inst.dueDate}`;
    case "event": return `${ENTRY_LABELS[r.ledger.type]} on ${r.ledger.row.date}`;
    case "opening": return "Opening adjustment";
    case "before": return `Installments 1 to ${r.count}, before tracking`;
  }
}

function notesOf(r: Row): string | null {
  if (r.kind === "installment") return r.inst.note ?? r.inst.payment?.row.notes ?? null;
  if (r.kind === "event") return r.ledger.row.notes;
  if (r.kind === "opening") return "Opening adjustment: Actual's loan account differs from the opening position";
  return null;
}

function Outcomes({ outcomes, onDismiss, counts, agrees }: { outcomes: { list: WriteOutcome[]; clearingProblem: string | null }; onDismiss: () => void; counts: Record<InstallmentStatus, number>; agrees: boolean }) {
  const applied = outcomes.list.filter((o) => o.status === "applied").length;
  const failed = outcomes.list.filter((o) => o.status === "failed");
  const uncertain = outcomes.list.filter((o) => o.status === "uncertain");
  const skipped = outcomes.list.filter((o) => o.status === "not-started").length;
  const problem = failed.length + uncertain.length > 0;
  return (
    <div role="status" className={cn("flex shrink-0 flex-col gap-1 border-b px-4 py-2 text-xs", problem ? "bg-destructive/5" : "bg-emerald-500/5")}>
      <div className="flex items-center gap-2">
        <strong>{applied} written to Actual</strong>
        {failed.length ? <span className="text-destructive">· {failed.length} failed</span> : null}
        {uncertain.length ? <span className="text-destructive">· {uncertain.length} uncertain</span> : null}
        {skipped ? <span className="text-muted-foreground">· {skipped} not started</span> : null}
        {!problem ? <span className="text-muted-foreground">· {agrees ? "Owed in Actual now matches Calculated" : `${counts.unrecorded} still unrecorded`}</span> : null}
        <Button size="xs" variant="ghost" className="ml-auto" onClick={onDismiss}>Dismiss</Button>
      </div>
      {[...failed, ...uncertain].map((o, i) => <p key={i} className="text-destructive">{o.proposal.dueDate ? `Installment due ${dt(o.proposal.dueDate)}` : "Opening adjustment"}: {o.message ?? "did not apply"}{o.status === "uncertain" ? " It may have been written: check Actual, then Refresh." : " Nothing was written."}</p>)}
      {outcomes.clearingProblem ? <p className="text-amber-700 dark:text-amber-400">{outcomes.clearingProblem}</p> : null}
    </div>
  );
}
