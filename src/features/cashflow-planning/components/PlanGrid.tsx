"use client";

import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight, Link2Off, Plus, TrendingDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { InfoHint } from "@/components/ui/info-hint";
import { Input } from "@/components/ui/input";
import { parseAmount } from "@/lib/cashflow-planning/document";
import type { Computed, MonthKind } from "@/lib/cashflow-planning/engine";
import { monthShort } from "@/lib/cashflow-planning/months";
import type { Month, PlanDocument, SectionId } from "@/lib/cashflow-planning/types";
import { aggregate, formatCell, lineKey, type Column, type Line } from "../lib/view";

export type PastMode = "actual" | "plan" | "diff";

/** The active cell (or a whole line when `col` is null) and, for a range, the cell it was started from. */
export type GridSelection = { line: string; col: string | null; anchor?: { line: string; col: string } };

export type CellEdit = { rowId: string; month: Month; amount: number | null };

type Props = {
  doc: PlanDocument;
  computed: Computed;
  lines: Line[];
  columns: Column[];
  cents: boolean;
  pastMode: PastMode;
  selection: GridSelection | null;
  /** Row ids with something to look at (a link held twice, a forecast that cannot be read), and what. */
  problems: ReadonlyMap<string, string>;
  onSelect: (selection: GridSelection | null) => void;
  onToggle: (key: string) => void;
  onEdit: (edits: CellEdit[]) => void;
  onAddRow: (section: SectionId, groupId: string | null) => void;
  /** Says what a paste or fill did, when not everything could be applied. */
  onNotice: (message: string) => void;
};

const LABEL_WIDTH = 288;
const KIND_LABEL: Record<MonthKind, string> = { actual: "Actual", current: "This month", forecast: "Forecast" };

/** What a line shows in a month, and whether the cell takes a typed amount. `null` is "nothing to show" (never zero). */
function monthValue(line: Line, index: number, kind: MonthKind, pastMode: PastMode, planTotals: ReadonlyMap<string, (number | null)[]> | null): number | null {
  if (kind !== "actual" || pastMode === "actual") return line.kind === "row" ? line.result.values[index] : line.values[index];
  if (line.kind === "row") {
    const plan = line.result.plan[index];
    if (plan === null) return null;
    return pastMode === "plan" ? plan : (line.result.actual[index] ?? 0) - plan;
  }
  if (line.kind === "group" || line.kind === "section") {
    const plan = planTotals?.get(line.key)?.[index] ?? null;
    if (plan === null) return null;
    return pastMode === "plan" ? plan : line.values[index] - plan;
  }
  if (line.kind === "unplanned") return pastMode === "plan" ? null : line.values[index];
  return line.values[index];
}

const isEditable = (line: Line, column: Column, kinds: readonly MonthKind[]): boolean => line.kind === "row" && column.kind === "month" && kinds[column.index] !== "actual";

/** The plan's own figures for past months, summed per group and section: null where no row of it had a plan. */
function buildPlanTotals(doc: PlanDocument, computed: Computed): Map<string, (number | null)[]> {
  const totals = new Map<string, (number | null)[]>();
  const add = (key: string, plan: readonly (number | null)[]) => {
    const sums = totals.get(key) ?? new Array<number | null>(plan.length).fill(null);
    plan.forEach((value, i) => { if (value !== null) sums[i] = (sums[i] ?? 0) + value; });
    totals.set(key, sums);
  };
  for (const row of doc.rows) {
    const plan = computed.rows.get(row.id)!.plan;
    add(lineKey.section(row.section), plan);
    if (row.groupId) add(lineKey.group(row.groupId), plan);
  }
  return totals;
}

