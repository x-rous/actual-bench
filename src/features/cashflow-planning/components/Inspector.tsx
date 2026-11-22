"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowDown, ArrowLeftRight, ArrowUp, Info, MoreHorizontal, Plus, Trash2, X } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ColorPicker } from "@/components/ui/color-picker";
import { ConfirmDialog, type ConfirmState } from "@/components/ui/confirm-dialog";
import { cn } from "@/lib/utils";
import type { LinkNote } from "@/lib/cashflow-planning/linkNotes";
import { Button } from "@/components/ui/button";
import { MultiSearchableCombobox, type ComboboxOption } from "@/components/ui/combobox";
import { Label } from "@/components/ui/label";
import { PillGroup } from "@/components/ui/pill-group";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { generateId } from "@/lib/uuid";
import { accountBalances, accountRole, contributionsOf, isBorrowing, unplannedTarget, type Placed, type Snapshot } from "@/lib/cashflow-planning/actuals";
import { NAME_MAX, NOTES_MAX, addGroup, addRow, createRow, moveGroup, moveRow, planEndMonth, removeGroup, renameGroup, setCells, setGroupColor, updateRow } from "@/lib/cashflow-planning/document";
import type { CellSource, Computed } from "@/lib/cashflow-planning/engine";
import { addMonths, monthLabel, monthRange } from "@/lib/cashflow-planning/months";
import { AVERAGE_WINDOWS, SECTION_LABEL, type AverageWindow, type Basis, type BasisKind, type Month, type PlanDocument, type PlanRow, type RepeatRule, type SectionId } from "@/lib/cashflow-planning/types";
import { money } from "@/features/financial-insights/format";
import { aggregate, lastTwelveMonths, type Column, type Line } from "../lib/view";
import { requestFor, piecesOf, type TransactionsRequest } from "../lib/transactions";
import { AmountField, MonthField, PercentField, TextField } from "./fields";

export type { TransactionsRequest };

type Props = {
  doc: PlanDocument;
  computed: Computed;
  snapshot: Snapshot | null;
  placed: Placed | null;
  line: Line | null;
  column: Column | null;
  problems: ReadonlyMap<string, string>;
  /** What a row's links that an earlier row already holds mean for it, by row id. */
  linkNotes: ReadonlyMap<string, LinkNote>;
  width: number;
  onResize: (width: number) => void;
  onEdit: (change: (doc: PlanDocument) => PlanDocument) => void;
  /** Selects a line of the grid by key (after creating a row, for example). */
  onSelectLine: (key: string | null) => void;
  /** Opens the dialog that adds a row to a section or group. */
  onAddRow: (section: SectionId, groupId: string | null) => void;
  onDeleteRow: (rowId: string) => void;
  onShowTransactions: (request: TransactionsRequest) => void;
  onClose: () => void;
  overview: ReactNode;
  /** The title over the overview, when something else stands in for it (a picked month). */
  overviewTitle?: string;
  /** The line under that title. */
  overviewSubtitle?: string;
};

export const INSPECTOR_MIN = 340, INSPECTOR_MAX = 640;

const SOURCE_LABEL: Record<CellSource, string> = {
  actual: "Recorded in Actual", cell: "Typed amount", rule: "Repeating amount", average: "Average of recent months", budget: "Actual's budget", schedule: "Actual schedules", loan: "Loan schedule", none: "Nothing planned",
};

const BASIS_LABEL: Record<BasisKind, string> = {
  manual: "Repeating amounts and typed cells", average: "Average of recent months", budget: "Actual's budget", schedule: "Actual schedules", loan: "Loan schedule (from Loans)",
};

const EVERY_OPTIONS = [{ value: "1", label: "Every month" }, { value: "2", label: "Every 2 months" }, { value: "3", label: "Every 3 months" }, { value: "6", label: "Every 6 months" }, { value: "12", label: "Every year" }, { value: "24", label: "Every 2 years" }];

