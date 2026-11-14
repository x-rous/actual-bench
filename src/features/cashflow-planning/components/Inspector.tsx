"use client";

import { useMemo, type ReactNode } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowDown, ArrowUp, ListTree, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MultiSearchableCombobox, type ComboboxOption } from "@/components/ui/combobox";
import { Label } from "@/components/ui/label";
import { PillGroup } from "@/components/ui/pill-group";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { generateId } from "@/lib/uuid";
import { accountBalances, accountRole, contributionsOf, unplannedTarget, type Contribution, type Placed, type Snapshot } from "@/lib/cashflow-planning/actuals";
import { NAME_MAX, NOTES_MAX, addGroup, addRow, createRow, moveGroup, moveRow, placeRow, planEndMonth, removeGroup, removeRow, renameGroup, setCells, updateRow } from "@/lib/cashflow-planning/document";
import type { CellSource, Computed } from "@/lib/cashflow-planning/engine";
import { addMonths, monthLabel, monthRange } from "@/lib/cashflow-planning/months";
import { AVERAGE_WINDOWS, SECTIONS, SECTION_LABEL, type AverageWindow, type Basis, type BasisKind, type Month, type PlanDocument, type PlanRow, type RepeatRule, type SectionId } from "@/lib/cashflow-planning/types";
import { money } from "@/features/financial-insights/format";
import { aggregate, type Column, type Line } from "../lib/view";
import { AmountField, MonthField, PercentField, TextField } from "./fields";

export type TransactionsRequest = { title: string; months: Month[]; items: Pick<Contribution, "kind" | "id">[]; /** Natural-sign multiplier for display. */ sign: 1 | -1 };

type Props = {
  doc: PlanDocument;
  computed: Computed;
  snapshot: Snapshot | null;
  placed: Placed | null;
  line: Line | null;
  column: Column | null;
  problems: ReadonlyMap<string, string>;
  onEdit: (change: (doc: PlanDocument) => PlanDocument) => void;
  /** Selects a line of the grid by key (after creating a row, for example). */
  onSelectLine: (key: string | null) => void;
  onShowTransactions: (request: TransactionsRequest) => void;
  onClose: () => void;
  overview: ReactNode;
};

const SOURCE_LABEL: Record<CellSource, string> = {
  actual: "Recorded in Actual", cell: "Typed amount", rule: "Repeating amount", average: "Average of recent months", budget: "Actual's budget", schedule: "Actual schedules", loan: "Loan schedule", none: "Nothing planned",
};

const BASIS_LABEL: Record<BasisKind, string> = {
  manual: "Repeating amounts and typed cells", average: "Average of recent months", budget: "Actual's budget", schedule: "Actual schedules", loan: "Loan schedule (from Loans)",
};

const EVERY_OPTIONS = [{ value: "1", label: "Every month" }, { value: "2", label: "Every 2 months" }, { value: "3", label: "Every 3 months" }, { value: "6", label: "Every 6 months" }, { value: "12", label: "Every year" }, { value: "24", label: "Every 2 years" }];

export function Inspector(props: Props) {
  const { line, column, onClose } = props;
  const title = !line ? "Plan overview" : line.kind === "row" ? line.row.name : line.kind === "group" ? line.group.name : line.label;
  return (
    <aside aria-label="Details" className="flex w-[400px] shrink-0 flex-col border-l border-border bg-background">
      <header className="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-border px-3">
        <h2 className="min-w-0 truncate text-sm font-semibold" title={title}>{title}</h2>
        <Button size="icon-xs" variant="ghost" onClick={onClose} aria-label="Close details"><X className="size-3.5" aria-hidden /></Button>
      </header>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3 text-xs">
        {!line ? props.overview
          : line.kind === "row" ? <RowPanel {...props} row={line.row} column={column} />
          : line.kind === "unplanned" ? <UnplannedPanel {...props} section={line.section} column={column} />
          : line.kind === "group" ? <GroupPanel {...props} groupId={line.group.id} />
          : line.kind === "section" ? <SectionPanel {...props} section={line.section} />
          : line.kind === "balance" ? <BalancePanel {...props} which={line.key} column={column} />
          : <MemoPanel line={line} column={column} />}
      </div>
    </aside>
  );
}

function Block({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-2"><h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>{action}</div>
      {children}
    </section>
  );
}

