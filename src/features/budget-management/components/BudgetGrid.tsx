"use client";

import { useEffect, useMemo, useRef } from "react";
import { Loader2 } from "lucide-react";
import { useMonthsData } from "../context/MonthsDataContext";
import { MonthColumnHeader } from "./grid/MonthColumnHeader";
import {
  SummaryHeaderRow,
  TRACKING_SUMMARY_ROWS,
  ENVELOPE_SUMMARY_ROWS,
} from "./grid/SummaryRows";
import { SectionTotalRow } from "./grid/SectionTotal";
import { BudgetGridGroupRows } from "./grid/GroupRows";
import type { BudgetCellDragState } from "./BudgetCell";
import type { SelectionBounds } from "./grid/types";
import type {
  BudgetCellSelection,
  BudgetMode,
  CellView,
  NavDirection,
  RowSelection,
} from "../types";

// ─── Props ─────────────────────────────────────────────────────────────────────

type Props = {
  activeMonths: string[];
  availableMonths: string[];
  budgetMode: BudgetMode;
  cellView: CellView;
  selection: BudgetCellSelection | null;
  groupSelection?: { groupId: string; month: string } | null;
  /** Whole-row selection on the first column (category or group label). */
  rowSelection?: RowSelection | null;
  readOnlyMonths: Set<string>;
  /** Collapse state lifted to BudgetManagementView so toolbar can control it. */
  collapsedGroups: Set<string>;
  onToggleCollapse: (groupId: string) => void;
  /** When true, hidden groups/categories are rendered dimmed; when false they are omitted. */
  showHidden: boolean;
  onCellFocus: (categoryId: string, month: string) => void;
  onCellRangeSelect: (categoryId: string, month: string) => void;
  onCellNavigate?: (categoryId: string, month: string, dir: NavDirection) => void;
  onCellContextMenu?: (
    catId: string,
    month: string,
    carryover: boolean,
    x: number,
    y: number
  ) => void;
  onGroupFocus?: (groupId: string, month: string) => void;
  onGroupNavigate?: (groupId: string, month: string, dir: NavDirection) => void;
  onRowLabelFocus?: (kind: "category" | "group", id: string) => void;
  onRowLabelNavigate?: (kind: "category" | "group", id: string, dir: NavDirection) => void;
  /** Called when clicking a non-interactive area inside the grid (summary rows, headers, gutters). */
  onClearSelection?: () => void;
};

// ─── Main grid ─────────────────────────────────────────────────────────────────

/**
 * Budget grid — CSS grid layout.
 *
 * Column layout: [category label (flex)] [month columns…]
 *
 * Sections:
 *   1. Mode-specific summary rows (`grid/SummaryRows.tsx`)
 *   2. Expense groups with "Total Budgeted Expenses" header (`grid/SectionTotal.tsx`)
 *   3. Income groups with "Total Budgeted Income" header
 *
 * Each group can be collapsed/expanded via a chevron button in
 * `grid/GroupRows.tsx`. Month column headers (`grid/MonthColumnHeader.tsx`)
 * show a status dot (green / amber / gray).
 *
 * Per-month data is sourced from `MonthsDataProvider` via context (BM-01,
 * BM-02). The cross-month merged structure (BM-13) makes categories that
 * appear in any visible month reachable in every month.
 */