/** The row's notes: a local draft while typing, the document's text otherwise, so an undo shows at once and is never written back. */
function NotesField({ value, onCommit }: { value: string; onCommit: (notes: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => { if (draft === null) return; const notes = draft.trim(); setDraft(null); if (notes !== value) onCommit(notes); };
  return <Textarea aria-label="Notes" value={draft ?? value} maxLength={NOTES_MAX} rows={2} className="text-xs" onChange={(e) => setDraft(e.target.value)} onBlur={commit} />;
}

/** A panel's title and, when there is one, what it is about (a month and what it is), on one line: the title gives way first. */
function PanelTitle({ title, subtitle }: { title: string; subtitle?: string | null }) {
  return (
    <div className="flex min-w-0 flex-1 items-baseline gap-2">
      <h2 className="min-w-0 truncate text-xs font-semibold" title={title}>{title}</h2>
      {subtitle && <p className="shrink-0 whitespace-nowrap text-[11px] tabular-nums text-muted-foreground">{subtitle}</p>}
    </div>
  );
}

/** The period a panel is about, for its header: a month with what it is (Actual, This month, Forecast), or a year. */
function periodOf(column: Column | null, computed: Computed, doc: PlanDocument): string | null {
  if (!column) return null;
  if (column.kind === "year") return `${column.year}${column.partial ? " · part of the year" : ""}`;
  const kind = computed.kinds[column.index];
  return `${monthLabel(column.month)} · ${doc.useActuals ? (kind === "actual" ? "Actual" : kind === "current" ? "This month" : "Forecast") : "Plan"}`;
}

export function Inspector(props: Props) {
  const { line, column, onClose, width, onResize } = props;
  const title = !line ? props.overviewTitle ?? "Plan overview" : line.kind === "row" ? line.row.name : line.kind === "group" ? line.group.name : line.label;
  const period = line ? periodOf(column, props.computed, props.doc) : null;
  // Only a picked month has a line under its title; for everything else the grid already shows what was selected.
  const subtitle = !line ? props.overviewSubtitle : period;
  // Dragging the left edge resizes the panel; the arrow keys do the same for keyboard users.
  const startResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX, startWidth = width;
    const move = (e: PointerEvent) => onResize(Math.min(INSPECTOR_MAX, Math.max(INSPECTOR_MIN, startWidth + startX - e.clientX)));
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  return (
    <aside aria-label="Details" className="relative flex shrink-0 flex-col border-l border-border bg-background" style={{ width }}>
      <div
        role="separator" aria-orientation="vertical" aria-label="Resize the details panel" aria-valuemin={INSPECTOR_MIN} aria-valuemax={INSPECTOR_MAX} aria-valuenow={width} tabIndex={0}
        onPointerDown={startResize}
        onKeyDown={(e) => { if (e.key === "ArrowLeft") { e.preventDefault(); onResize(Math.min(INSPECTOR_MAX, width + 20)); } else if (e.key === "ArrowRight") { e.preventDefault(); onResize(Math.max(INSPECTOR_MIN, width - 20)); } }}
        className="absolute inset-y-0 -left-1 z-10 w-2 cursor-col-resize outline-none hover:bg-primary/20 focus-visible:bg-primary/30"
      />
      {line?.kind === "row" ? <RowPanel {...props} row={line.row} column={column} /> : (
        <>
          <header className="flex h-8 shrink-0 items-center gap-2 border-b-2 border-border bg-muted px-3">
            <PanelTitle title={title} subtitle={subtitle} />
            <div className="ml-auto flex items-center gap-1">
              {line?.kind === "group" && <GroupMenu groupId={line.group.id} name={line.group.name} onEdit={props.onEdit} onSelectLine={props.onSelectLine} />}
              <Button size="icon-xs" variant="ghost" onClick={onClose} aria-label="Close details"><X className="size-3.5" aria-hidden /></Button>
            </div>
          </header>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3 text-xs">
            {!line ? props.overview
              : line.kind === "unplanned" ? <UnplannedPanel {...props} section={line.section} column={column} />
              : line.kind === "group" ? <GroupPanel {...props} line={line} column={column} groupId={line.group.id} />
              : line.kind === "section" ? <SectionPanel {...props} line={line} column={column} section={line.section} />
              : line.kind === "balance" ? <BalancePanel {...props} which={line.key} column={column} />
              : line.kind === "memo" ? <MemoPanel {...props} line={line} column={column} /> : null}
          </div>
        </>
      )}
    </aside>
  );
}

function Block({ title, children, action }: { title?: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="space-y-2">
      {(title || action) && <div className="flex items-center justify-between gap-2"><h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>{action}</div>}
      {children}
    </section>
  );
}

/** An amount that lists the transactions behind it when clicked. */
const AmountLink = ({ onClick, strong, children }: { onClick: () => void; strong?: boolean; children: ReactNode }) => (
  <button type="button" onClick={onClick} title="Show the transactions" className={cn("tabular-nums underline decoration-dotted decoration-muted-foreground/60 underline-offset-2 hover:decoration-foreground", strong && "font-semibold")}>{children}</button>
);

const Fact = ({ label, children, strong, onClick }: { label: string; children: ReactNode; strong?: boolean; /** Makes the amount open the transactions behind it. */ onClick?: () => void }) => (
  <div className="flex items-baseline justify-between gap-3"><span className="text-muted-foreground">{label}</span>{onClick ? <AmountLink onClick={onClick} strong={strong}>{children}</AmountLink> : <span className={strong ? "font-semibold tabular-nums" : "tabular-nums"}>{children}</span>}</div>
);

/** The months a column stands for. */
const monthsOf = (column: Column | null, computed: Computed): Month[] => (!column ? [] : column.kind === "month" ? [column.month] : column.indexes.map((i) => computed.months[i]));
const columnLabel = (column: Column) => (column.kind === "month" ? monthLabel(column.month) : `${column.year}`);

// ─── A row ───────────────────────────────────────────────────────────────────

/**
 * Everything about a row in one scroll, in the order it is used: the selected month, where coming months come from, what the
 * row follows in Actual, and notes. Its name, section and group are changed in the grid (rename in place, drag to move).
 */
/** Which things this row follows that an earlier row follows too, with that row one click away, and what it means. */
function LinkNoteBlock({ note, onSelectLine }: { note: LinkNote; onSelectLine: (key: string | null) => void }) {
  const warning = note.severity === "warning";
  return (
    <div role="status" className={cn("space-y-2 rounded-md border p-2", warning ? "border-amber-500/40 bg-amber-50 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200" : "border-border bg-muted/40 text-foreground/80")}>
      <p className="flex gap-2 font-medium">{warning ? <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden /> : <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />}{warning ? "Followed by an earlier row too" : "Also followed by an earlier row"}</p>
      <ul className="space-y-1">
        {note.items.map((item, i) => (
          <li key={i} className="flex flex-wrap items-baseline gap-x-1.5">
            <span className="font-medium">{item.name}{item.kind === "group" ? " (group)" : ""}</span>
            <span aria-hidden>→</span>
            <button type="button" className="underline underline-offset-2" onClick={() => onSelectLine(`row:${item.heldBy.id}`)}>{item.heldBy.name}</button>
          </li>
        ))}
      </ul>
      <p className="leading-relaxed">{warning ? note.reason : "Nothing is counted twice."} Recorded history of these goes to the row that comes first in the plan, so this row shows none of it in past months. It can still use them for its forecast.</p>
    </div>
  );
}

function RowPanel({ doc, computed, snapshot, placed, row, column, problems, linkNotes, onSelectLine, onEdit, onDeleteRow, onShowTransactions, onClose }: Props & { row: PlanRow }) {
  const result = computed.rows.get(row.id)!;
  const edit = (change: (row: PlanRow) => PlanRow) => onEdit((d) => updateRow(d, row.id, change));
  const note = linkNotes.get(row.id);
  const problem = problems.get(row.id);
  return (
    <>
      <header className="flex h-8 shrink-0 items-center gap-2 border-b-2 border-border bg-muted px-3">
        <PanelTitle title={row.name} subtitle={column ? periodOf(column, computed, doc) : null} />
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button size="icon-xs" variant="ghost" aria-label={`More for ${row.name}`} />}><MoreHorizontal className="size-3.5" aria-hidden /></DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem onClick={() => onEdit((d) => moveRow(d, row.id, -1))}><ArrowUp className="size-3.5" aria-hidden />Move up</DropdownMenuItem>
            <DropdownMenuItem onClick={() => onEdit((d) => moveRow(d, row.id, 1))}><ArrowDown className="size-3.5" aria-hidden />Move down</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={() => onDeleteRow(row.id)}><Trash2 className="size-3.5" aria-hidden />Delete row</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button size="icon-xs" variant="ghost" onClick={onClose} aria-label="Close details"><X className="size-3.5" aria-hidden /></Button>
      </header>
      <div className="min-h-0 flex-1 divide-y divide-border overflow-y-auto p-3 text-xs [&>section]:py-4 [&>section:first-child]:pt-0 [&>section:last-child]:pb-0">
        {note && <LinkNoteBlock note={note} onSelectLine={onSelectLine} />}
        {problem && problem !== note?.summary && <p role="status" className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-50 p-2 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />{problem}</p>}
        {column && <CellBlock doc={doc} computed={computed} snapshot={snapshot} placed={placed} row={row} column={column} onEdit={onEdit} onShowTransactions={onShowTransactions} />}
        <BasisBlock doc={doc} snapshot={snapshot} row={row} typical={result.typical} problem={result.problem} edit={edit} />
        {doc.useActuals && snapshot && <LinksBlock doc={doc} snapshot={snapshot} row={row} edit={edit} />}
        <Block title="Notes">
          <NotesField key={row.id} value={row.notes ?? ""} onCommit={(notes) => edit((r) => { const next = { ...r }; if (notes) next.notes = notes; else delete next.notes; return next; })} />
        </Block>
      </div>
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
      <Block>
        <Fact label="Total" strong onClick={pieces.length ? () => onShowTransactions({ targets: [row.id], title: `${row.name}, ${column.year}`, months, items: pieces, sign: row.section === "income" ? 1 : -1 }) : undefined}>{money(total)}</Fact>
        <Fact label="Monthly average">{money(Math.round(total / column.indexes.length))}</Fact>
        <Pieces pieces={pieces} onShow={pieces.length ? (items) => onShowTransactions({ targets: [row.id], title: `${row.name}, ${column.year}`, months, items, sign: row.section === "income" ? 1 : -1 }) : undefined} />
      </Block>
    );
  }
  const i = column.index, kind = computed.kinds[i], month = column.month;
  const moved = placed?.shiftNotes.get(`${row.id}|${month}`) ?? [];
  const actual = result.actual[i], plan = result.plan[i], typed = row.cells[month];
  const end = planEndMonth(doc);
  const fill = (to: Month) => {
    const amount = result.values[i];
    const count = Math.max(0, (Number(to.slice(0, 4)) - Number(month.slice(0, 4))) * 12 + Number(to.slice(5, 7)) - Number(month.slice(5, 7)));
    onEdit((d) => setCells(d, monthRange(month, count + 1).map((m) => ({ rowId: row.id, month: m, amount }))));
  };
  const clearAfter = () => onEdit((d) => setCells(d, Object.keys(row.cells).filter((m) => m >= month).map((m) => ({ rowId: row.id, month: m, amount: null }))));
  return (
    <Block>
      {actual !== null && <Fact label={kind === "current" ? "Recorded so far" : "Recorded in Actual"} strong={kind === "actual"} onClick={pieces.length ? () => onShowTransactions({ targets: [row.id], title: `${row.name}, ${monthLabel(month)}`, months, items: pieces, sign: row.section === "income" ? 1 : -1 }) : undefined}>{money(actual)}</Fact>}
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
      {moved.length > 0 && (
        <div className="space-y-1">
          <p className="flex items-center gap-1 text-muted-foreground"><ArrowLeftRight className="size-3" aria-hidden />Counted in another month than their date</p>
          <ul className="divide-y divide-border/50 rounded-md border border-border">
            {moved.map((m) => <li key={m.id} className="flex h-7 items-center justify-between gap-2 px-2"><span>{m.to === month ? `Moved here from ${monthLabel(m.from)}` : `Moved to ${monthLabel(m.to)}`}</span><span className="tabular-nums">{money(m.amount)}</span></li>)}
          </ul>
          <p className="text-muted-foreground">Change this in the transaction list, or with a #YYYY-MM tag in the transaction&apos;s note in Actual.</p>
        </div>
      )}
      {kind !== "forecast" && <Pieces pieces={pieces} onShow={pieces.length ? (items) => onShowTransactions({ targets: [row.id], title: `${row.name}, ${monthLabel(month)}`, months, items, sign: row.section === "income" ? 1 : -1 }) : undefined} />}
    </Block>
  );
}

