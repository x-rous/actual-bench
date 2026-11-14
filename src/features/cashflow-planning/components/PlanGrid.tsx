"use client";

import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowLeftRight, ChevronDown, ChevronRight, Link2Off, Plus, TrendingDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { InfoHint } from "@/components/ui/info-hint";
import { Input } from "@/components/ui/input";
import { SearchInput } from "@/components/ui/search-input";
import { NAME_MAX, parseAmount } from "@/lib/cashflow-planning/document";
import type { Computed, MonthKind } from "@/lib/cashflow-planning/engine";
import { monthShort } from "@/lib/cashflow-planning/months";
import type { Month, PlanDocument, SectionId } from "@/lib/cashflow-planning/types";
import { aggregate, formatCell, isPinned, lineKey, type Column, type Line } from "../lib/view";

export type PastMode = "actual" | "plan" | "diff";

/** The active cell (or a whole line when `col` is null) and, for a range, the cell it was started from. */
export type GridSelection = { line: string; col: string | null; anchor?: { line: string; col: string } };

export type CellEdit = { rowId: string; month: Month; amount: number | null };

/** What the grid asks the workspace to do beyond typing amounts. */
export type GridCommand =
  | { type: "addRow"; section: SectionId; groupId: string | null; afterRowId?: string }
  | { type: "rename"; line: string; name: string }
  | { type: "move"; line: string; direction: -1 | 1 }
  | { type: "deleteRow"; rowId: string }
  | { type: "dropRow"; rowId: string; beforeRowId: string }
  /** A row dropped on a section or group heading joins it. */
  | { type: "dropInto"; rowId: string; section: SectionId; groupId: string | null }
  | { type: "fill"; rowId: string; month: Month; to: "year" | "plan" }
  | { type: "clearFrom"; rowId: string; month: Month }
  | { type: "transactions"; line: string; col: string }
  | { type: "help" };

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
  /** `lineKey|month` of the cells a transaction counted in another month left or joined. */
  shiftedCells: ReadonlySet<string>;
  find: string;
  onFind: (text: string) => void;
  /** Changes whenever the grid should bring the current month into view. */
  scrollToken: number;
  onSelect: (selection: GridSelection | null) => void;
  onToggle: (key: string) => void;
  onEdit: (edits: CellEdit[]) => void;
  onCommand: (command: GridCommand) => void;
  /** Says what a paste or fill did, when not everything could be applied. */
  onNotice: (message: string) => void;
};

const LABEL_WIDTH = 288;
const PAGE = 12;
const KIND_LABEL: Record<MonthKind, string> = { actual: "Actual", current: "This month", forecast: "Forecast" };

/** What a line shows in a month. `null` is "nothing to show" (never zero). */
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
const sectionOfLine = (line: Line): SectionId | null => (line.kind === "row" ? line.row.section : line.kind === "group" ? line.group.section : line.kind === "section" || line.kind === "unplanned" ? line.section : null);
const labelOf = (line: Line): string => (line.kind === "row" ? line.row.name : line.kind === "group" ? line.group.name : line.label);

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

type Menu = { x: number; y: number; line: string; col: string | null };