const Fact = ({ label, children, strong }: { label: string; children: ReactNode; strong?: boolean }) => (
  <div className="flex items-baseline justify-between gap-3"><span className="text-muted-foreground">{label}</span><span className={strong ? "font-semibold tabular-nums" : "tabular-nums"}>{children}</span></div>
);

/** The months a column stands for. */
const monthsOf = (column: Column | null, computed: Computed): Month[] => (!column ? [] : column.kind === "month" ? [column.month] : column.indexes.map((i) => computed.months[i]));
const columnLabel = (column: Column) => (column.kind === "month" ? monthLabel(column.month) : `${column.year}`);

// ─── A row ───────────────────────────────────────────────────────────────────

function RowPanel({ doc, computed, snapshot, placed, row, column, problems, onEdit, onSelectLine, onShowTransactions }: Props & { row: PlanRow }) {
  const result = computed.rows.get(row.id)!;
  const edit = (change: (row: PlanRow) => PlanRow) => onEdit((d) => updateRow(d, row.id, change));
  const groups = doc.groups.filter((g) => g.section === row.section);
  const problem = problems.get(row.id);
  return (
    <>
      {problem && <p role="status" className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-50 p-2 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />{problem}</p>}
      {column && <CellBlock doc={doc} computed={computed} snapshot={snapshot} placed={placed} row={row} column={column} onEdit={onEdit} onShowTransactions={onShowTransactions} />}

      <Block title="Row">
        <div className="space-y-1"><Label htmlFor="cf-row-name" className="text-xs">Name</Label><TextField id="cf-row-name" value={row.name} maxLength={NAME_MAX} onCommit={(name) => edit((r) => ({ ...r, name }))} /></div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1"><Label htmlFor="cf-row-section" className="text-xs">Section</Label><Select id="cf-row-section" size="sm" className="w-full" value={row.section} onValueChange={(v) => onEdit((d) => placeRow(d, row.id, v as SectionId, null))} options={SECTIONS.map((s) => ({ value: s, label: SECTION_LABEL[s] }))} /></div>
          <div className="space-y-1"><Label htmlFor="cf-row-group" className="text-xs">Group</Label><Select id="cf-row-group" size="sm" className="w-full" value={row.groupId ?? "none"} onValueChange={(v) => onEdit((d) => placeRow(d, row.id, row.section, v === "none" ? null : v))} options={[{ value: "none", label: "No group" }, ...groups.map((g) => ({ value: g.id, label: g.name }))]} /></div>
        </div>
        <div className="flex items-center gap-1">
          <Button size="xs" variant="outline" onClick={() => onEdit((d) => moveRow(d, row.id, -1))}><ArrowUp className="size-3" aria-hidden />Up</Button>
          <Button size="xs" variant="outline" onClick={() => onEdit((d) => moveRow(d, row.id, 1))}><ArrowDown className="size-3" aria-hidden />Down</Button>
          <Button size="xs" variant="ghost" className="ml-auto text-destructive hover:text-destructive" onClick={() => { onEdit((d) => removeRow(d, row.id)); onSelectLine(null); }}><Trash2 className="size-3" aria-hidden />Delete row</Button>
        </div>
      </Block>

      {doc.useActuals && snapshot && <LinksBlock doc={doc} snapshot={snapshot} row={row} edit={edit} />}
      <BasisBlock doc={doc} snapshot={snapshot} row={row} typical={result.typical} problem={result.problem} edit={edit} />

      <Block title="Notes">
        <Textarea aria-label="Notes" key={row.id} defaultValue={row.notes ?? ""} maxLength={NOTES_MAX} rows={3} className="text-xs" onBlur={(e) => { const notes = e.target.value.trim(); if (notes !== (row.notes ?? "")) edit((r) => { const next = { ...r }; if (notes) next.notes = notes; else delete next.notes; return next; }); }} />
      </Block>
    </>
  );
}