function Pieces({ pieces, onShow, renderAction }: { pieces: ReturnType<typeof contributionsOf>; /** Lists the transactions of the given pieces. */ onShow?: (items: ReturnType<typeof contributionsOf>) => void; renderAction?: (piece: ReturnType<typeof contributionsOf>[number]) => ReactNode }) {
  if (pieces.length === 0) return null;
  return (
    <div className="space-y-1">
      <p className="text-muted-foreground">Made up of</p>
      <ul className="divide-y divide-border/50 rounded-md border border-border">
        {pieces.slice(0, 40).map((piece) => (
          <li key={`${piece.kind}:${piece.id}`} className="flex h-7 items-center gap-2 px-2">
            <span className="min-w-0 flex-1 truncate" title={piece.label}>{piece.label}</span>
            {onShow ? <AmountLink onClick={() => onShow([piece])}>{money(piece.amount)}</AmountLink> : <span className="shrink-0 tabular-nums">{money(piece.amount)}</span>}
            {renderAction?.(piece)}
          </li>
        ))}
      </ul>
      {pieces.length > 40 && <p className="text-muted-foreground">And {pieces.length - 40} smaller ones.</p>}
    </div>
  );
}

function Chip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <li className="flex max-w-full items-center gap-0.5 rounded-md border border-border bg-muted/50 py-0.5 pl-1.5 pr-0.5">
      <span className="min-w-0 truncate" title={label}>{label}</span>
      <button type="button" onClick={onRemove} aria-label={`Stop following ${label}`} className="flex size-4 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"><X className="size-3" aria-hidden /></button>
    </li>
  );
}