export function PlanGrid({ doc, computed, lines, columns, cents, pastMode, selection, problems, onSelect, onToggle, onEdit, onAddRow, onNotice }: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState<{ line: string; col: string; text: string } | null>(null);
  const planTotals = useMemo(() => (pastMode === "actual" ? null : buildPlanTotals(doc, computed)), [pastMode, doc, computed]);
  const { kinds } = computed;

  const lineIndex = useMemo(() => new Map(lines.map((l, i) => [l.key, i])), [lines]);
  const colIndex = useMemo(() => new Map(columns.map((c, i) => [c.key, i])), [columns]);

  // The rectangle between the active cell and where the range started.
  const range = useMemo(() => {
    if (!selection?.col) return null;
    const a = selection.anchor ?? { line: selection.line, col: selection.col };
    const r1 = lineIndex.get(selection.line), r2 = lineIndex.get(a.line), c1 = colIndex.get(selection.col), c2 = colIndex.get(a.col);
    if (r1 === undefined || r2 === undefined || c1 === undefined || c2 === undefined) return null;
    return { top: Math.min(r1, r2), bottom: Math.max(r1, r2), left: Math.min(c1, c2), right: Math.max(c1, c2) };
  }, [selection, lineIndex, colIndex]);

  useEffect(() => {
    if (!selection?.col) return;
    scroller.current?.querySelector<HTMLElement>(`[data-cell="${CSS.escape(`${selection.line}|${selection.col}`)}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [selection]);

  const commit = (text: string, target: { line: string; col: string }, move: "down" | "right" | null) => {
    const line = lines[lineIndex.get(target.line) ?? -1];
    const column = columns[colIndex.get(target.col) ?? -1];
    setEditing(null);
    if (line?.kind === "row" && column?.kind === "month") {
      const trimmed = text.trim();
      if (trimmed === "") onEdit([{ rowId: line.row.id, month: column.month, amount: null }]);
      else {
        const amount = parseAmount(trimmed);
        if (amount === null) onNotice(`"${trimmed}" is not an amount`);
        else onEdit([{ rowId: line.row.id, month: column.month, amount }]);
      }
    }
    if (move) step(move === "down" ? 1 : 0, move === "right" ? 1 : 0, false, target);
    scroller.current?.focus();
  };

  const step = (dRow: number, dCol: number, extend: boolean, from?: { line: string; col: string | null }) => {
    const current = from ?? selection;
    if (!current) { if (lines.length && columns.length) onSelect({ line: lines[0].key, col: columns[0].key }); return; }
    const row = Math.min(lines.length - 1, Math.max(0, (lineIndex.get(current.line) ?? 0) + dRow));
    const col = Math.min(columns.length - 1, Math.max(0, (current.col ? colIndex.get(current.col) ?? 0 : -1) + dCol));
    const next = { line: lines[row].key, col: columns[col].key };
    const anchor = extend && selection?.col ? selection.anchor ?? { line: selection.line, col: selection.col } : undefined;
    onSelect(anchor ? { ...next, anchor } : next);
  };

  /** Every editable cell in the range, as [line, column] pairs. */
  const editableInRange = () => {
    if (!range) return [];
    const cells: { rowId: string; month: Month; row: number; col: number }[] = [];
    for (let r = range.top; r <= range.bottom; r++) for (let c = range.left; c <= range.right; c++) {
      const line = lines[r], column = columns[c];
      if (line.kind === "row" && column.kind === "month" && isEditable(line, column, kinds)) cells.push({ rowId: line.row.id, month: column.month, row: r, col: c });
    }
    return cells;
  };

  const copy = async () => {
    if (!range) return;
    const rows: string[] = [];
    for (let r = range.top; r <= range.bottom; r++) {
      const cells: string[] = [];
      for (let c = range.left; c <= range.right; c++) {
        const line = lines[r], column = columns[c];
        const value = column.kind === "month" ? monthValue(line, column.index, kinds[column.index], pastMode, planTotals) : aggregate(line.kind === "row" ? line.result.values : line.values, column.indexes, line.aggregate);
        cells.push(value === null ? "" : (value / 100).toFixed(2));
      }
      rows.push(cells.join("\t"));
    }
    try { await navigator.clipboard.writeText(rows.join("\n")); } catch { onNotice("The browser did not allow copying"); }
  };

  const paste = (text: string) => {
    if (!range) return;
    const table = text.replace(/\r/g, "").split("\n").filter((row, i, all) => row !== "" || i < all.length - 1).map((row) => row.split("\t"));
    if (table.length === 0) return;
    const edits: CellEdit[] = [];
    let skipped = 0;
    // One copied value fills the whole selected range; a block is laid out from its top-left cell.
    const single = table.length === 1 && table[0].length === 1;
    const height = single ? range.bottom - range.top + 1 : table.length;
    for (let dr = 0; dr < height; dr++) {
      const source = single ? table[0] : table[dr];
      const width = single ? range.right - range.left + 1 : source.length;
      for (let dc = 0; dc < width; dc++) {
        const line = lines[range.top + dr], column = columns[range.left + dc];
        const raw = (single ? source[0] : source[dc]).trim();
        if (!line || !column || !isEditable(line, column, kinds) || line.kind !== "row" || column.kind !== "month") { if (raw !== "") skipped++; continue; }
        if (raw === "") continue;
        const amount = parseAmount(raw);
        if (amount === null) { skipped++; continue; }
        edits.push({ rowId: line.row.id, month: column.month, amount });
      }
    }
    if (edits.length) onEdit(edits);
    if (skipped) onNotice(`Pasted ${edits.length} ${edits.length === 1 ? "amount" : "amounts"}; ${skipped} skipped (not an amount, or not a cell that can be typed in)`);
  };

  const fillRight = () => {
    if (!range || range.left === range.right) return;
    const edits: CellEdit[] = [];
    for (let r = range.top; r <= range.bottom; r++) {
      const line = lines[r], first = columns[range.left];
      if (line.kind !== "row" || first.kind !== "month") continue;
      const value = line.result.values[first.index];
      for (let c = range.left + 1; c <= range.right; c++) {
        const column = columns[c];
        if (column.kind === "month" && isEditable(line, column, kinds)) edits.push({ rowId: line.row.id, month: column.month, amount: value });
      }
    }
    if (edits.length) onEdit(edits);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (editing || event.target !== event.currentTarget) return;
    const mod = event.ctrlKey || event.metaKey;
    const active = selection?.col ? { line: lines[lineIndex.get(selection.line) ?? -1], column: columns[colIndex.get(selection.col) ?? -1] } : null;
    const startEdit = (text: string | null) => {
      if (!active?.line || !active.column || !isEditable(active.line, active.column, kinds) || active.line.kind !== "row" || active.column.kind !== "month") return false;
      const typed = active.line.row.cells[active.column.month];
      setEditing({ line: active.line.key, col: active.column.key, text: text ?? (typed !== undefined ? (typed / 100).toFixed(2) : "") });
      return true;
    };
    switch (event.key) {
      case "ArrowDown": event.preventDefault(); step(1, 0, event.shiftKey); return;
      case "ArrowUp": event.preventDefault(); step(-1, 0, event.shiftKey); return;
      case "ArrowRight": event.preventDefault(); step(0, 1, event.shiftKey); return;
      case "ArrowLeft": event.preventDefault(); step(0, -1, event.shiftKey); return;
      case "Tab": if (selection?.col) { event.preventDefault(); step(0, event.shiftKey ? -1 : 1, false); } return;
      case "Enter":
      case "F2": if (startEdit(null)) event.preventDefault(); return;
      case "Escape": if (selection?.anchor) { event.preventDefault(); onSelect({ line: selection.line, col: selection.col }); } return;
      case "Delete":
      case "Backspace": {
        const cells = editableInRange();
        if (cells.length) { event.preventDefault(); onEdit(cells.map((c) => ({ rowId: c.rowId, month: c.month, amount: null }))); }
        return;
      }
    }
    if (mod && event.key.toLowerCase() === "c") { event.preventDefault(); void copy(); return; }
    if (mod && event.key.toLowerCase() === "r") { event.preventDefault(); fillRight(); return; }
    if (!mod && !event.altKey && /^[0-9.\-+(]$/.test(event.key) && startEdit(event.key)) event.preventDefault();
  };

  const years = useMemo(() => {
    // The year band above the month names: each calendar year spans its months and its total.
    const bands: { year: number; span: number }[] = [];
    for (const column of columns) {
      const year = column.kind === "year" ? column.year : Number(column.month.slice(0, 4));
      const last = bands[bands.length - 1];
      if (last?.year === year) last.span++; else bands.push({ year, span: 1 });
    }
    return bands;
  }, [columns]);

  const monthWidth = cents ? 104 : 88;
  // With only year columns there is room to spare: wider columns read better than a narrow block.
  const yearWidth = columns.every((c) => c.kind === "year") ? 136 : monthWidth + 12;

  // The lines are memoized, so they are handed callbacks that never change and reach the latest state through a ref.
  const latest = useRef({ commit, onSelect, onToggle, onAddRow });
  useLayoutEffect(() => { latest.current = { commit, onSelect, onToggle, onAddRow }; });
  const handlers = useMemo((): LineHandlers => ({
    select: (next) => latest.current.onSelect(next),
    toggle: (key) => latest.current.onToggle(key),
    addRow: (section, groupId) => latest.current.onAddRow(section, groupId),
    startEdit: (line, col, text) => setEditing({ line, col, text }),
    editText: (text) => setEditing((e) => (e ? { ...e, text } : e)),
    commit: (text, target, move) => latest.current.commit(text, target, move),
    cancel: () => { setEditing(null); scroller.current?.focus(); },
    focusGrid: () => scroller.current?.focus(),
  }), []);

  return (
    <div
      ref={scroller} tabIndex={0} role="grid" aria-label="Cash plan" aria-rowcount={lines.length} onKeyDown={onKeyDown}
      onPaste={(event) => { if (!editing && event.target === event.currentTarget) { event.preventDefault(); paste(event.clipboardData.getData("text/plain")); } }}
      className="min-h-0 flex-1 overflow-auto outline-none focus-visible:ring-1 focus-visible:ring-ring/60"
      style={{ scrollPaddingLeft: LABEL_WIDTH, scrollPaddingTop: 56 }}
    >
      <table className="border-separate border-spacing-0 text-xs">
        <colgroup>
          <col style={{ width: LABEL_WIDTH, minWidth: LABEL_WIDTH }} />
          {columns.map((c) => <col key={c.key} style={{ width: c.kind === "year" ? yearWidth : monthWidth, minWidth: c.kind === "year" ? yearWidth : monthWidth }} />)}
        </colgroup>
        <thead className="sticky top-0 z-30">
          <tr>
            <th scope="col" rowSpan={2} className="sticky left-0 z-40 border-b border-r border-border bg-background px-3 text-left align-bottom text-[11px] font-medium text-muted-foreground">
              <span className="block pb-1.5">{doc.useActuals ? "Past months show what Actual recorded" : "Worksheet (not using Actual)"}</span>
            </th>
            {years.map((band) => <th key={band.year} scope="colgroup" colSpan={band.span} className="h-6 border-b border-l border-border bg-muted px-2 text-left text-[11px] font-semibold"><span className="sticky inline-block" style={{ left: LABEL_WIDTH + 8 }}>{band.year}</span></th>)}
          </tr>
          <tr>
            {columns.map((c) => {
              if (c.kind === "year") return <th key={c.key} scope="col" className="h-8 border-b border-l border-border bg-muted px-2 text-right text-[11px] font-semibold">{c.partial ? "Total*" : "Total"}{c.partial && <span className="sr-only"> (not a full year in this plan)</span>}</th>;
              const kind = kinds[c.index];
              return (
                <th key={c.key} scope="col" className={cn("h-8 border-b border-border bg-background px-2 text-right align-middle font-medium", kind === "current" && "bg-[color-mix(in_oklab,var(--primary)_10%,var(--background))]", c.index === computed.currentIndex + 1 && computed.currentIndex >= 0 && "border-l")}>
                  <span className="block leading-tight">{monthShort(c.month)}</span>
                  <span className={cn("block text-[10px] font-normal leading-tight text-muted-foreground", kind === "current" && "font-medium text-foreground")}>{doc.useActuals ? KIND_LABEL[kind] : "Plan"}</span>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {lines.map((line, r) => {
            const inRange = range && r >= range.top && r <= range.bottom ? range : null;
            return (
              <GridLine
                key={line.key} line={line} rowNumber={r + 1} columns={columns} kinds={kinds} cents={cents} pastMode={pastMode} planTotals={planTotals}
                belowMinimum={line.kind === "balance" && line.key === "closing" ? computed.belowMinimum : null}
                activeCol={selection?.line === line.key ? selection.col ?? "" : null}
                rangeLeft={inRange ? inRange.left : -1} rangeRight={inRange ? inRange.right : -1}
                editing={editing?.line === line.key ? editing : null}
                problem={line.kind === "row" ? problems.get(line.row.id) ?? null : null}
                unlinked={line.kind === "row" && doc.useActuals && line.row.links.categories.length + line.row.links.categoryGroups.length + line.row.links.accounts.length === 0}
                handlers={handlers}
              />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

type LineProps = {
  line: Line; rowNumber: number; columns: Column[]; kinds: readonly MonthKind[]; cents: boolean; pastMode: PastMode;
  planTotals: ReadonlyMap<string, (number | null)[]> | null;
  belowMinimum: readonly boolean[] | null;
  /** The active column key on this line, "" when the line itself is selected, null when it is not. */
  activeCol: string | null;
  rangeLeft: number; rangeRight: number;
  editing: { col: string; text: string } | null;
  problem: string | null;
  unlinked: boolean;
  handlers: LineHandlers;
};

type LineHandlers = {
  select: (selection: GridSelection | null) => void;
  toggle: (key: string) => void;
  addRow: (section: SectionId, groupId: string | null) => void;
  startEdit: (line: string, col: string, text: string) => void;
  editText: (text: string) => void;
  commit: (text: string, target: { line: string; col: string }, move: "down" | "right" | null) => void;
  cancel: () => void;
  focusGrid: () => void;
};

const GridLine = memo(function GridLine({ line, rowNumber, columns, kinds, cents, pastMode, planTotals, belowMinimum, activeCol, rangeLeft, rangeRight, editing, problem, unlinked, handlers }: LineProps) {
  const { select: onSelect, toggle: onToggle, addRow: onAddRow, editText: onEditText, commit: onCommit, cancel: onCancel, focusGrid } = handlers;
  const onStartEdit = (col: string, text: string) => handlers.startEdit(line.key, col, text);
  const strong = line.kind === "section" || line.kind === "balance" || (line.kind === "memo" && (line.key === "net" || line.key === "total"));
  const band = line.kind === "section";
  const values = line.kind === "row" ? line.result.values : line.values;
  const label = line.kind === "row" ? line.row.name : line.kind === "group" ? line.group.name : line.label;
  const rowTone = cn(band && "bg-muted", line.kind === "balance" && "bg-muted/60");
  const selectLine = () => { onSelect({ line: line.key, col: null }); focusGrid(); };

  return (
    <tr aria-rowindex={rowNumber} className="group/line">
      <th
        scope="row"
        className={cn(
          "sticky left-0 z-20 h-7 border-b border-r border-border/60 bg-background p-0 text-left font-normal",
          rowTone, activeCol !== null && "bg-accent", line.kind === "balance" && line.key === "closing" && "border-t border-t-border",
        )}
      >
        <div className={cn("flex h-7 items-center gap-1 pr-1", line.kind === "row" ? (line.depth === 2 ? "pl-9" : "pl-6") : line.kind === "group" ? "pl-3" : line.kind === "unplanned" ? "pl-6" : "pl-1.5")}>
          {(line.kind === "section" || line.kind === "group") && (
            <button type="button" onClick={() => onToggle(line.key)} aria-expanded={!line.collapsed} aria-label={`${line.collapsed ? "Expand" : "Collapse"} ${label}`} className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground">
              {line.collapsed ? <ChevronRight className="size-3.5" aria-hidden /> : <ChevronDown className="size-3.5" aria-hidden />}
            </button>
          )}
          <button
            type="button" onClick={selectLine} title={label}
            className={cn("min-w-0 flex-1 truncate rounded-sm text-left outline-none focus-visible:ring-1 focus-visible:ring-ring", strong && "font-semibold", band && "text-[11px] uppercase tracking-wide", line.kind === "group" && "font-medium", line.kind === "unplanned" && "italic text-muted-foreground", line.kind === "memo" && !strong && "text-muted-foreground")}
          >
            {label}{line.kind === "group" && line.collapsed && <span className="ml-1.5 font-normal text-muted-foreground">{line.count}</span>}
          </button>
          {line.kind === "memo" && line.hint && <InfoHint label={label}>{line.hint}</InfoHint>}
          {problem && <span title={problem} className="shrink-0 text-amber-600 dark:text-amber-400"><AlertTriangle className="size-3.5" aria-hidden /><span className="sr-only">Needs attention: {problem}</span></span>}
          {unlinked && !problem && <span title="Not linked to Actual: past months show nothing for this row" className="shrink-0 text-muted-foreground/70"><Link2Off className="size-3.5" aria-hidden /><span className="sr-only">Not linked to Actual</span></span>}
          {(line.kind === "section" || line.kind === "group") && (
            <button type="button" onClick={() => onAddRow(line.kind === "section" ? line.section : line.group.section, line.kind === "group" ? line.group.id : null)} aria-label={`Add a row to ${label}`} title={`Add a row to ${label}`} className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover/line:opacity-100">
              <Plus className="size-3.5" aria-hidden />
            </button>
          )}
        </div>
      </th>
      {columns.map((column, c) => {
        const cellKey = `${line.key}|${column.key}`;
        const active = activeCol === column.key;
        const inRange = c >= rangeLeft && c <= rangeRight;
        if (column.kind === "year") {
          const total = aggregate(values, column.indexes, line.aggregate);
          return (
            <td key={column.key} data-cell={cellKey} role="gridcell" aria-selected={active} onMouseDown={(e) => { onSelect(e.shiftKey && activeCol ? { line: line.key, col: column.key, anchor: { line: line.key, col: activeCol } } : { line: line.key, col: column.key }); focusGrid(); }}
              className={cn("h-7 cursor-default border-b border-l border-border/60 bg-muted/50 px-2 text-right font-medium tabular-nums whitespace-nowrap", band && "bg-muted", strong && "font-semibold", inRange && "bg-accent", active && "outline outline-2 -outline-offset-2 outline-primary")}>
              {total === 0 && (line.kind === "row" || line.kind === "unplanned") ? "" : formatCell(total, cents)}
            </td>
          );
        }
        const kind = kinds[column.index];
        const value = monthValue(line, column.index, kind, pastMode, planTotals);
        const typed = line.kind === "row" && kind !== "actual" && line.row.cells[column.month] !== undefined;
        const below = belowMinimum?.[column.index] ?? false;
        const editable = isEditable(line, column, kinds);
        const diff = kind === "actual" && pastMode === "diff" && value !== null && line.kind !== "memo" && line.kind !== "balance";
        if (editing?.col === column.key) {
          return (
            <td key={column.key} data-cell={cellKey} role="gridcell" className="h-7 border-b border-border/40 p-0">
              <Input
                autoFocus value={editing.text} aria-label={`${label}, ${column.month}`} inputMode="decimal"
                onChange={(e) => onEditText(e.target.value)}
                onFocus={(e) => { const end = e.target.value.length; e.target.setSelectionRange(end, end); }}
                onBlur={(e) => onCommit(e.target.value, { line: line.key, col: column.key }, null)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); onCommit(e.currentTarget.value, { line: line.key, col: column.key }, "down"); }
                  else if (e.key === "Tab") { e.preventDefault(); onCommit(e.currentTarget.value, { line: line.key, col: column.key }, "right"); }
                  else if (e.key === "Escape") { e.preventDefault(); onCancel(); }
                }}
                className="h-7 rounded-none border-0 bg-background px-2 text-right text-xs tabular-nums outline outline-2 -outline-offset-2 outline-primary focus-visible:ring-0"
              />
            </td>
          );
        }
        return (
          <td
            key={column.key} data-cell={cellKey} role="gridcell" aria-selected={active} aria-readonly={!editable}
            onMouseDown={(e) => { onSelect(e.shiftKey && activeCol ? { line: line.key, col: column.key, anchor: { line: line.key, col: activeCol } } : { line: line.key, col: column.key }); focusGrid(); }}
            onDoubleClick={() => { if (editable && line.kind === "row") { const cell = line.row.cells[column.month]; onStartEdit(column.key, cell !== undefined ? (cell / 100).toFixed(2) : ""); } }}
            title={typed ? "Typed amount (overrides the forecast)" : undefined}
            className={cn(
              "relative h-7 cursor-default border-b border-border/40 px-2 text-right tabular-nums whitespace-nowrap",
              kind === "actual" && "bg-muted/30", kind === "current" && "bg-primary/[0.06]", rowTone,
              strong && "font-semibold", line.kind === "group" && "font-medium", (line.kind === "unplanned" || (line.kind === "memo" && !strong)) && "text-muted-foreground",
              typed && "font-semibold", below && "text-destructive", line.kind === "balance" && line.key === "closing" && "border-t border-t-border",
              diff && value! > 0 && "text-amber-700 dark:text-amber-400",
              inRange && "bg-accent", active && "outline outline-2 -outline-offset-2 outline-primary",
            )}
          >
            {typed && <span aria-hidden className="absolute right-0 top-0 size-0 border-4 border-transparent border-r-primary/70 border-t-primary/70" />}
            {below && <TrendingDown className="mr-1 inline size-3 align-[-1px]" aria-label="Below the minimum cash" />}
            {value === null ? <span className="text-muted-foreground">-</span> : value === 0 && (line.kind === "row" || line.kind === "unplanned") ? "" : `${diff && value > 0 ? "+" : ""}${formatCell(value, cents)}`}
          </td>
        );
      })}
    </tr>
  );
});