export function BudgetGrid({
  activeMonths,
  availableMonths,
  budgetMode,
  cellView,
  selection,
  groupSelection,
  rowSelection,
  readOnlyMonths,
  collapsedGroups,
  onToggleCollapse,
  showHidden,
  onCellFocus,
  onCellRangeSelect,
  onCellNavigate,
  onCellContextMenu,
  onGroupFocus,
  onGroupNavigate,
  onRowLabelFocus,
  onRowLabelNavigate,
  onClearSelection,
}: Props) {
  const firstMonth = activeMonths[0] ?? null;
  const { merged, isLoading, errors } = useMonthsData();
  const hasAnyData = merged !== null;
  const firstMonthError = firstMonth ? errors.get(firstMonth) : undefined;

  const dragStateRef = useRef<BudgetCellDragState>({
    activePointerId: null,
    origin: null,
    hasDragged: false,
  });
  const suppressNextClickClearRef = useRef(false);

  useEffect(() => {
    const clearDragState = (e: PointerEvent) => {
      const dragState = dragStateRef.current;
      if (dragState.activePointerId !== e.pointerId) return;
      if (dragState.hasDragged) {
        suppressNextClickClearRef.current = true;
      }
      dragStateRef.current = {
        activePointerId: null,
        origin: null,
        hasDragged: false,
      };
    };

    window.addEventListener("pointerup", clearDragState);
    window.addEventListener("pointercancel", clearDragState);
    return () => {
      window.removeEventListener("pointerup", clearDragState);
      window.removeEventListener("pointercancel", clearDragState);
    };
  }, []);

  // Build allCategories in visual order: expense groups first, income groups after.
  // This ensures selection index bounds match the rendered order in the grid.
  // When showHidden=false, hidden groups and hidden categories are excluded.
  const allCategories = useMemo(() => {
    if (!merged) return [];
    const { groupOrder, groupsById, categoriesById } = merged;
    const expenseIds = groupOrder.filter((id) => !groupsById[id]!.isIncome);
    const incomeIds = groupOrder.filter((id) => groupsById[id]!.isIncome);
    return [...expenseIds, ...incomeIds]
      .filter((id) => showHidden || !groupsById[id]!.hidden)
      .flatMap((id) =>
        (groupsById[id]?.categoryIds ?? [])
          .map((catId) => categoriesById[catId]!)
          .filter((cat) => showHidden || !cat.hidden)
      );
  }, [merged, showHidden]);

  const categoryIndexMap = useMemo(
    () => new Map(allCategories.map((c, i) => [c.id, i] as [string, number])),
    [allCategories]
  );

  const selectionBounds = useMemo<SelectionBounds | null>(() => {
    if (!selection) return null;
    const anchorCatIdx = categoryIndexMap.get(selection.anchorCategoryId) ?? -1;
    const focusCatIdx = categoryIndexMap.get(selection.focusCategoryId) ?? -1;
    const anchorMonthIdx = activeMonths.indexOf(selection.anchorMonth);
    const focusMonthIdx = activeMonths.indexOf(selection.focusMonth);
    if (
      anchorCatIdx === -1 ||
      focusCatIdx === -1 ||
      anchorMonthIdx === -1 ||
      focusMonthIdx === -1
    ) {
      return null;
    }
    return {
      minCatIdx: Math.min(anchorCatIdx, focusCatIdx),
      maxCatIdx: Math.max(anchorCatIdx, focusCatIdx),
      minMonthIdx: Math.min(anchorMonthIdx, focusMonthIdx),
      maxMonthIdx: Math.max(anchorMonthIdx, focusMonthIdx),
    };
  }, [selection, categoryIndexMap, activeMonths]);

  if (!firstMonth) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm p-8">
        No months selected
      </div>
    );
  }

  if (isLoading && !hasAnyData) {
    return (
      <div
        className="min-h-full flex flex-col items-center justify-center gap-3"
        aria-busy="true"
        aria-label="Loading budget data…"
      >
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Loading budget data…</p>
      </div>
    );
  }

  if (!hasAnyData && firstMonthError) {
    return (
      <div
        className="flex-1 flex items-center justify-center text-destructive text-sm p-8"
        role="alert"
      >
        No budget data available for this period. Use the navigation above to
        find months with data.
      </div>
    );
  }

  if (!merged) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm p-8">
        No budget data loaded.
      </div>
    );
  }

  const { groupOrder, groupsById, categoriesById } = merged;
  // When !showHidden, hidden groups are omitted entirely.
  // When showHidden, hidden groups are rendered but dimmed.
  const expenseGroups = groupOrder
    .map((id) => groupsById[id]!)
    .filter((g) => !g.isIncome && (showHidden || !g.hidden));
  const incomeGroups = groupOrder
    .map((id) => groupsById[id]!)
    .filter((g) => g.isIncome && (showHidden || !g.hidden));

  const summaryRows =
    budgetMode === "tracking"
      ? TRACKING_SUMMARY_ROWS
      : budgetMode === "envelope"
      ? ENVELOPE_SUMMARY_ROWS
      : [];
  const selectedMonth = selection?.focusMonth ?? groupSelection?.month ?? null;

  const gridStyle: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns: `minmax(180px, 1fr) repeat(${activeMonths.length}, minmax(69px, 94px))`,
  };

  const sharedGroupProps = {
    activeMonths,
    budgetMode,
    cellView,
    selection,
    groupSelection,
    rowSelection,
    readOnlyMonths,
    selectionBounds,
    categoryIndexMap,
    categoriesById,
    dragStateRef,
    suppressNextClickRef: suppressNextClickClearRef,
    showHidden,
    onCellFocus,
    onCellRangeSelect,
    onCellNavigate,
    onCellContextMenu,
    onGroupFocus,
    onGroupNavigate,
    onRowLabelFocus,
    onRowLabelNavigate,
  };

  return (
    <div
      role="grid"
      aria-label="Budget grid"
      aria-colcount={activeMonths.length + 1}
      style={gridStyle}
      className="flex-1 text-sm border-t border-border/50"
      onPointerUpCapture={(e) => {
        const dragState = dragStateRef.current;
        if (dragState.activePointerId !== e.pointerId) return;
        if (dragState.hasDragged) {
          suppressNextClickClearRef.current = true;
        }
        dragStateRef.current = {
          activePointerId: null,
          origin: null,
          hasDragged: false,
        };
      }}
      onPointerCancelCapture={(e) => {
        if (dragStateRef.current.activePointerId !== e.pointerId) return;
        dragStateRef.current = {
          activePointerId: null,
          origin: null,
          hasDragged: false,
        };
      }}
      onClick={(e) => {
        if (suppressNextClickClearRef.current) {
          suppressNextClickClearRef.current = false;
          return;
        }
        // Treat any selectable surface as "kept" — cells, group-month aggregates,
        // and the new row-label cells (data-row-category-id / data-row-group-id).
        // Without all four selectors, clicking a row label fires onClearSelection
        // on bubble-up and immediately wipes the row selection that the label's
        // own onClick / onFocus just set.
        const selectable =
          "[data-category-id],[data-group-id],[data-row-category-id],[data-row-group-id]";
        if (!(e.target as Element).closest(selectable)) {
          onClearSelection?.();
        }
      }}
    >
      {/* ── Column headers ── */}
      <div
        className="h-8 px-3 flex items-center border-b-2 border-border bg-muted text-xs font-bold text-foreground sticky left-0 top-0 z-30"
        role="columnheader"
        aria-label="Category"
      >
        Category
      </div>
      {activeMonths.map((month) => (
        <MonthColumnHeader
          key={month}
          month={month}
          availableMonths={availableMonths}
          isSelected={month === selectedMonth}
        />
      ))}

      {/* ── Section 1: Summary rows ── */}
      {summaryRows.map((config, i) => (
        <SummaryHeaderRow
          key={`summary-${i}`}
          config={config}
          activeMonths={activeMonths}
        />
      ))}

      {/* Separator between summary and data — matches the expense ↔ income
          divider thickness so both section-total rows ("Total Budgeted
          Expenses" and "Total Received Income") get the same border style. */}
      {summaryRows.length > 0 && (
        <div
          style={{ gridColumn: `1 / ${activeMonths.length + 2}` }}
          className="h-0.5 bg-border/60"
          aria-hidden="true"
        />
      )}

      {/* ── Section 2: Expense groups ── */}
      {expenseGroups.length > 0 && (
        <>
          <SectionTotalRow
            filter="expense"
            cellView={cellView}
            budgetMode={budgetMode}
            activeMonths={activeMonths}
          />
          {expenseGroups.map((group) => (
            <BudgetGridGroupRows
              key={group.id}
              group={group}
              collapsed={collapsedGroups.has(group.id)}
              onToggleCollapse={() => onToggleCollapse(group.id)}
              {...sharedGroupProps}
            />
          ))}
        </>
      )}

      {/* Separator between expense and income sections */}
      {expenseGroups.length > 0 && incomeGroups.length > 0 && (
        <div
          style={{ gridColumn: `1 / ${activeMonths.length + 2}` }}
          className="h-0.5 bg-border/60"
          aria-hidden="true"
        />
      )}

      {/* ── Section 3: Income groups ── */}
      {incomeGroups.length > 0 && (
        <>
          <SectionTotalRow
            filter="income"
            cellView={cellView}
            budgetMode={budgetMode}
            activeMonths={activeMonths}
          />
          {incomeGroups.map((group) => (
            <BudgetGridGroupRows
              key={group.id}
              group={group}
              collapsed={collapsedGroups.has(group.id)}
              onToggleCollapse={() => onToggleCollapse(group.id)}
              {...sharedGroupProps}
            />
          ))}
        </>
      )}
    </div>
  );
}