export function LinksBlock({ doc, snapshot, row, edit }: { doc: PlanDocument; snapshot: Snapshot; row: PlanRow; edit: (change: (row: PlanRow) => PlanRow) => void }) {
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
  const loans = new Set(snapshot.accounts.filter((a) => isBorrowing(a, accountRole(doc, a))).map((a) => a.id));
  const categoryName = new Map(snapshot.categories.map((c) => [c.id, c.name]));
  const groupName = new Map(snapshot.categories.map((c) => [c.groupId, c.groupName]));
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
        {categoryCount > 0 && (
          <ul className="flex flex-wrap gap-1" aria-label="Followed categories">
            {row.links.categoryGroups.map((id) => <Chip key={`g${id}`} label={`${groupName.get(id) ?? "Deleted group"} (group)`} onRemove={() => edit((r) => ({ ...r, links: { ...r.links, categoryGroups: r.links.categoryGroups.filter((x) => x !== id) } }))} />)}
            {row.links.categories.map((id) => <Chip key={id} label={categoryName.get(id) ?? "Deleted category"} onRemove={() => edit((r) => ({ ...r, links: { ...r.links, categories: r.links.categories.filter((x) => x !== id) } }))} />)}
          </ul>
        )}
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
                  size="sm" className="w-36" value={link.flow ?? (loans.has(link.id) ? "out" : "all")} title="Which direction this row counts"
                  onValueChange={(v) => edit((r) => ({ ...r, links: { ...r.links, accounts: r.links.accounts.map((a) => (a.id === link.id ? (v === "all" ? { id: a.id } : { id: a.id, flow: v as "in" | "out" }) : a)) } }))}
                  // Money from a loan is borrowing and money to it a repayment: the two are never netted in one row.
                  options={loans.has(link.id) ? [{ value: "out", label: "Repayments" }, { value: "in", label: "Money borrowed" }] : [{ value: "all", label: "In and out" }, { value: "in", label: "Money in only" }, { value: "out", label: "Money out only" }]}
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

export function BasisBlock({ doc, snapshot, row, typical, problem, edit }: { doc: PlanDocument; snapshot: Snapshot | null; row: PlanRow; typical: number | null; problem?: string; edit: (change: (row: PlanRow) => PlanRow) => void }) {
  // Loan repayments are money out: an income row cannot take them (one that already does keeps the option to change it).
  const kinds: BasisKind[] = doc.useActuals ? ["manual", "average", "budget", "schedule", ...(row.section !== "income" || row.basis.kind === "loan" ? ["loan" as const] : [])] : ["manual"];
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
      {row.basis.kind === "budget" && (() => { const basis = row.basis; const lag = basis.lag ?? 0; return (
        <div className="space-y-2">
          <p className="text-muted-foreground">Uses what Actual&apos;s budget holds for the categories this row follows, from this month on. Months after the last budgeted one repeat it. If another row follows an account these categories pay into (a loan, for example), that money is forecast there too.</p>
          <div className="space-y-1">
            <Label htmlFor="cf-lag" className="text-xs">Paid</Label>
            <Select id="cf-lag" size="sm" className="w-full" value={String(lag)} onValueChange={(v) => edit((r) => ({ ...r, basis: Number(v) === 1 || Number(v) === 2 ? { kind: "budget", lag: Number(v) as 1 | 2 } : { kind: "budget" } }))}
              options={[{ value: "0", label: "In the month it is budgeted" }, { value: "1", label: "The month after" }, { value: "2", label: "Two months after" }]} />
          </div>
          {lag > 0 && <p className="text-muted-foreground">For a credit card paid after its statement: a month shows what the cards recorded for these categories {lag === 1 ? "the month before" : `${lag} months before`}, once that month is over, and its budget before that (for the month in progress, the larger of what was spent so far and its budget).</p>}
        </div>
      ); })()}
      {row.basis.kind === "schedule" && (() => { const basis = row.basis; return (
        <MultiSearchableCombobox ariaLabel="Schedules this row follows" options={scheduleOptions} placeholder="Choose schedules" triggerClassName="w-full" values={basis.scheduleIds} summary={basis.scheduleIds.length ? `${basis.scheduleIds.length} ${basis.scheduleIds.length === 1 ? "schedule" : "schedules"}` : undefined} onChange={(scheduleIds) => edit((r) => ({ ...r, basis: { kind: "schedule", scheduleIds } }))} />
      ); })()}
      {row.basis.kind === "loan" && (() => { const basis = row.basis; const split = row.links.accounts.some((a) => { const loan = snapshot?.loans[a.id]; return loan?.state === "ready" && loan.split; }); return (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span>Count</span>
            <PillGroup<string> options={[{ value: "whole", label: "Whole repayment" }, { value: "principal", label: "Principal only" }]} value={basis.count ?? "whole"} onChange={(v) => edit((r) => ({ ...r, basis: v === "principal" ? { kind: "loan", count: "principal" } : { kind: "loan" } }))} />
          </div>
          <p className="text-muted-foreground">
            {basis.count === "principal"
              ? "The part of each repayment that lowers the loan, from the Loans page's schedule. The interest stays with the row that follows its category."
              : `Each whole repayment from the Loans page's schedule, until the loan is paid off.${split ? " The interest and fee lines of repayments already recorded count here too, and no longer in their category's row." : ""}`}
          </p>
        </div>
      ); })()}
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
    return lastTwelveMonths(computed);
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
      <Block title={column ? undefined : "Last 12 months"}>
        {pieces.length === 0 ? <p className="text-muted-foreground">Nothing here in these months.</p> : (
          <Pieces
            pieces={pieces}
            onShow={(items) => onShowTransactions({ targets: [unplannedTarget(section)], title: `Not in plan (${SECTION_LABEL[section]}), ${column ? columnLabel(column) : "last 12 months"}`, months, items, sign: section === "income" ? 1 : -1 })}
            renderAction={(piece) => <Button size="xs" variant="outline" onClick={() => addFor(piece)} aria-label={`Add a row for ${piece.label}`}><Plus className="size-3" aria-hidden />Row</Button>}
          />
        )}
      </Block>
    </>
  );
}

