"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import { useEffectiveMonthFromContext } from "../../context/MonthsDataContext";
import { EntityNoteButton } from "@/components/ui/entity-note-button";
import { useEntityNote } from "@/hooks/useEntityNote";
import { formatMinor } from "../../lib/format";
import { dispatchRowLabel, useGroupCellKeymap } from "../../keyboard/useBudgetKeymap";
import { BudgetCell, type BudgetCellDragState } from "../BudgetCell";
import { isCellSelected, type SelectionBounds } from "./types";
import type {
  BudgetCellSelection,
  BudgetMode,
  CellView,
  LoadedCategory,
  LoadedGroup,
  NavDirection,
  RowSelection,
} from "../../types";

// ─── NoteCell ─────────────────────────────────────────────────────────────────

/** Renders EntityNoteButton only when the entity actually has a note. */
function NoteCell({
  entityId,
  entityLabel,
  entityTypeLabel,
}: {
  entityId: string;
  entityLabel: string;
  entityTypeLabel: string;
}) {
  const { data: note } = useEntityNote("category", entityId, true);
  if (!note?.trim()) return null;
  return (
    <EntityNoteButton
      entityId={entityId}
      entityKind="category"
      entityLabel={entityLabel}
      entityTypeLabel={entityTypeLabel}
      className="mx-auto"
    />
  );
}

// ─── GroupMonthAggregate ──────────────────────────────────────────────────────

function GroupMonthAggregate({
  month,
  groupId,
  cellView,
  budgetMode,
  isDimmed,
  isSelected,
  onFocus,
  onNavigate,
  onToggleCollapse,
  isReadOnlyMonth,
}: {
  month: string;
  groupId: string;
  cellView: CellView;
  budgetMode: BudgetMode;
  isDimmed?: boolean;
  isSelected?: boolean;
  onFocus?: () => void;
  onNavigate?: (dir: NavDirection) => void;
  onToggleCollapse?: () => void;
  isReadOnlyMonth?: boolean;
}) {
  const data = useEffectiveMonthFromContext(month);
  const group = data?.groupsById[groupId];

  const handleKeyDown = useGroupCellKeymap({
    navigate: (dir) => onNavigate?.(dir),
    toggleCollapse: () => onToggleCollapse?.(),
  });

  const baseClass =
    "h-7 border-r border-b border-border bg-[#F7F8FA] dark:bg-zinc-800 dark:border-zinc-700";
  const dimClass = isDimmed ? " opacity-50" : "";

  if (!group && isReadOnlyMonth) {
    return (
      <div
        className={`${baseClass}${dimClass} px-2 flex items-center justify-end text-xs font-sans tabular-nums text-muted-foreground cursor-not-allowed outline-none${isSelected ? " ring-2 ring-inset ring-foreground/80" : ""}`}
        role="gridcell"
        tabIndex={0}
        aria-selected={isSelected}
        aria-readonly="true"
        aria-disabled="true"
        aria-label={`No budget data for ${month}`}
        title="No budget exists for this past month; budget cells are read-only."
        data-group-id={groupId}
        data-group-month={month}
        onClick={onFocus}
        onFocus={onFocus}
        onKeyDown={handleKeyDown}
      >
        --
      </div>
    );
  }

  if (!group) return <div className={`${baseClass} animate-pulse${dimClass}`} />;

  // In Envelope mode, income groups always show actuals (received).
  const effectiveView =
    budgetMode === "envelope" && group.isIncome ? "spent" : cellView;

  let displayValue: number;
  if (budgetMode === "tracking") {
    // Tracking: sum non-hidden categories only.
    const cats = group.categoryIds
      .map((id) => data?.categoriesById[id])
      .filter((c): c is NonNullable<typeof c> => !!c && !c.hidden);
    displayValue =
      effectiveView === "spent"
        ? cats.reduce((sum, c) => sum + c.actuals, 0)
        : effectiveView === "balance"
        ? cats.reduce((sum, c) => sum + c.balance, 0)
        : cats.reduce((sum, c) => sum + c.budgeted, 0);
  } else {
    // Envelope: group-level aggregates include all hidden rows.
    displayValue =
      effectiveView === "spent"
        ? group.actuals
        : effectiveView === "balance"
        ? group.balance
        : group.budgeted;
  }

  return (
    <div
      className={`${baseClass}${dimClass} px-2 flex items-center justify-end text-xs font-sans tabular-nums text-black dark:text-zinc-200 cursor-default outline-none${isSelected ? " ring-2 ring-inset ring-foreground/80" : ""}`}
      role="gridcell"
      tabIndex={0}
      aria-selected={isSelected}
      aria-label={`${group.name} total for ${month}: ${formatMinor(displayValue)}`}
      title={`Budgeted: ${formatMinor(group.budgeted)} | Actuals: ${formatMinor(Math.abs(group.actuals))} | Balance: ${formatMinor(group.balance)}`}
      data-group-id={groupId}
      data-group-month={month}
      onClick={onFocus}
      onFocus={onFocus}
      onKeyDown={handleKeyDown}
    >
      {formatMinor(displayValue)}
    </div>
  );
}