function CellBlock({ doc, computed, snapshot, placed, row, column, onEdit, onShowTransactions }: Pick<Props, "doc" | "computed" | "snapshot" | "placed" | "onEdit" | "onShowTransactions"> & { row: PlanRow; column: Column }) {
  const result = computed.rows.get(row.id)!;
  const months = monthsOf(column, computed);
  const pieces = useMemo(() => (placed && snapshot ? contributionsOf(placed, snapshot, row.id, new Set(months)) : []), [placed, snapshot, row.id, months]);
  if (column.kind === "year") {
    const total = aggregate(result.values, column.indexes, "sum");
    return (
      <Block title={`${column.year}${column.partial ? " (part of the year)" : ""}`}>
        <Fact label="Total" strong>{money(total)}</Fact>
        <Fact label="Monthly average">{money(Math.round(total / column.indexes.length))}</Fact>
        <Pieces pieces={pieces} onShow={pieces.length ? () => onShowTransactions({ title: `${row.name}, ${column.year}`, months, items: pieces, sign: row.section === "income" ? 1 : -1 }) : undefined} />
      </Block>
    );
  }
  const i = column.index, kind = computed.kinds[i], month = column.month;
  const actual = result.actual[i], plan = result.plan[i], typed = row.cells[month];
  const end = planEndMonth(doc);
  const fill = (to: Month) => {
    const amount = result.values[i];
    const count = Math.max(0, (Number(to.slice(0, 4)) - Number(month.slice(0, 4))) * 12 + Number(to.slice(5, 7)) - Number(month.slice(5, 7)));
    onEdit((d) => setCells(d, monthRange(month, count + 1).map((m) => ({ rowId: row.id, month: m, amount }))));
  };
  const clearAfter = () => onEdit((d) => setCells(d, Object.keys(row.cells).filter((m) => m >= month).map((m) => ({ rowId: row.id, month: m, amount: null }))));
  return (
    <Block title={`${monthLabel(month)} · ${doc.useActuals ? (kind === "actual" ? "Actual" : kind === "current" ? "This month" : "Forecast") : "Plan"}`}>
      {actual !== null && <Fact label={kind === "current" ? "Recorded so far" : "Recorded in Actual"} strong={kind === "actual"}>{money(actual)}</Fact>}
      {kind === "actual"
        ? <><Fact label="Planned">{plan === null ? "-" : money(plan)}</Fact>{plan !== null && <Fact label="Difference">{money((actual ?? 0) - plan)}</Fact>}</>
        : <><Fact label={kind === "current" ? "Planned for the month" : "Forecast"} strong={kind === "forecast"}>{money(plan ?? 0)}</Fact>{kind === "current" && <Fact label="Expected by month end" strong>{money(result.values[i])}</Fact>}<Fact label="From">{SOURCE_LABEL[result.source[i]]}</Fact></>}
      {kind !== "actual" && (
        <div className="space-y-2 rounded-md border border-border p-2">
          <div className="flex items-center gap-2">
            <Label htmlFor="cf-cell-amount" className="shrink-0 text-xs">Typed amount</Label>
            <AmountField id="cf-cell-amount" key={`${row.id}:${month}`} value={typed ?? null} allowEmpty placeholder="Follows the forecast" onCommit={(amount) => onEdit((d) => setCells(d, [{ rowId: row.id, month, amount }]))} />
          </div>
          <div className="flex flex-wrap gap-1">
            <Button size="xs" variant="outline" onClick={() => fill(`${month.slice(0, 4)}-12` > end ? end : `${month.slice(0, 4)}-12`)} title="Type this month's amount into every month up to December">Fill to year end</Button>
            <Button size="xs" variant="outline" onClick={() => fill(end)} title="Type this month's amount into every later month of the plan">Fill to plan end</Button>
            {Object.keys(row.cells).some((m) => m >= month) && <Button size="xs" variant="ghost" onClick={clearAfter} title="Remove the typed amounts from this month on, so they follow the forecast again">Clear typed from here</Button>}
          </div>
        </div>
      )}
      {kind !== "forecast" && <Pieces pieces={pieces} onShow={pieces.length ? () => onShowTransactions({ title: `${row.name}, ${monthLabel(month)}`, months, items: pieces, sign: row.section === "income" ? 1 : -1 }) : undefined} />}
    </Block>
  );
}