/** Where the months still to come begin: after the current month, at the start of a plan not begun, and past the end of one that has ended. */
function firstFutureIndex(computed: Props["computed"]): number {
  if (computed.currentIndex >= 0) return computed.currentIndex + 1;
  return computed.kinds.length > 0 && computed.kinds[computed.kinds.length - 1] === "actual" ? computed.months.length : 0;
}

// ─── Groups, sections, balances ──────────────────────────────────────────────

/** The amounts of a group's figure for the selection: the month's breakdown, or (nothing selected) a summary of the group. */
function GroupFigures({ doc, computed, snapshot, placed, line, column, rows, onShowTransactions }: Pick<Props, "doc" | "computed" | "snapshot" | "placed" | "onShowTransactions"> & { line: Extract<Line, { kind: "group" }>; column: Column | null; rows: PlanRow[] }) {
  const months = monthsOf(column, computed);
  const request = column ? requestFor(doc, snapshot, placed, line, months, columnLabel(column)) : null;
  const sum = (indexes: number[], pick: (i: number) => number) => indexes.reduce((acc, i) => acc + pick(i), 0);
  const ofRows = (indexes: number[], field: "values" | "actual" | "plan") => sum(indexes, (i) => rows.reduce((acc, r) => acc + (computed.rows.get(r.id)?.[field][i] ?? 0), 0));
  if (column) {
    const open = request ? () => onShowTransactions(request) : undefined;
    if (column.kind === "year") return <Block><Fact label="Year total" strong onClick={open}>{money(aggregate(line.values, column.indexes, line.aggregate))}</Fact></Block>;
    const kind = computed.kinds[column.index], i = [column.index];
    const total = line.values[column.index];
    return (
      <Block>
        {doc.useActuals && kind === "actual" && <Fact label="Recorded" strong onClick={open}>{money(total)}</Fact>}
        {doc.useActuals && kind === "current" && <>
          <Fact label="Recorded so far" onClick={open}>{money(ofRows(i, "actual"))}</Fact>
          <Fact label="Planned for the month">{money(ofRows(i, "plan"))}</Fact>
          <Fact label="Expected by month end" strong>{money(total)}</Fact>
        </>}
        {(!doc.useActuals || kind === "forecast") && <Fact label={doc.useActuals ? "Forecast" : "Plan"} strong onClick={open}>{money(total)}</Fact>}
      </Block>
    );
  }
  // Nothing selected but the group itself: what it adds up to.
  const all = computed.months.map((_, i) => i);
  const from = firstFutureIndex(computed);
  const next12 = all.slice(from, from + 12);
  return (
    <Block>
      <p className="text-muted-foreground">{rows.length === 0 ? "No rows yet" : `${rows.length} ${rows.length === 1 ? "row" : "rows"}`}</p>
      {computed.currentIndex >= 0 && <Fact label="This month">{money(line.values[computed.currentIndex])}</Fact>}
      {next12.length > 0 && <Fact label="Next 12 months">{money(sum(next12, (i) => line.values[i]))}</Fact>}
      <Fact label="Whole plan" strong>{money(sum(all, (i) => line.values[i]))}</Fact>
    </Block>
  );
}