// ─── BudgetGridGroupRows ──────────────────────────────────────────────────────

export type GroupRowsProps = {
  group: LoadedGroup;
  collapsed: boolean;
  onToggleCollapse: () => void;
  activeMonths: string[];
  budgetMode: BudgetMode;
  cellView: CellView;
  selection: BudgetCellSelection | null;
  selectionBounds: SelectionBounds | null;
  categoryIndexMap: Map<string, number>;
  /** Merged categoriesById for category metadata (name, isIncome, etc.). */
  categoriesById: Record<string, LoadedCategory>;
  dragStateRef: { current: BudgetCellDragState };
  suppressNextClickRef: { current: boolean };
  showHidden: boolean;
  groupSelection?: { groupId: string; month: string } | null;
  rowSelection?: RowSelection | null;
  readOnlyMonths: Set<string>;
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
};

/**
 * Group header row + (when not collapsed) one category row per category.
 * Light #F7F8FA background with black text; dark mode uses zinc-800.
 */
export function BudgetGridGroupRows({
  group,
  collapsed,
  onToggleCollapse,
  activeMonths,
  budgetMode,
  cellView,
  selection,
  selectionBounds,
  categoryIndexMap,
  categoriesById,
  dragStateRef,
  suppressNextClickRef,
  showHidden,
  groupSelection,
  rowSelection,
  readOnlyMonths,
  onCellFocus,
  onCellRangeSelect,
  onCellNavigate,
  onCellContextMenu,
  onGroupFocus,
  onGroupNavigate,
  onRowLabelFocus,
  onRowLabelNavigate,
}: GroupRowsProps) {
  // When showHidden=true and this group is hidden, dim all its rows.
  const groupDimmed = showHidden && group.hidden;
  const groupDimClass = groupDimmed ? " opacity-50" : "";

  const isGroupRowSelected =
    rowSelection?.kind === "group" && rowSelection.id === group.id;
  const groupRowSelectedClass = isGroupRowSelected
    ? " ring-2 ring-inset ring-foreground/80"
    : "";

  return (
    <>
      {/* Group header — light bg, black text. Clicking anywhere outside the
          chevron selects the group row; the chevron continues to toggle
          collapse via stopPropagation. */}
      <div
        className={`h-7 px-2 flex items-center border-r border-b border-border bg-[#F7F8FA] dark:bg-zinc-800 dark:border-zinc-700 text-xs font-semibold text-black dark:text-zinc-100 sticky left-0 z-10 cursor-default outline-none${groupDimClass}${groupRowSelectedClass}`}
        role="gridcell"
        tabIndex={0}
        aria-selected={isGroupRowSelected}
        aria-label={`Category group: ${group.name}`}
        aria-expanded={!collapsed}
        data-row-group-id={group.id}
        onClick={() => onRowLabelFocus?.("group", group.id)}
        onFocus={() => onRowLabelFocus?.("group", group.id)}
        onKeyDown={(e) =>
          dispatchRowLabel(e, {
            navigate: (dir) => onRowLabelNavigate?.("group", group.id, dir),
            // Space mirrors the chevron button. Selection is preserved.
            toggleCollapse: onToggleCollapse,
          })
        }
      >
        <button
          type="button"
          onClick={(e) => {
            // Don't let the chevron click bubble into the row's click handler.
            e.stopPropagation();
            onToggleCollapse();
          }}
          className="mr-1.5 shrink-0 text-black/40 dark:text-zinc-500 hover:text-black dark:hover:text-zinc-100 transition-colors"
          aria-label={collapsed ? `Expand ${group.name}` : `Collapse ${group.name}`}
        >
          {collapsed ? (
            <ChevronRight className="h-3.5 w-3.5" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" />
          )}
        </button>
        <span className="truncate">{group.name}</span>
      </div>

      {/* Notes column for group row */}
      <div
        className={`h-7 flex items-center justify-center border-r border-b border-border bg-[#F7F8FA] dark:bg-zinc-800 dark:border-zinc-700${groupDimClass}`}
      >
        <NoteCell
          entityId={group.id}
          entityLabel={group.name}
          entityTypeLabel="Category group"
        />
      </div>

      {/* Group aggregate cells */}
      {activeMonths.map((month) => (
        <GroupMonthAggregate
          key={month}
          month={month}
          groupId={group.id}
          cellView={cellView}
          budgetMode={budgetMode}
          isDimmed={groupDimmed}
          isSelected={
            groupSelection?.groupId === group.id && groupSelection?.month === month
          }
          onFocus={() => onGroupFocus?.(group.id, month)}
          onNavigate={(dir) => onGroupNavigate?.(group.id, month, dir)}
          onToggleCollapse={onToggleCollapse}
          isReadOnlyMonth={readOnlyMonths.has(month)}
        />
      ))}

      {/* Category rows — hidden when collapsed */}
      {!collapsed &&
        group.categoryIds.map((catId) => {
          const cat = categoriesById[catId];
          if (!cat) return null;
          // Skip hidden cats when not showing hidden; dim them when showing hidden.
          if (!showHidden && cat.hidden) return null;
          const catDimmed = groupDimmed || (showHidden && cat.hidden);
          const catDimClass = catDimmed ? " opacity-50" : "";

          const isCatRowSelected =
            rowSelection?.kind === "category" && rowSelection.id === cat.id;
          const catRowSelectedClass = isCatRowSelected
            ? " ring-2 ring-inset ring-foreground/80"
            : "";

          return (
            <div
              key={cat.id}
              style={{ display: "contents" }}
              role="row"
              aria-label={cat.name}
            >
              {/* Category label — clickable / focusable to select the row */}
              <div
                className={`h-7 px-4 flex items-center border-r border-b border-border/50 text-xs truncate sticky left-0 bg-background cursor-default outline-none${catDimClass}${catRowSelectedClass}`}
                role="gridcell"
                tabIndex={0}
                aria-selected={isCatRowSelected}
                aria-label={`Category: ${cat.name}`}
                data-row-category-id={cat.id}
                onClick={() => onRowLabelFocus?.("category", cat.id)}
                onFocus={() => onRowLabelFocus?.("category", cat.id)}
                onKeyDown={(e) =>
                  dispatchRowLabel(e, {
                    navigate: (dir) => onRowLabelNavigate?.("category", cat.id, dir),
                    // Category rows have no collapse — Space binding inert.
                  })
                }
              >
                {cat.name}
              </div>

              {/* Notes column */}
              <div
                className={`h-7 flex items-center justify-center border-r border-b border-border/50 bg-background${catDimClass}`}
              >
                <NoteCell
                  entityId={cat.id}
                  entityLabel={cat.name}
                  entityTypeLabel="Category"
                />
              </div>

              {/* Budget cells */}
              {activeMonths.map((month, monthIdx) => {
                const catIdx = categoryIndexMap.get(cat.id) ?? -1;
                const isAnchor =
                  selection?.anchorCategoryId === cat.id &&
                  selection?.anchorMonth === month;
                const isSelected = isCellSelected(catIdx, monthIdx, selectionBounds);

                return (
                  <BudgetCell
                    key={`${month}:${cat.id}`}
                    category={cat}
                    month={month}
                    budgetMode={budgetMode}
                    cellView={cellView}
                    isSelected={isSelected}
                    isAnchor={isAnchor}
                    dragStateRef={dragStateRef}
                    suppressNextClickRef={suppressNextClickRef}
                    isDimmed={catDimmed}
                    isReadOnlyMonth={readOnlyMonths.has(month)}
                    onFocus={onCellFocus}
                    onRangeSelect={onCellRangeSelect}
                    onNavigate={(dir) => onCellNavigate?.(cat.id, month, dir)}
                    onContextMenuRequest={onCellContextMenu}
                  />
                );
              })}
            </div>
          );
        })}
    </>
  );
}