function Pieces({ pieces, onShow, renderAction }: { pieces: ReturnType<typeof contributionsOf>; onShow?: () => void; renderAction?: (piece: ReturnType<typeof contributionsOf>[number]) => ReactNode }) {
  if (pieces.length === 0) return null;
  return (
    <div className="space-y-1">
      <p className="text-muted-foreground">Made up of</p>
      <ul className="divide-y divide-border/50 rounded-md border border-border">
        {pieces.slice(0, 40).map((piece) => (
          <li key={`${piece.kind}:${piece.id}`} className="flex h-7 items-center gap-2 px-2">
            <span className="min-w-0 flex-1 truncate" title={piece.label}>{piece.label}</span>
            <span className="shrink-0 tabular-nums">{money(piece.amount)}</span>
            {renderAction?.(piece)}
          </li>
        ))}
      </ul>
      {pieces.length > 40 && <p className="text-muted-foreground">And {pieces.length - 40} smaller ones.</p>}
      {onShow && <Button size="xs" variant="outline" onClick={onShow}><ListTree className="size-3" aria-hidden />Show the transactions</Button>}
    </div>
  );
}

function LinksBlock({ doc, snapshot, row, edit }: { doc: PlanDocument; snapshot: Snapshot; row: PlanRow; edit: (change: (row: PlanRow) => PlanRow) => void }) {
  const categoryOptions = useMemo((): ComboboxOption[] => {
    const options: ComboboxOption[] = [];
    let group = "";
    for (const c of snapshot.categories) {
      if (c.groupId !== group) { group = c.groupId; options.push({ id: `group:${c.groupId}`, name: c.groupName, isGroupHeader: true }); }
      options.push({ id: c.id, name: c.name, hidden: c.hidden });
    }
    return options;
  }, [snapshot.categories]);
  const covered = useMemo(() => new Set(snapshot.categories.filter((c) => row.links.categoryGroups.includes(c.groupId)).map((c) => c.id)), [snapshot.categories, row.links.categoryGroups]);
  const accountOptions = useMemo((): ComboboxOption[] => {
    const inside = snapshot.accounts.filter((a) => accountRole(doc, a) === "cash"), outside = snapshot.accounts.filter((a) => accountRole(doc, a) !== "cash");
    const item = (a: Snapshot["accounts"][number]): ComboboxOption => ({ id: a.id, name: a.name, hidden: a.closed, trailing: a.closed ? "closed" : undefined });
    return [
      ...(outside.length ? [{ id: "h:outside", name: "Transfers between cash and…", isGroupHeader: true as const }, ...outside.map(item)] : []),
      ...(inside.length ? [{ id: "h:inside", name: "Uncategorized entries in…", isGroupHeader: true as const }, ...inside.map(item)] : []),
    ];
  }, [snapshot.accounts, doc]);
  const accountName = new Map(snapshot.accounts.map((a) => [a.id, a.name]));
  const categoryCount = row.links.categories.length + row.links.categoryGroups.length;
  return (
    <Block title="Follows in Actual">
      <p className="text-muted-foreground">Past months show what Actual recorded for these. A category or account can be followed by one row only.</p>
      <div className="space-y-1">
        <span className="text-xs font-medium">Categories</span>
        <MultiSearchableCombobox
          ariaLabel="Categories this row follows" selectableGroups options={categoryOptions} coveredIds={covered} placeholder="No categories" triggerClassName="w-full"
          summary={categoryCount === 0 ? undefined : `${row.links.categoryGroups.length ? `${row.links.categoryGroups.length} ${row.links.categoryGroups.length === 1 ? "group" : "groups"}` : ""}${row.links.categoryGroups.length && row.links.categories.length ? ", " : ""}${row.links.categories.length ? `${row.links.categories.length} ${row.links.categories.length === 1 ? "category" : "categories"}` : ""}`}
          values={[...row.links.categoryGroups.map((id) => `group:${id}`), ...row.links.categories]}
          onChange={(values) => edit((r) => ({ ...r, links: { ...r.links, categoryGroups: values.filter((v) => v.startsWith("group:")).map((v) => v.slice(6)), categories: values.filter((v) => !v.startsWith("group:")) } }))}
        />
      </div>
      <div className="space-y-1">
        <span className="text-xs font-medium">Accounts</span>
        <MultiSearchableCombobox
          ariaLabel="Accounts this row follows" options={accountOptions} placeholder="No accounts" triggerClassName="w-full"
          summary={row.links.accounts.length === 0 ? undefined : `${row.links.accounts.length} ${row.links.accounts.length === 1 ? "account" : "accounts"}`}
          values={row.links.accounts.map((a) => a.id)}
          onChange={(values) => edit((r) => ({ ...r, links: { ...r.links, accounts: values.map((id) => r.links.accounts.find((a) => a.id === id) ?? { id }) } }))}
        />
        {row.links.accounts.length > 0 && (
          <ul className="divide-y divide-border/50 rounded-md border border-border">
            {row.links.accounts.map((link) => (
              <li key={link.id} className="flex h-8 items-center gap-2 px-2">
                <span className="min-w-0 flex-1 truncate" title={accountName.get(link.id)}>{accountName.get(link.id) ?? "Deleted account"}</span>
                <Select
                  size="sm" className="w-32" value={link.flow ?? "all"} title="Which direction this row counts"
                  onValueChange={(v) => edit((r) => ({ ...r, links: { ...r.links, accounts: r.links.accounts.map((a) => (a.id === link.id ? (v === "all" ? { id: a.id } : { id: a.id, flow: v as "in" | "out" }) : a)) } }))}
                  options={[{ value: "all", label: "In and out" }, { value: "in", label: "Money in only" }, { value: "out", label: "Money out only" }]}
                />
                <Button size="icon-xs" variant="ghost" aria-label={`Stop following ${accountName.get(link.id) ?? "the account"}`} onClick={() => edit((r) => ({ ...r, links: { ...r.links, accounts: r.links.accounts.filter((a) => a.id !== link.id) } }))}><X className="size-3" aria-hidden /></Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Block>
  );
}

function BasisBlock({ doc, snapshot, row, typical, problem, edit }: { doc: PlanDocument; snapshot: Snapshot | null; row: PlanRow; typical: number | null; problem?: string; edit: (change: (row: PlanRow) => PlanRow) => void }) {
  const kinds: BasisKind[] = doc.useActuals ? ["manual", "average", "budget", "schedule", "loan"] : ["manual"];
  const setBasis = (kind: BasisKind) => {
    const basis: Basis = kind === "average" ? { kind, months: 12 } : kind === "schedule" ? { kind, scheduleIds: [] } : { kind };
    edit((r) => ({ ...r, basis }));
  };
  const scheduleOptions = useMemo((): ComboboxOption[] => (snapshot?.schedules ?? []).filter((s) => !s.completed).map((s) => ({ id: s.id, name: s.name, trailing: s.amount === null ? undefined : money(Math.abs(s.amount)) })).sort((a, b) => a.name.localeCompare(b.name)), [snapshot]);
  const start = currentOrStart(doc, snapshot);
  const setRule = (id: string, change: Partial<RepeatRule>) => edit((r) => ({ ...r, rules: r.rules.map((rule) => { if (rule.id !== id) return rule; const next = { ...rule, ...change }; if (!next.end) delete next.end; if (!next.growthPct) delete next.growthPct; return next; }) }));
  return (
    <Block title="Forecast">
      <div className="space-y-1">
        <Label htmlFor="cf-basis" className="text-xs">Coming months come from</Label>
        <Select id="cf-basis" size="sm" className="w-full" value={row.basis.kind} onValueChange={(v) => setBasis(v as BasisKind)} options={kinds.map((k) => ({ value: k, label: BASIS_LABEL[k] }))} />
      </div>
      {row.basis.kind === "average" && (() => { const basis = row.basis; return (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span>Averaged over the last</span>
            <PillGroup<string> options={AVERAGE_WINDOWS.map((m) => ({ value: String(m), label: `${m} mo` }))} value={String(basis.months)} onChange={(v) => edit((r) => ({ ...r, basis: { ...basis, months: Number(v) as AverageWindow } }))} />
          </div>
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="cf-growth" className="text-xs">Yearly change, in percent</Label>
            <PercentField id="cf-growth" className="w-20" value={basis.growthPct ?? 0} onCommit={(growthPct) => edit((r) => ({ ...r, basis: growthPct ? { ...basis, growthPct } : { kind: "average", months: basis.months } }))} />
          </div>
          {typical !== null && <Fact label="Comes to, each month" strong>{money(typical)}</Fact>}
        </div>
      ); })()}
      {row.basis.kind === "budget" && <p className="text-muted-foreground">Uses what Actual&apos;s budget holds for the categories this row follows, from this month on. Months after the last budgeted one repeat it. If another row follows an account these categories pay into (a loan, for example), that money is forecast there too.</p>}
      {row.basis.kind === "schedule" && (() => { const basis = row.basis; return (
        <MultiSearchableCombobox ariaLabel="Schedules this row follows" options={scheduleOptions} placeholder="Choose schedules" triggerClassName="w-full" values={basis.scheduleIds} summary={basis.scheduleIds.length ? `${basis.scheduleIds.length} ${basis.scheduleIds.length === 1 ? "schedule" : "schedules"}` : undefined} onChange={(scheduleIds) => edit((r) => ({ ...r, basis: { kind: "schedule", scheduleIds } }))} />
      ); })()}
      {row.basis.kind === "loan" && <p className="text-muted-foreground">Uses the repayments the Loans page projects for the loan accounts this row follows, until each loan is paid off.{row.links.accounts.some((a) => { const loan = snapshot?.loans[a.id]; return loan?.state === "ready" && loan.principalOnly; }) && " Where repayments are recorded as splits, this is the principal part: the interest is forecast by the row that follows its category."}</p>}
      {problem && <p className="text-amber-700 dark:text-amber-400">{problem}</p>}
      {row.basis.kind === "manual" && (
        <div className="space-y-2">
          {row.rules.map((rule) => (
            <div key={rule.id} className="space-y-1.5 rounded-md border border-border p-2">
              <div className="flex items-center gap-1.5">
                <AmountField aria-label="Repeating amount" className="w-28" value={rule.amount} onCommit={(amount) => { if (amount !== null) setRule(rule.id, { amount }); }} />
                <Select size="sm" className="min-w-0 flex-1" value={String(rule.every)} onValueChange={(v) => setRule(rule.id, { every: Number(v) })} options={EVERY_OPTIONS.some((o) => o.value === String(rule.every)) ? EVERY_OPTIONS : [...EVERY_OPTIONS, { value: String(rule.every), label: `Every ${rule.every} months` }]} />
                <Button size="icon-xs" variant="ghost" aria-label="Remove this repeating amount" onClick={() => edit((r) => ({ ...r, rules: r.rules.filter((x) => x.id !== rule.id) }))}><Trash2 className="size-3" aria-hidden /></Button>
              </div>
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <span>from</span><MonthField aria-label="First month" className="w-[76px]" value={rule.start} onCommit={(m) => { if (m) setRule(rule.id, { start: m, ...(rule.end && rule.end < m ? { end: undefined } : {}) }); }} />
                <span>to</span><MonthField aria-label="Last month (empty for no end)" className="w-[76px]" allowEmpty min={rule.start} value={rule.end ?? null} onCommit={(m) => setRule(rule.id, { end: m ?? undefined })} />
                <span className="ml-auto">+</span><PercentField aria-label="Yearly change, in percent" className="w-12" value={rule.growthPct ?? 0} onCommit={(growthPct) => setRule(rule.id, { growthPct: growthPct || undefined })} /><span>%/yr</span>
              </div>
            </div>
          ))}
          <Button size="xs" variant="outline" onClick={() => edit((r) => ({ ...r, rules: [...r.rules, { id: generateId(), amount: 0, start, every: 1 }] }))}><Plus className="size-3" aria-hidden />Add a repeating amount</Button>
          {row.rules.length === 0 && <p className="text-muted-foreground">Type amounts straight into the grid, or add an amount that repeats (a salary each month, rent each quarter, a fee each year).</p>}
        </div>
      )}
    </Block>
  );
}

/** Where a new repeating amount starts: this month, or the plan's first month when today is outside the plan. */
function currentOrStart(doc: PlanDocument, snapshot: Snapshot | null): Month {
  const current = doc.useActuals && snapshot ? snapshot.today.slice(0, 7) : null;
  return current && current >= doc.startMonth && current <= planEndMonth(doc) ? current : doc.startMonth;
}

// ─── Not in plan ─────────────────────────────────────────────────────────────

function UnplannedPanel({ computed, snapshot, placed, section, column, onEdit, onSelectLine, onShowTransactions }: Props & { section: SectionId }) {
  // A month or a year when one is selected; otherwise the twelve months up to now.
  const months = useMemo(() => {
    if (column) return monthsOf(column, computed);
    const end = computed.currentIndex >= 0 ? computed.months[computed.currentIndex] : computed.months[computed.months.length - 1];
    return monthRange(addMonths(end, -11), 12);
  }, [column, computed]);
  const pieces = useMemo(() => (placed && snapshot ? contributionsOf(placed, snapshot, unplannedTarget(section), new Set(months)) : []), [placed, snapshot, section, months]);
  const category = new Map((snapshot?.categories ?? []).map((c) => [c.id, c]));
  const account = new Map((snapshot?.accounts ?? []).map((a) => [a.id, a]));
  const addFor = (piece: (typeof pieces)[number]) => {
    const name = piece.kind === "category" ? category.get(piece.id)?.name : account.get(piece.id)?.name;
    const row = createRow({
      name: name ?? "New row", section, basis: { kind: "average", months: 12 },
      links: piece.kind === "category" ? { categories: [piece.id] } : { accounts: [piece.kind === "uncategorized" ? { id: piece.id, flow: section === "income" ? "in" : "out" } : { id: piece.id }] },
    });
    onEdit((d) => addRow(d, row));
    onSelectLine(`row:${row.id}`);
  };
  return (
    <>
      <p className="text-muted-foreground">What Actual recorded in the plan&apos;s cash accounts that no row follows. It still counts, so every month adds up to the real change in cash; it is just not forecast. Add a row for anything you want to plan.</p>
      <Block title={column ? columnLabel(column) : "Last 12 months"}>
        {pieces.length === 0 ? <p className="text-muted-foreground">Nothing here in these months.</p> : (
          <Pieces
            pieces={pieces}
            onShow={() => onShowTransactions({ title: `Not in plan (${SECTION_LABEL[section]}), ${column ? columnLabel(column) : "last 12 months"}`, months, items: pieces, sign: section === "income" ? 1 : -1 })}
            renderAction={(piece) => <Button size="xs" variant="outline" onClick={() => addFor(piece)} aria-label={`Add a row for ${piece.label}`}><Plus className="size-3" aria-hidden />Row</Button>}
          />
        )}
      </Block>
    </>
  );
}

// ─── Groups, sections, balances ──────────────────────────────────────────────

function GroupPanel({ doc, groupId, onEdit, onSelectLine }: Props & { groupId: string }) {
  const group = doc.groups.find((g) => g.id === groupId);
  if (!group) return null;
  const add = () => { const row = createRow({ name: "New row", section: group.section, groupId }); onEdit((d) => addRow(d, row)); onSelectLine(`row:${row.id}`); };
  return (
    <Block title="Group">
      <div className="space-y-1"><Label htmlFor="cf-group-name" className="text-xs">Name</Label><TextField id="cf-group-name" value={group.name} maxLength={NAME_MAX} onCommit={(name) => onEdit((d) => renameGroup(d, groupId, name))} /></div>
      <div className="flex flex-wrap items-center gap-1">
        <Button size="xs" variant="outline" onClick={add}><Plus className="size-3" aria-hidden />Add a row</Button>
        <Button size="xs" variant="outline" onClick={() => onEdit((d) => moveGroup(d, groupId, -1))}><ArrowUp className="size-3" aria-hidden />Up</Button>
        <Button size="xs" variant="outline" onClick={() => onEdit((d) => moveGroup(d, groupId, 1))}><ArrowDown className="size-3" aria-hidden />Down</Button>
        <Button size="xs" variant="ghost" className="ml-auto text-destructive hover:text-destructive" title="Its rows stay, directly under the section" onClick={() => { onEdit((d) => removeGroup(d, groupId)); onSelectLine(null); }}><Trash2 className="size-3" aria-hidden />Remove group</Button>
      </div>
      <p className="text-muted-foreground">A group is a subtotal. To put a row in it, select the row and choose this group.</p>
    </Block>
  );
}

function SectionPanel({ section, onEdit, onSelectLine }: Props & { section: SectionId }) {
  const add = () => { const row = createRow({ name: "New row", section }); onEdit((d) => addRow(d, row)); onSelectLine(`row:${row.id}`); };
  const addNewGroup = () => {
    let created = "";
    onEdit((d) => { const next = addGroup(d, section, "New group"); created = next.groupId; return next.doc; });
    if (created) onSelectLine(`group:${created}`);
  };
  const about: Record<SectionId, string> = {
    income: "Money coming into the plan's cash: pay, rent received, refunds of taxes. A negative amount is money going back out.",
    expenses: "Money spent from the plan's cash, by card or from the bank. A negative amount is a refund.",
    savings: "Money moved out of cash to keep: savings accounts, deposits, investments, retirement. A negative amount is a withdrawal back into cash.",
    debt: "Repayments of loans and other debts. A negative amount is new borrowing that arrives in cash.",
  };
  return (
    <Block title={SECTION_LABEL[section]}>
      <p className="text-muted-foreground">{about[section]}</p>
      <div className="flex gap-1">
        <Button size="xs" variant="outline" onClick={add}><Plus className="size-3" aria-hidden />Add a row</Button>
        <Button size="xs" variant="outline" onClick={addNewGroup}><Plus className="size-3" aria-hidden />Add a group</Button>
      </div>
    </Block>
  );
}

function BalancePanel({ doc, computed, snapshot, placed, which, column }: Props & { which: "opening" | "closing" }) {
  const index = !column ? null : column.kind === "month" ? column.index : which === "opening" ? column.indexes[0] : column.indexes[column.indexes.length - 1];
  const month = index === null ? null : computed.months[index];
  const kind = index === null ? null : computed.kinds[index];
  // Account balances exist for what was recorded: the end of a past month, or today.
  const at = month && kind && placed && snapshot ? (which === "closing" ? (kind === "forecast" ? null : month) : kind === "actual" || kind === "current" ? addMonths(month, -1) : null) : null;
  const balances = useMemo(() => {
    if (!at || !placed || !snapshot) return [];
    const map = accountBalances(snapshot, placed.cashIds, at);
    return snapshot.accounts.filter((a) => placed.cashIds.has(a.id) && (map.get(a.id) !== 0 || !a.closed)).map((a) => ({ id: a.id, name: a.name, amount: map.get(a.id) ?? 0 })).sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
  }, [at, placed, snapshot]);
  return (
    <>
      <p className="text-muted-foreground">{which === "opening" ? "The cash the month starts with: the closing balance of the month before." : "Opening balance plus the month's net cashflow. Past months are the real balances of the plan's cash accounts; later months are the forecast."}</p>
      {index !== null && month && (
        <Block title={`${monthLabel(month)} ${which === "opening" ? "opening" : "closing"}`}>
          <Fact label={kind === "forecast" ? "Forecast" : kind === "current" && which === "closing" ? "Expected by month end" : "Balance"} strong>{money(which === "opening" ? computed.opening[index] : computed.closing[index])}</Fact>
          {which === "closing" && doc.minimumCash !== null && <Fact label="Above the minimum by">{money(computed.closing[index] - doc.minimumCash)}</Fact>}
          {which === "closing" && kind === "current" && <Fact label="In the accounts today">{money(computed.kpis.cashNow)}</Fact>}
          {balances.length > 0 && (
            <div className="space-y-1">
              <p className="text-muted-foreground">{which === "closing" && kind === "current" ? "In the accounts today" : "By account"}</p>
              <ul className="divide-y divide-border/50 rounded-md border border-border">
                {balances.map((b) => <li key={b.id} className="flex h-7 items-center justify-between gap-2 px-2"><span className="min-w-0 truncate" title={b.name}>{b.name}</span><span className="shrink-0 tabular-nums">{money(b.amount)}</span></li>)}
              </ul>
            </div>
          )}
        </Block>
      )}
      {doc.useActuals && <p className="text-muted-foreground">Which accounts count as the plan&apos;s cash is set in Plan settings. Classes come from the <Link href="/accounts" className="underline underline-offset-2">Accounts</Link> page.</p>}
    </>
  );
}

function MemoPanel({ line, column }: { line: Extract<Line, { kind: "memo" }>; column: Column | null }) {
  return (
    <>
      {line.hint && <p className="text-muted-foreground">{line.hint}</p>}
      {line.key === "net" && <p className="text-muted-foreground">Income, less expenses, less what goes to savings and to debts. A month with a negative net lowers the cash balance.</p>}
      {line.key === "total" && <p className="text-muted-foreground">The closing cash balance and the savings estimate together.</p>}
      {column && <Block title={columnLabel(column)}><Fact label={line.label} strong>{money(column.kind === "month" ? line.values[column.index] : aggregate(line.values, column.indexes, line.aggregate))}</Fact></Block>}
    </>
  );
}