/** The group's rows with their amount for the selection, largest first. A name opens the row's details, an amount the transactions behind it. */
function GroupRows({ doc, computed, snapshot, placed, rows, column, problems, linkNotes, onSelectLine, onShowTransactions }: Pick<Props, "doc" | "computed" | "snapshot" | "placed" | "problems" | "linkNotes" | "onSelectLine" | "onShowTransactions"> & { rows: PlanRow[]; column: Column | null }) {
  const from = firstFutureIndex(computed);
  const indexes = column ? (column.kind === "month" ? [column.index] : column.indexes) : computed.months.map((_, i) => i).slice(from, from + 12);
  const label = column ? columnLabel(column) : "Next 12 months";
  const items = rows.map((row) => ({ row, amount: indexes.reduce((acc, i) => acc + (computed.rows.get(row.id)?.values[i] ?? 0), 0) })).sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
  const months = monthsOf(column, computed);
  return (
    <Block title="Made up of" action={<span className="text-[11px] text-muted-foreground">{label}</span>}>
      {items.length === 0 ? <p className="text-muted-foreground">No rows yet. Add one below, or drag a row onto this group.</p> : (
        <ul className="divide-y divide-border/50 rounded-md border border-border">
          {items.map(({ row, amount }) => {
            const note = linkNotes.get(row.id);
            const result = computed.rows.get(row.id);
            const request = column && result ? requestFor(doc, snapshot, placed, { kind: "row", key: `row:${row.id}`, row, result, aggregate: "sum", depth: 1 }, months, columnLabel(column)) : null;
            return (
              <li key={row.id} className="flex h-7 items-center gap-2 px-2 hover:bg-accent/40">
                <button type="button" onClick={() => onSelectLine(`row:${row.id}`)} title={`Show the details of ${row.name}`} className="min-w-0 flex-1 truncate text-left hover:underline">{row.name}</button>
                {problems.has(row.id) ? <AlertTriangle className="size-3.5 shrink-0 text-amber-600" aria-label="Needs a look" /> : note ? <Info className="size-3.5 shrink-0 text-muted-foreground/70" aria-label="Also followed by an earlier row" /> : null}
                {amount === 0 ? <span className="shrink-0 text-muted-foreground">–</span>
                  : request ? <AmountLink onClick={() => onShowTransactions(request)}>{money(amount)}</AmountLink>
                  : <span className="shrink-0 tabular-nums">{money(amount)}</span>}
              </li>
            );
          })}
        </ul>
      )}
    </Block>
  );
}