export function PlanGrid({ doc, computed, lines, columns, cents, pastMode, selection, problems, shiftedCells, find, onFind, scrollToken, onSelect, onToggle, onEdit, onCommand, onNotice }: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState<{ line: string; col: string; text: string } | null>(null);
  const [renaming, setRenaming] = useState<{ line: string; text: string } | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  /** While the fill handle is dragged: the column the fill reaches. */
  const [fillTo, setFillTo] = useState<number | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
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

  // Open on the current month (one month of history beside it), and again whenever asked.
  const monthWidth = cents ? 104 : 88;
  useEffect(() => {
    const el = scroller.current;
    const th = el?.querySelector<HTMLElement>('th[data-now="true"]');
    if (el && th) el.scrollLeft = Math.max(0, th.offsetLeft - LABEL_WIDTH - monthWidth);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when asked: not on every change of width or columns
  }, [scrollToken]);

  const focusGrid = () => scroller.current?.focus();

  /** Every cell in the range that takes a typed amount. */
  const editableInRange = () => {
    if (!range) return [];
    const cells: { rowId: string; month: Month; row: number; col: number }[] = [];
    for (let r = range.top; r <= range.bottom; r++) for (let c = range.left; c <= range.right; c++) {
      const line = lines[r], column = columns[c];
      if (line.kind === "row" && column.kind === "month" && isEditable(line, column, kinds)) cells.push({ rowId: line.row.id, month: column.month, row: r, col: c });
    }
    return cells;
  };

  const go = (row: number, col: number | null, extend: boolean) => {
    const r = Math.min(lines.length - 1, Math.max(0, row));
    if (col === null || col < 0) { onSelect({ line: lines[r].key, col: null }); return; }
    const c = Math.min(columns.length - 1, col);
    const next = { line: lines[r].key, col: columns[c].key };
    const anchor = extend && selection?.col ? selection.anchor ?? { line: selection.line, col: selection.col } : undefined;
    onSelect(anchor ? { ...next, anchor } : next);
  };

  const position = (from?: { line: string; col: string | null } | null) => {
    const current = from ?? selection;
    if (!current) return null;
    return { row: lineIndex.get(current.line) ?? 0, col: current.col ? colIndex.get(current.col) ?? 0 : null };
  };

  const step = (dRow: number, dCol: number, extend: boolean, from?: { line: string; col: string | null }) => {
    const at = position(from);
    if (!at) { if (lines.length && columns.length) go(0, 0, false); return; }
    // The row label sits left of the first month: Left from the first column reaches it, Right leaves it.
    const col = at.col === null ? (dCol > 0 ? 0 : null) : at.col + dCol;
    go(at.row + dRow, col, extend);
  };

  const commit = (text: string, target: { line: string; col: string }, move: "down" | "right" | "all" | null) => {
    const line = lines[lineIndex.get(target.line) ?? -1];
    const column = columns[colIndex.get(target.col) ?? -1];
    setEditing(null);
    if (line?.kind === "row" && column?.kind === "month") {
      const trimmed = text.trim();
      const amount = trimmed === "" ? null : parseAmount(trimmed);
      if (trimmed !== "" && amount === null) onNotice(`"${trimmed}" is not an amount`);
      // Ctrl+Enter types the amount into every cell of the selection.
      else if (move === "all" && range) onEdit(editableInRange().map((c) => ({ rowId: c.rowId, month: c.month, amount })));
      else onEdit([{ rowId: line.row.id, month: column.month, amount }]);
    }
    if (move === "down" || move === "right") step(move === "down" ? 1 : 0, move === "right" ? 1 : 0, false, target);
    focusGrid();
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

  /** Repeats the selected columns' amounts to the right, up to column `to`. */
  const fillRight = (to: number) => {
    if (!range) return;
    const edits: CellEdit[] = [];
    // Ctrl+R inside a selection copies its first column; the fill handle repeats the whole selection outwards.
    const inside = to <= range.right;
    const width = inside ? 1 : range.right - range.left + 1;
    const start = inside ? range.left + 1 : range.right + 1;
    for (let r = range.top; r <= range.bottom; r++) {
      const line = lines[r];
      if (line.kind !== "row") continue;
      for (let c = start; c <= to; c++) {
        const column = columns[c], source = columns[range.left + ((c - start) % width)];
        if (column?.kind === "month" && source?.kind === "month" && isEditable(line, column, kinds)) edits.push({ rowId: line.row.id, month: column.month, amount: line.result.values[source.index] });
      }
    }
    if (edits.length) onEdit(edits);
  };

  const fillDown = () => {
    if (!range || range.top === range.bottom) return;
    const first = lines[range.top];
    if (first.kind !== "row") return;
    const edits: CellEdit[] = [];
    for (let r = range.top + 1; r <= range.bottom; r++) {
      const line = lines[r];
      if (line.kind !== "row") continue;
      for (let c = range.left; c <= range.right; c++) {
        const column = columns[c];
        if (column.kind === "month" && isEditable(line, column, kinds)) edits.push({ rowId: line.row.id, month: column.month, amount: first.result.values[column.index] });
      }
    }
    if (edits.length) onEdit(edits);
  };

  const startRename = (line: Line) => { if (line.kind === "row" || line.kind === "group") setRenaming({ line: line.key, text: labelOf(line) }); };
  const addBelow = (line: Line) => {
    const section = sectionOfLine(line);
    if (!section) return;
    onCommand({ type: "addRow", section, groupId: line.kind === "row" ? line.row.groupId : line.kind === "group" ? line.group.id : null, afterRowId: line.kind === "row" ? line.row.id : undefined });
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (editing || renaming || event.target !== event.currentTarget) return;
    if (menu) { if (event.key === "Escape") { event.preventDefault(); setMenu(null); } return; }
    const mod = event.ctrlKey || event.metaKey;
    const at = position();
    const line = at ? lines[at.row] : null;
    const column = at && at.col !== null ? columns[at.col] : null;
    const startEdit = (text: string | null) => {
      if (!line || !column || line.kind !== "row" || column.kind !== "month" || !isEditable(line, column, kinds)) return false;
      const typed = line.row.cells[column.month];
      setEditing({ line: line.key, col: column.key, text: text ?? (typed !== undefined ? (typed / 100).toFixed(2) : "") });
      return true;
    };
    const collapsible = line && (line.kind === "section" || line.kind === "group") ? line : null;
    const last = columns.length - 1;
    switch (event.key) {
      case "ArrowDown":
      case "ArrowUp": {
        event.preventDefault();
        const d = event.key === "ArrowDown" ? 1 : -1;
        if (event.altKey && line && (line.kind === "row" || line.kind === "group")) onCommand({ type: "move", line: line.key, direction: d });
        else if (mod && at) go(d > 0 ? lines.length - 1 : 0, at.col, event.shiftKey);
        else step(d, 0, event.shiftKey);
        return;
      }
      case "ArrowRight":
      case "ArrowLeft": {
        event.preventDefault();
        const d = event.key === "ArrowRight" ? 1 : -1;
        // On a section or group label, Right opens it and Left closes it, as in a tree.
        if (at?.col === null && collapsible && collapsible.collapsed === (d > 0)) onToggle(collapsible.key);
        else if (mod && at) go(at.row, d > 0 ? last : 0, event.shiftKey);
        else step(0, d, event.shiftKey);
        return;
      }
      case "Home": event.preventDefault(); if (at) go(mod ? 0 : at.row, 0, event.shiftKey); return;
      case "End": event.preventDefault(); if (at) go(mod ? lines.length - 1 : at.row, last, event.shiftKey); return;
      case "PageDown": event.preventDefault(); step(PAGE, 0, event.shiftKey); return;
      case "PageUp": event.preventDefault(); step(-PAGE, 0, event.shiftKey); return;
      case "Tab": if (selection?.col) { event.preventDefault(); step(0, event.shiftKey ? -1 : 1, false); } return;
      case " ": if (collapsible) { event.preventDefault(); onToggle(collapsible.key); } return;
      case "Enter": if (startEdit(null)) event.preventDefault(); else if (collapsible) { event.preventDefault(); onToggle(collapsible.key); } return;
      case "F2": event.preventDefault(); if (at?.col === null && line) startRename(line); else startEdit(null); return;
      case "Insert": if (line) { event.preventDefault(); addBelow(line); } return;
      case "Escape": event.preventDefault(); onSelect(selection?.anchor ? { line: selection.line, col: selection.col } : null); return;
      case "Delete":
      case "Backspace": {
        const cells = editableInRange();
        if (cells.length) { event.preventDefault(); onEdit(cells.map((c) => ({ rowId: c.rowId, month: c.month, amount: null }))); }
        return;
      }
      case "?": event.preventDefault(); onCommand({ type: "help" }); return;
    }
    const k = event.key.toLowerCase();
    if (mod && k === "c") { event.preventDefault(); void copy(); return; }
    if (mod && k === "r") { event.preventDefault(); if (range) fillRight(range.right); return; }
    if (mod && k === "d") { event.preventDefault(); fillDown(); return; }
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

  // With only year columns there is room to spare: wider columns read better than a narrow block.
  const yearWidth = columns.every((c) => c.kind === "year") ? 136 : monthWidth + 12;

  // The lines are memoized, so they are handed callbacks that never change and reach the latest state through a ref.
  const dragging = useRef<"select" | "fill" | null>(null);
  const latest = useRef({ commit, onSelect, onToggle, onCommand, selection, range, fillRight, fillTo, startRename, lines, lineIndex, colIndex });
  useLayoutEffect(() => { latest.current = { commit, onSelect, onToggle, onCommand, selection, range, fillRight, fillTo, startRename, lines, lineIndex, colIndex }; });
  useEffect(() => {
    const up = () => {
      if (dragging.current === "fill") { const { fillTo: to, range: r, fillRight: fill } = latest.current; if (to !== null && r && to > r.right) fill(to); setFillTo(null); }
      dragging.current = null;
    };
    window.addEventListener("mouseup", up);
    return () => window.removeEventListener("mouseup", up);
  }, []);
  const handlers = useMemo((): LineHandlers => ({
    toggle: (key) => latest.current.onToggle(key),
    command: (command) => latest.current.onCommand(command),
    selectLine: (line) => { latest.current.onSelect({ line, col: null }); scroller.current?.focus(); },
    cellDown: (line, col, event) => {
      if (event.button !== 0) return;
      const current = latest.current.selection;
      latest.current.onSelect(event.shiftKey && current?.col ? { line, col, anchor: current.anchor ?? { line: current.line, col: current.col } } : { line, col });
      dragging.current = "select";
      scroller.current?.focus();
    },
    cellEnter: (line, col) => {
      const { selection: current, colIndex: cols, range: r } = latest.current;
      if (dragging.current === "select" && current?.col) latest.current.onSelect({ line, col, anchor: current.anchor ?? { line: current.line, col: current.col } });
      else if (dragging.current === "fill" && r) setFillTo(Math.max(r.right, cols.get(col) ?? r.right));
    },
    fillStart: () => { dragging.current = "fill"; },
    startEdit: (line, col, text) => setEditing({ line, col, text }),
    editText: (text) => setEditing((e) => (e ? { ...e, text } : e)),
    commit: (text, target, move) => latest.current.commit(text, target, move),
    cancel: () => { setEditing(null); scroller.current?.focus(); },
    startRename: (line) => { const found = latest.current.lines[latest.current.lineIndex.get(line) ?? -1]; if (found) latest.current.startRename(found); },
    renameText: (text) => setRenaming((r) => (r ? { ...r, text } : r)),
    renameDone: (save, line, text) => {
      setRenaming(null);
      if (save && text.trim()) latest.current.onCommand({ type: "rename", line, name: text.trim() });
      scroller.current?.focus();
    },
    menu: (line, col, event) => {
      event.preventDefault();
      const current = latest.current.selection;
      // A right-click outside the selection moves it there; inside, the selection is kept so the menu can act on it.
      const r = latest.current.range, row = latest.current.lineIndex.get(line), c = col ? latest.current.colIndex.get(col) : undefined;
      const inside = !!r && row !== undefined && c !== undefined && row >= r.top && row <= r.bottom && c >= r.left && c <= r.right;
      if (!inside && (!current || current.line !== line || current.col !== col)) latest.current.onSelect({ line, col });
      setMenu({ x: event.clientX, y: event.clientY, line, col });
    },
    dropOver: (line) => setDropTarget(line),
  }), []);

  const body = lines.filter((l) => !isPinned(l)), pinned = lines.filter(isPinned);
  const renderLine = (line: Line) => {
    const r = lineIndex.get(line.key)!;
    const inRange = range && r >= range.top && r <= range.bottom ? range : null;
    return (
      <GridLine
        key={line.key} line={line} rowNumber={r + 1} columns={columns} kinds={kinds} cents={cents} pastMode={pastMode} planTotals={planTotals}
        belowMinimum={line.kind === "balance" && line.key === "closing" ? computed.belowMinimum : null}
        activeCol={selection?.line === line.key ? selection.col ?? "" : null}
        rangeLeft={inRange ? inRange.left : -1} rangeRight={inRange ? inRange.right : -1}
        fillRight={inRange && fillTo !== null ? fillTo : -1}
        handleAt={inRange && r === inRange.bottom && line.kind === "row" ? inRange.right : -1}
        editing={editing?.line === line.key ? editing : null}
        renaming={renaming?.line === line.key ? renaming.text : null}
        problem={line.kind === "row" ? problems.get(line.row.id) ?? null : null}
        unlinked={line.kind === "row" && doc.useActuals && line.row.links.categories.length + line.row.links.categoryGroups.length + line.row.links.accounts.length === 0}
        shiftedCells={shiftedCells} dropTarget={dropTarget === line.key}
        handlers={handlers}
      />
    );
  };

  return (
    <div
      ref={scroller} tabIndex={0} role="grid" aria-label="Cash plan" aria-rowcount={lines.length} onKeyDown={onKeyDown}
      onPaste={(event) => { if (!editing && !renaming && event.target === event.currentTarget) { event.preventDefault(); paste(event.clipboardData.getData("text/plain")); } }}
      className="relative min-h-0 flex-1 overflow-auto outline-none focus-visible:ring-1 focus-visible:ring-ring/60"
      style={{ scrollPaddingLeft: LABEL_WIDTH, scrollPaddingTop: 56, scrollPaddingBottom: 58 }}
    >
      <table className="border-separate border-spacing-0 text-xs select-none">
        <colgroup>
          <col style={{ width: LABEL_WIDTH, minWidth: LABEL_WIDTH }} />
          {columns.map((c) => <col key={c.key} style={{ width: c.kind === "year" ? yearWidth : monthWidth, minWidth: c.kind === "year" ? yearWidth : monthWidth }} />)}
        </colgroup>
        <thead className="sticky top-0 z-30">
          <tr>
            <th scope="col" rowSpan={2} className="sticky left-0 z-40 border-b border-r border-border bg-background px-2 text-left align-bottom font-normal">
              <div className="pb-1"><SearchInput value={find} onValueChange={onFind} placeholder="Find a row" aria-label="Find a row by name" className="h-7 w-full text-xs" /></div>
            </th>
            {years.map((band) => <th key={band.year} scope="colgroup" colSpan={band.span} className="h-6 border-b border-l border-border bg-muted px-2 text-left text-[11px] font-semibold"><span className="sticky inline-block" style={{ left: LABEL_WIDTH + 8 }}>{band.year}</span></th>)}
          </tr>
          <tr>
            {columns.map((c) => {
              if (c.kind === "year") return <th key={c.key} scope="col" className="h-8 border-b border-l border-border bg-muted px-2 text-right text-[11px] font-semibold">{c.partial ? "Total*" : "Total"}{c.partial && <span className="sr-only"> (not a full year in this plan)</span>}</th>;
              const kind = kinds[c.index];
              return (
                <th key={c.key} scope="col" data-now={kind === "current" || undefined} className={cn("h-8 border-b border-border bg-background px-2 text-right align-middle font-medium", kind === "current" && "bg-[color-mix(in_oklab,var(--primary)_10%,var(--background))]", c.index === computed.currentIndex + 1 && computed.currentIndex >= 0 && "border-l")}>
                  <span className="block leading-tight">{monthShort(c.month)}</span>
                  <span className={cn("block text-[10px] font-normal leading-tight text-muted-foreground", kind === "current" && "font-medium text-foreground")}>{doc.useActuals ? KIND_LABEL[kind] : "Plan"}</span>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {body.map(renderLine)}
          {find.trim() !== "" && !body.some((l) => l.kind === "row") && <tr><td colSpan={columns.length + 1} className="px-3 py-4 text-muted-foreground">No row is named like “{find.trim()}”.</td></tr>}
        </tbody>
        {/* What everything above adds up to stays in view. */}
        <tfoot className="sticky bottom-0 z-30 shadow-[0_-1px_0_var(--border)]">{pinned.map(renderLine)}</tfoot>
      </table>
      {menu && <ContextMenu menu={menu} lines={lines} columns={columns} kinds={kinds} onClose={() => { setMenu(null); focusGrid(); }} onCommand={onCommand} onRename={(line) => startRename(line)} onAddBelow={addBelow} onClear={() => { const cells = editableInRange(); if (cells.length) onEdit(cells.map((c) => ({ rowId: c.rowId, month: c.month, amount: null }))); }} onCopy={() => void copy()} />}
    </div>
  );
}

// ─── Right-click menu ────────────────────────────────────────────────────────

function ContextMenu({ menu, lines, columns, kinds, onClose, onCommand, onRename, onAddBelow, onClear, onCopy }: { menu: Menu; lines: Line[]; columns: Column[]; kinds: readonly MonthKind[]; onClose: () => void; onCommand: (command: GridCommand) => void; onRename: (line: Line) => void; onAddBelow: (line: Line) => void; onClear: () => void; onCopy: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const line = lines.find((l) => l.key === menu.line);
  const column = menu.col ? columns.find((c) => c.key === menu.col) : undefined;
  const close = useRef(onClose);
  useLayoutEffect(() => { close.current = onClose; });
  useEffect(() => {
    box.current?.querySelector<HTMLElement>("button")?.focus();
    const away = (event: MouseEvent) => { if (!box.current?.contains(event.target as Node)) close.current(); };
    window.addEventListener("mousedown", away);
    return () => window.removeEventListener("mousedown", away);
  }, []);
  if (!line) return null;
  const month = column?.kind === "month" ? column : null;
  const editable = !!month && isEditable(line, month, kinds);
  const past = !!column && (column.kind === "year" || kinds[column.index] !== "forecast");
  const items: ({ label: string; run: () => void; danger?: boolean } | "separator")[] = [];
  if (line.kind === "row" && month && editable) {
    items.push({ label: "Fill to the end of the year", run: () => onCommand({ type: "fill", rowId: line.row.id, month: month.month, to: "year" }) });
    items.push({ label: "Fill to the end of the plan", run: () => onCommand({ type: "fill", rowId: line.row.id, month: month.month, to: "plan" }) });
    items.push({ label: "Clear typed amounts in the selection", run: onClear });
    items.push({ label: "Clear typed amounts from here on", run: () => onCommand({ type: "clearFrom", rowId: line.row.id, month: month.month }) });
    items.push("separator");
  }
  if (column) items.push({ label: "Copy", run: onCopy });
  if ((line.kind === "row" || line.kind === "unplanned") && column && past) items.push({ label: "Show the transactions", run: () => onCommand({ type: "transactions", line: line.key, col: column.key }) });
  if (line.kind === "row" || line.kind === "group" || line.kind === "section") {
    if (items.length) items.push("separator");
    items.push({ label: line.kind === "row" ? "Add a row below" : "Add a row here", run: () => onAddBelow(line) });
    if (line.kind !== "section") {
      items.push({ label: "Rename", run: () => onRename(line) });
      items.push({ label: "Move up", run: () => onCommand({ type: "move", line: line.key, direction: -1 }) });
      items.push({ label: "Move down", run: () => onCommand({ type: "move", line: line.key, direction: 1 }) });
    }
    if (line.kind === "row") { items.push("separator"); items.push({ label: "Delete row", danger: true, run: () => onCommand({ type: "deleteRow", rowId: line.row.id }) }); }
  }
  if (items.length === 0) return null;
  const move = (event: React.KeyboardEvent) => {
    const buttons = [...(box.current?.querySelectorAll<HTMLElement>("button") ?? [])];
    const at = buttons.indexOf(document.activeElement as HTMLElement);
    if (event.key === "ArrowDown") { event.preventDefault(); buttons[(at + 1) % buttons.length]?.focus(); }
    else if (event.key === "ArrowUp") { event.preventDefault(); buttons[(at - 1 + buttons.length) % buttons.length]?.focus(); }
    else if (event.key === "Escape" || event.key === "Tab") { event.preventDefault(); event.stopPropagation(); onClose(); }
  };
  return (
    <div
      ref={box} role="menu" aria-label={`Actions for ${labelOf(line)}`} onKeyDown={move}
      className="fixed z-[80] min-w-56 rounded-lg bg-popover p-1 text-sm text-popover-foreground shadow-lg ring-1 ring-foreground/10"
      style={{ left: Math.min(menu.x, window.innerWidth - 260), top: Math.min(menu.y, window.innerHeight - items.length * 30 - 16) }}
    >
      {items.map((item, i) => item === "separator" ? <div key={i} role="separator" className="my-1 h-px bg-border" /> : (
        <button key={i} type="button" role="menuitem" onClick={() => { onClose(); item.run(); }} className={cn("flex w-full rounded-md px-2 py-1 text-left outline-none hover:bg-accent focus-visible:bg-accent", item.danger && "text-destructive")}>{item.label}</button>
      ))}
    </div>
  );
}

// ─── One line ────────────────────────────────────────────────────────────────

type LineHandlers = {
  toggle: (key: string) => void;
  command: (command: GridCommand) => void;
  selectLine: (line: string) => void;
  cellDown: (line: string, col: string, event: React.MouseEvent) => void;
  cellEnter: (line: string, col: string) => void;
  fillStart: () => void;
  startEdit: (line: string, col: string, text: string) => void;
  editText: (text: string) => void;
  commit: (text: string, target: { line: string; col: string }, move: "down" | "right" | "all" | null) => void;
  cancel: () => void;
  startRename: (line: string) => void;
  renameText: (text: string) => void;
  renameDone: (save: boolean, line: string, text: string) => void;
  menu: (line: string, col: string | null, event: React.MouseEvent) => void;
  dropOver: (line: string | null) => void;
};

type LineProps = {
  line: Line; rowNumber: number; columns: Column[]; kinds: readonly MonthKind[]; cents: boolean; pastMode: PastMode;
  planTotals: ReadonlyMap<string, (number | null)[]> | null;
  belowMinimum: readonly boolean[] | null;
  /** The active column key on this line, "" when the line itself is selected, null when it is not. */
  activeCol: string | null;
  rangeLeft: number; rangeRight: number;
  /** While the fill handle is dragged: the last column the fill reaches on this line (-1 when none). */
  fillRight: number;
  /** The column whose cell carries the fill handle (-1 when none). */
  handleAt: number;
  editing: { col: string; text: string } | null;
  renaming: string | null;
  problem: string | null;
  unlinked: boolean;
  shiftedCells: ReadonlySet<string>;
  dropTarget: boolean;
  handlers: LineHandlers;
};

const ROW_MIME = "application/x-cashflow-row";

const GridLine = memo(function GridLine({ line, rowNumber, columns, kinds, cents, pastMode, planTotals, belowMinimum, activeCol, rangeLeft, rangeRight, fillRight, handleAt, editing, renaming, problem, unlinked, shiftedCells, dropTarget, handlers }: LineProps) {
  const strong = line.kind === "section" || line.kind === "balance" || (line.kind === "memo" && (line.key === "net" || line.key === "total"));
  const band = line.kind === "section";
  const pinned = isPinned(line);
  const values = line.kind === "row" ? line.result.values : line.values;
  const label = labelOf(line);
  const section = sectionOfLine(line);
  // Pinned lines sit over the scrolling ones, so their background must be opaque.
  const droppable = line.kind === "row" || line.kind === "group" || line.kind === "section";
  const rowTone = cn(band && "bg-muted", line.kind === "balance" && (pinned ? "bg-[color-mix(in_oklab,var(--muted)_60%,var(--background))]" : "bg-muted/60"));

  return (
    <tr aria-rowindex={rowNumber} className="group/line">
      <th
        scope="row"
        onContextMenu={(e) => handlers.menu(line.key, null, e)}
        onDragOver={droppable ? (e) => { if (e.dataTransfer.types.includes(ROW_MIME)) { e.preventDefault(); handlers.dropOver(line.key); } } : undefined}
        onDragLeave={droppable ? () => handlers.dropOver(null) : undefined}
        onDrop={droppable ? (e) => {
          e.preventDefault(); handlers.dropOver(null);
          const rowId = e.dataTransfer.getData(ROW_MIME);
          if (!rowId) return;
          if (line.kind === "row") { if (rowId !== line.row.id) handlers.command({ type: "dropRow", rowId, beforeRowId: line.row.id }); }
          else if (line.kind === "group") handlers.command({ type: "dropInto", rowId, section: line.group.section, groupId: line.group.id });
          else if (line.kind === "section") handlers.command({ type: "dropInto", rowId, section: line.section, groupId: null });
        } : undefined}
        className={cn("sticky left-0 z-20 h-7 border-b border-r border-border/60 bg-background p-0 text-left font-normal", rowTone, activeCol !== null && "bg-accent", activeCol === "" && "shadow-[inset_2px_0_0_var(--primary)]", dropTarget && "shadow-[inset_0_2px_0_var(--primary)]")}
      >
        <div className={cn("flex h-7 items-center gap-1 pr-1", line.kind === "row" ? (line.depth === 2 ? "pl-9" : "pl-6") : line.kind === "group" ? "pl-3" : line.kind === "unplanned" ? "pl-6" : "pl-1.5")}>
          {(line.kind === "section" || line.kind === "group") && (
            <button type="button" tabIndex={-1} onClick={() => handlers.toggle(line.key)} aria-expanded={!line.collapsed} aria-label={`${line.collapsed ? "Expand" : "Collapse"} ${label}`} className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground">
              {line.collapsed ? <ChevronRight className="size-3.5" aria-hidden /> : <ChevronDown className="size-3.5" aria-hidden />}
            </button>
          )}
          {renaming !== null ? (
            <Input
              autoFocus size="sm" aria-label={`Rename ${label}`} maxLength={NAME_MAX} value={renaming} className="h-6 min-w-0 flex-1 px-1.5"
              onChange={(e) => handlers.renameText(e.target.value)} onFocus={(e) => e.target.select()} onBlur={(e) => handlers.renameDone(true, line.key, e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handlers.renameDone(true, line.key, e.currentTarget.value); } else if (e.key === "Escape") { e.preventDefault(); handlers.renameDone(false, line.key, ""); } }}
            />
          ) : (
            <button
              type="button" tabIndex={-1} title={line.kind === "row" ? `${label} (drag to move, double-click to rename)` : label}
              onClick={() => handlers.selectLine(line.key)} onDoubleClick={() => handlers.startRename(line.key)}
              draggable={line.kind === "row"} onDragStart={line.kind === "row" ? (e) => { e.dataTransfer.setData(ROW_MIME, line.row.id); e.dataTransfer.effectAllowed = "move"; } : undefined}
              className={cn("min-w-0 flex-1 truncate rounded-sm text-left outline-none", strong && "font-semibold", band && "text-[11px] uppercase tracking-wide", line.kind === "group" && "font-medium", line.kind === "unplanned" && "italic text-muted-foreground", line.kind === "memo" && !strong && "text-muted-foreground")}
            >
              {label}{line.kind === "group" && line.collapsed && <span className="ml-1.5 font-normal text-muted-foreground">{line.count}</span>}
            </button>
          )}
          {line.kind === "memo" && line.hint && <InfoHint label={label}>{line.hint}</InfoHint>}
          {problem && <span title={problem} className="shrink-0 text-amber-600 dark:text-amber-400"><AlertTriangle className="size-3.5" aria-hidden /><span className="sr-only">Needs attention: {problem}</span></span>}
          {unlinked && !problem && <span title="Not linked to Actual: past months show nothing for this row" className="shrink-0 text-muted-foreground/70"><Link2Off className="size-3.5" aria-hidden /><span className="sr-only">Not linked to Actual</span></span>}
          {(line.kind === "section" || line.kind === "group") && (
            <button type="button" tabIndex={-1} onClick={() => handlers.command({ type: "addRow", section: line.kind === "section" ? line.section : line.group.section, groupId: line.kind === "group" ? line.group.id : null })} aria-label={`Add a row to ${label}`} title={`Add a row to ${label}`} className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover/line:opacity-100">
              <Plus className="size-3.5" aria-hidden />
            </button>
          )}
        </div>
      </th>
      {columns.map((column, c) => {
        const cellKey = `${line.key}|${column.key}`;
        const active = activeCol === column.key;
        const inRange = c >= rangeLeft && c <= rangeRight;
        const inFill = fillRight >= 0 && c > rangeRight && c <= fillRight;
        const mouse = { onMouseDown: (e: React.MouseEvent) => handlers.cellDown(line.key, column.key, e), onMouseEnter: () => handlers.cellEnter(line.key, column.key), onContextMenu: (e: React.MouseEvent) => handlers.menu(line.key, column.key, e) };
        if (column.kind === "year") {
          const total = aggregate(values, column.indexes, line.aggregate);
          return (
            <td key={column.key} data-cell={cellKey} role="gridcell" aria-selected={active} {...mouse}
              className={cn("h-7 cursor-default border-b border-l border-border/60 px-2 text-right font-medium tabular-nums whitespace-nowrap", pinned ? "bg-muted" : "bg-muted/50", band && "bg-muted", strong && "font-semibold", inRange && "bg-accent", active && "outline outline-2 -outline-offset-2 outline-primary")}>
              {total === 0 && (line.kind === "row" || line.kind === "unplanned") ? "" : formatCell(total, cents)}
            </td>
          );
        }
        const kind = kinds[column.index];
        const value = monthValue(line, column.index, kind, pastMode, planTotals);
        const typed = line.kind === "row" && kind !== "actual" && line.row.cells[column.month] !== undefined;
        const below = belowMinimum?.[column.index] ?? false;
        const editable = isEditable(line, column, kinds);
        const diff = kind === "actual" && pastMode === "diff" && value !== null && value !== 0 && section !== null;
        // More income than planned is good; more spending, saving or repaying than planned uses more cash.
        const better = diff && (section === "income" ? value! > 0 : value! < 0);
        const shifted = shiftedCells.has(`${line.key}|${column.month}`);
        if (editing?.col === column.key) {
          return (
            <td key={column.key} data-cell={cellKey} role="gridcell" className="h-7 border-b border-border/40 p-0">
              <Input
                autoFocus value={editing.text} aria-label={`${label}, ${column.month}`} inputMode="decimal"
                onChange={(e) => handlers.editText(e.target.value)}
                onFocus={(e) => { const end = e.target.value.length; e.target.setSelectionRange(end, end); }}
                onBlur={(e) => handlers.commit(e.target.value, { line: line.key, col: column.key }, null)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); handlers.commit(e.currentTarget.value, { line: line.key, col: column.key }, e.ctrlKey || e.metaKey ? "all" : "down"); }
                  else if (e.key === "Tab") { e.preventDefault(); handlers.commit(e.currentTarget.value, { line: line.key, col: column.key }, "right"); }
                  else if (e.key === "Escape") { e.preventDefault(); handlers.cancel(); }
                }}
                className="h-7 rounded-none border-0 bg-background px-2 text-right text-xs tabular-nums outline outline-2 -outline-offset-2 outline-primary focus-visible:ring-0"
              />
            </td>
          );
        }
        return (
          <td
            key={column.key} data-cell={cellKey} role="gridcell" aria-selected={active} aria-readonly={!editable} {...mouse}
            onDoubleClick={() => { if (editable && line.kind === "row") { const cell = line.row.cells[column.month]; handlers.startEdit(line.key, column.key, cell !== undefined ? (cell / 100).toFixed(2) : ""); } }}
            title={typed ? "Typed amount (overrides the forecast)" : shifted ? "Includes or leaves out a transaction counted in another month" : undefined}
            className={cn(
              "relative h-7 cursor-default border-b border-border/40 px-2 text-right tabular-nums whitespace-nowrap",
              pinned ? (kind === "current" ? "bg-[color-mix(in_oklab,var(--primary)_6%,var(--background))]" : kind === "actual" ? "bg-[color-mix(in_oklab,var(--muted)_30%,var(--background))]" : "bg-background") : cn(kind === "actual" && "bg-muted/30", kind === "current" && "bg-primary/[0.06]"),
              rowTone, strong && "font-semibold", line.kind === "group" && "font-medium", (line.kind === "unplanned" || (line.kind === "memo" && !strong)) && "text-muted-foreground",
              typed && "font-semibold", below && "text-destructive",
              diff && (better ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400"),
              inRange && "bg-accent", inFill && "bg-accent/60 outline-dashed outline-1 -outline-offset-1 outline-primary/60", active && "outline outline-2 -outline-offset-2 outline-primary",
            )}
          >
            {typed && <span aria-hidden className="absolute right-[3px] top-[3px] size-0 border-[3px] border-transparent border-r-primary border-t-primary" />}
            {shifted && <ArrowLeftRight className="mr-1 inline size-3 align-[-1px] text-muted-foreground" aria-label="A transaction is counted in another month" />}
            {below && <TrendingDown className="mr-1 inline size-3 align-[-1px]" aria-label="Below the minimum cash" />}
            {value === null ? <span className="text-muted-foreground">-</span> : value === 0 && (line.kind === "row" || line.kind === "unplanned" || (line.kind === "memo" && (line.key === "moved" || line.key === "inTransit" || line.key === "starting"))) ? "" : `${diff && value > 0 ? "+" : ""}${formatCell(value, cents)}`}
            {c === handleAt && editable && <span aria-hidden title="Drag to fill to the right" onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); handlers.fillStart(); }} className="absolute -bottom-[3px] -right-[3px] z-10 size-[7px] cursor-crosshair border border-background bg-primary" />}
          </td>
        );
      })}
    </tr>
  );
});