/** Moving and removing a group, kept out of the way of the settings: the same "more" menu a row has. */
function GroupMenu({ groupId, name, onEdit, onSelectLine }: { groupId: string; name: string; onEdit: Props["onEdit"]; onSelectLine: Props["onSelectLine"] }) {
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button size="icon-xs" variant="ghost" aria-label={`More for ${name}`} />}><MoreHorizontal className="size-3.5" aria-hidden /></DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem onClick={() => onEdit((d) => moveGroup(d, groupId, -1))}><ArrowUp className="size-3.5" aria-hidden />Move up</DropdownMenuItem>
          <DropdownMenuItem onClick={() => onEdit((d) => moveGroup(d, groupId, 1))}><ArrowDown className="size-3.5" aria-hidden />Move down</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={() => setConfirm({ title: `Remove the group "${name}"?`, message: "Its rows stay, directly under the section. Only the subtotal goes.", destructive: true, destructiveLabel: "Remove group", onConfirm: () => { onEdit((d) => removeGroup(d, groupId)); onSelectLine(null); } })}><Trash2 className="size-3.5" aria-hidden />Remove group</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ConfirmDialog open={!!confirm} onOpenChange={(open) => { if (!open) setConfirm(null); }} state={confirm} />
    </>
  );
}

function GroupPanel({ doc, computed, snapshot, placed, line, column, groupId, problems, linkNotes, onEdit, onSelectLine, onAddRow, onShowTransactions }: Props & { line: Line; column: Column | null; groupId: string }) {
  const group = doc.groups.find((g) => g.id === groupId);
  if (!group || line.kind !== "group") return null;
  const rows = doc.rows.filter((r) => r.groupId === groupId);
  return (
    <>
      <GroupFigures doc={doc} computed={computed} snapshot={snapshot} placed={placed} line={line} column={column} rows={rows} onShowTransactions={onShowTransactions} />
      <GroupRows doc={doc} computed={computed} snapshot={snapshot} placed={placed} rows={rows} column={column} problems={problems} linkNotes={linkNotes} onSelectLine={onSelectLine} onShowTransactions={onShowTransactions} />
      <Block title="Group">
        <div className="space-y-1"><Label htmlFor="cf-group-name" className="text-xs">Name</Label><TextField id="cf-group-name" value={group.name} maxLength={NAME_MAX} onCommit={(name) => onEdit((d) => renameGroup(d, groupId, name))} /></div>
        <div className="space-y-1">
          <span className="text-xs font-medium">Colour</span>
          <div className="flex items-center gap-2">
            <ColorPicker ariaLabel="Group colour" value={group.color} fallback="#3b82f6" onChange={(hex) => onEdit((d) => setGroupColor(d, groupId, hex))} onClear={() => onEdit((d) => setGroupColor(d, groupId, null))}>
              <span aria-hidden className={cn("block size-5 rounded-full", group.color ? "border border-border/60" : "border border-dashed border-muted-foreground/60")} style={group.color ? { backgroundColor: group.color } : undefined} />
            </ColorPicker>
            <span className="tabular-nums text-muted-foreground">{group.color ?? "None"}</span>
            {group.color && <button type="button" className="text-muted-foreground underline underline-offset-2 hover:text-foreground" onClick={() => onEdit((d) => setGroupColor(d, groupId, null))}>Clear</button>}
          </div>
          <p className="text-muted-foreground">Rows in the group use a lighter shade of this colour.</p>
        </div>
        <div className="space-y-1.5">
          <Button size="xs" variant="outline" onClick={() => onAddRow(group.section, groupId)}><Plus className="size-3" aria-hidden />Add a row</Button>
          <p className="text-muted-foreground">To put an existing row in this group, drag it onto the group or under one of its rows.</p>
        </div>
      </Block>
    </>
  );
}

function SectionPanel({ doc, computed, snapshot, placed, line, column, section, onEdit, onSelectLine, onAddRow, onShowTransactions }: Props & { line: Line; column: Column | null; section: SectionId }) {
  const add = () => onAddRow(section, null);
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
    <>
    <FigureBlock doc={doc} computed={computed} snapshot={snapshot} placed={placed} line={line} column={column} onShowTransactions={onShowTransactions} />
    <Block>
      <p className="text-muted-foreground">{about[section]}</p>
      <div className="flex gap-1">
        <Button size="xs" variant="outline" onClick={add}><Plus className="size-3" aria-hidden />Add a row</Button>
        <Button size="xs" variant="outline" onClick={addNewGroup}><Plus className="size-3" aria-hidden />Add a group</Button>
      </div>
    </Block>
    </>
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
        <Block>
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

/** A line's figure for the selected month or year, what it is made of, and a way to list the transactions behind it. */
function FigureBlock({ doc, computed, snapshot, placed, line, column, onShowTransactions }: Pick<Props, "doc" | "computed" | "snapshot" | "placed" | "onShowTransactions"> & { line: Line; column: Column | null }) {
  const months = monthsOf(column, computed);
  const request = column ? requestFor(doc, snapshot, placed, line, months, columnLabel(column)) : null;
  const pieces = useMemo(() => (request && placed && snapshot && request.targets.length ? piecesOf(placed, snapshot, request.targets, new Set(months)) : []), [request, placed, snapshot, months]);
  if (!column || line.kind === "row" || line.kind === "balance") return null;
  const values = line.values;
  const total = column.kind === "month" ? values[column.index] : aggregate(values, column.indexes, line.aggregate);
  return (
    <Block>
      <Fact label={line.kind === "group" ? line.group.name : line.kind === "section" ? SECTION_LABEL[line.section] : line.label} strong onClick={request ? () => onShowTransactions(request) : undefined}>{money(total)}</Fact>
      {pieces.length > 0
        ? <Pieces pieces={pieces} onShow={request ? (items) => onShowTransactions({ ...request, items }) : undefined} />
        : null}
    </Block>
  );
}

function MemoPanel({ doc, computed, snapshot, placed, line, column, onShowTransactions }: Props & { line: Extract<Line, { kind: "memo" }>; column: Column | null }) {
  return (
    <>
      {line.hint && <p className="text-muted-foreground">{line.hint}</p>}
      {line.key === "net" && <p className="text-muted-foreground">Income, less expenses, less what goes to savings and to debts. A month with a negative net lowers the cash balance.</p>}
      {line.key === "total" && <p className="text-muted-foreground">The closing cash balance and the savings estimate together.</p>}
      {line.key === "locked" && <p className="text-muted-foreground">Savings you cannot use now: accounts marked Locked in Accounts (a term deposit, a pension), and the savings rows that follow any of them. Part of Cash + savings, not of what you can use.</p>}
      <FigureBlock doc={doc} computed={computed} snapshot={snapshot} placed={placed} line={line} column={column} onShowTransactions={onShowTransactions} />
    </>
  );
}
