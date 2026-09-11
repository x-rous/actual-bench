"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useBudgetEditsStore } from "@/store/budgetEdits";
import { useConnectionStore, selectActiveInstance } from "@/store/connection";
import { parseBudgetExpression } from "../lib/budgetMath";
import { buildReadOnlyMissingBudgetMonthSet } from "../lib/monthAvailability";
import { formatMonthLabel } from "@/lib/budget/monthMath";
import {
  parsePastePayload,
  resolveSelectionCells,
  resolveGroupCells,
  resolveMonthCells,
  type ResolvedCell,
} from "../lib/budgetSelectionUtils";
import {
  computeCursorTarget,
  computeRangeExtensionTarget,
  isRangeExtensionDir,
} from "../lib/cursorNav";
import {
  buildFillFromActiveEdits,
  buildFillDownEdits,
  buildFillRightEdits,
  type FillSourceLookup,
} from "../lib/budgetFill";

/** Rows skipped per PageUp/PageDown. Also used for Ctrl+Shift+PageUp/Down. */
const PAGE_SIZE = 10;
import {
  useBulkAction,
  requiredSourceMonths,
  type BulkActionType,
} from "../hooks/useBulkAction";
import { ensureMonthsData } from "../lib/ensureMonthsData";
import {
  collectSkips,
  describeAverageWindow,
  describeSkips,
  hasSomethingToReport,
} from "../lib/bulkActionReport";
import { useWorkspaceKeymap } from "../keyboard/useBudgetKeymap";
import { BudgetGrid } from "./BudgetGrid";
import { BudgetSelectionSummary } from "./BudgetSelectionSummary";
import { BulkActionDialog } from "./BulkActionDialog";
import { BudgetCellContextMenu } from "./BudgetCellContextMenu";
import { BudgetCarryoverProgressDialog } from "./BudgetCarryoverProgressDialog";
import { CategoryJumpDialog } from "./CategoryJumpDialog";
import {
  buildCategorySearchOptions,
  type CategorySearchOption,
} from "../lib/categorySearch";
import {
  MonthsDataProvider,
  useMonthsData,
} from "../context/MonthsDataContext";
import type { CarryoverToggleInput } from "../hooks/useCarryoverToggle";
import type {
  BudgetCellKey,
  BudgetCellSelection,
  BudgetMode,
  CellView,
  LoadedCategory,
  NavDirection,
  NavItem,
  RowSelection,
  StagedBudgetEdit,
} from "../types";

const IMMEDIATE_BULK_ACTIONS: BulkActionType[] = [
  "copy-previous-month",
  "copy-prior-year-same-month",
  "set-to-zero",
  "avg-3-months",
  "avg-6-months",
  "avg-12-months",
  "avg-3-months-actuals",
  "avg-6-months-actuals",
  "avg-12-months-actuals",
];

/**
 * What a right-click will act on.
 *
 * A group row and a month column are nothing more than sets of category cells
 * (a group is a layer of summarization over its categories), so both resolve to
 * cells the same way a rectangle does. Only the `cell` target carries the
 * per-cell actions - Rollover and Transfer have no meaning for a set.
 */
type ContextMenuTarget =
  | { kind: "cell"; categoryId: string; month: string; carryover: boolean }
  /** One group in one month. */
  | { kind: "group"; groupId: string; month: string }
  /** One group across every month in the window. */
  | { kind: "group-row"; groupId: string }
  /** Every category in one month. */
  | { kind: "month"; month: string };

type ContextMenuState = {
  x: number;
  y: number;
  target: ContextMenuTarget;
} | null;

type PendingCategoryJump = {
  categoryId: string;
  groupId: string;
  month: string;
  hidden: boolean;
  groupHidden: boolean;
  attempts: number;
} | null;

type Props = {
  budgetMode: BudgetMode;
  cellView: CellView;
  activeMonths: string[];
  availableMonths: string[];
  /** Collapse state lifted from BudgetManagementView so toolbar can control it. */
  collapsedGroups: Set<string>;
  onToggleCollapse: (groupId: string) => void;
  /** When true, hidden groups/categories are rendered (dimmed); when false they are hidden. */
  showHidden?: boolean;
  /** RD-065: draw the spent-vs-budget bar under editable expense cells. */
  showSpendingBars?: boolean;
  /** Round grid amounts to whole units. Exact figures stay in tooltips. */
  showDecimals?: boolean;
  onOpenTransfer?: (categoryId: string, month: string, mode: "cover" | "transfer") => void;
  // ── Tier 3 view-state setters (keyboard shortcuts) ─────────────────────
  onCycleCellView: () => void;
  onToggleShowHidden: () => void;
  onExpandAll: () => void;
  onCollapseAll: () => void;
  onPanMonthsPrev: () => void;
  onPanMonthsNext: () => void;
  /** Opens the keyboard-shortcuts cheatsheet (state lives in BudgetManagementView). */
  onOpenShortcutsHelp: () => void;
};

/**
 * Main workspace composite: grid + context panel + selection summary footer.
 *
 * Mounts `MonthsDataProvider` so every cell, summary row, and group aggregate
 * inside the workspace shares a single useQueries call and a single edits
 * subscription. The cascade runs once per pass instead of once per cell.
 */
export function BudgetWorkspace(props: Props) {
  return (
    <MonthsDataProvider
      months={props.activeMonths}
      availableMonths={props.availableMonths}
    >
      <BudgetWorkspaceInner {...props} />
    </MonthsDataProvider>
  );
}

/**
 * Inner workspace — runs inside the MonthsDataProvider. Owns BudgetCellSelection
 * local state and coordinates paste, copy, undo/redo, and keyboard navigation.
 */
function BudgetWorkspaceInner({
  budgetMode,
  cellView,
  activeMonths,
  availableMonths,
  collapsedGroups,
  onToggleCollapse,
  showHidden = false,
  showSpendingBars = false,
  showDecimals = true,
  onOpenTransfer,
  onCycleCellView,
  onToggleShowHidden,
  onExpandAll,
  onCollapseAll,
  onPanMonthsPrev,
  onPanMonthsNext,
  onOpenShortcutsHelp,
}: Props) {
  const [selection, setSelection] = useState<BudgetCellSelection | null>(null);
  const [groupSelection, setGroupSelection] = useState<{ groupId: string; month: string } | null>(null);
  const [rowSelection, setRowSelectionLocal] = useState<RowSelection | null>(null);
  const [monthSelection, setMonthSelection] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null);
  const [pendingBulk, setPendingBulk] = useState<{
    action: BulkActionType;
    cells: ResolvedCell[];
    scopeLabel?: string;
  } | null>(null);
  const [categorySearchOpen, setCategorySearchOpen] = useState(false);
  const [pendingCategoryJump, setPendingCategoryJump] = useState<PendingCategoryJump>(null);
  const [carryoverRequest, setCarryoverRequest] = useState<{
    input: CarryoverToggleInput;
    categoryLabel?: string;
  } | null>(null);

  const workspaceRef = useRef<HTMLDivElement>(null);
  const { preview: previewBulk, apply: applyBulk } = useBulkAction();

  const undo = useBudgetEditsStore((s) => s.undo);
  const redo = useBudgetEditsStore((s) => s.redo);
  const stageBulkEdits = useBudgetEditsStore((s) => s.stageBulkEdits);
  const setUiSelection = useBudgetEditsStore((s) => s.setUiSelection);
  const setRowSelectionStore = useBudgetEditsStore((s) => s.setRowSelection);

  // Sync local selection state to the store so BudgetDraftPanel can read it.
  // Row selection takes precedence; cell/group-cell selection clears it via
  // the store's setUiSelection (mutually exclusive). A whole-month selection
  // (month set, no category/group) is the lone "month, null, null" store state.
  useEffect(() => {
    if (rowSelection) {
      setRowSelectionStore(rowSelection);
    } else if (groupSelection) {
      setUiSelection(groupSelection.month, null, groupSelection.groupId);
    } else if (monthSelection) {
      setUiSelection(monthSelection, null, null);
    } else {
      setUiSelection(selection?.anchorMonth ?? null, selection?.anchorCategoryId ?? null, null);
    }
  }, [selection, groupSelection, rowSelection, monthSelection, setUiSelection, setRowSelectionStore]);

  const queryClient = useQueryClient();
  const connection = useConnectionStore(selectActiveInstance);
  const readOnlyMonths = useMemo(
    () => buildReadOnlyMissingBudgetMonthSet(activeMonths, availableMonths),
    [activeMonths, availableMonths]
  );
  const readOnlyMonthIndices = useMemo(
    () =>
      new Set(
        activeMonths.flatMap((month, index) =>
          readOnlyMonths.has(month) ? [index] : []
        )
      ),
    [activeMonths, readOnlyMonths]
  );
  const firstSelectableMonth = useMemo(
    () => activeMonths.find((month) => !readOnlyMonths.has(month)) ?? null,
    [activeMonths, readOnlyMonths]
  );

  // Provider-supplied data (BM-01, BM-13).
  const { raw: rawMonthsMap, merged, effective: effectiveMonthsMap } = useMonthsData();

  // Categories in visual order — derived from the cross-month merged structure
  // so categories that exist in any visible month are reachable in every month.
  // When showHidden=false, hidden groups and hidden categories are excluded.
  const categories = useMemo(() => {
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

  // Interleaved nav list: group row followed by its visible (and expanded) categories.
  // Used for Up/Down/Tab keyboard navigation so group rows are reachable.
  const navItems = useMemo((): NavItem[] => {
    if (!merged) return [];
    const { groupOrder, groupsById, categoriesById } = merged;
    const expenseIds = groupOrder.filter((id) => !groupsById[id]!.isIncome);
    const incomeIds = groupOrder.filter((id) => groupsById[id]!.isIncome);
    const items: NavItem[] = [];
    for (const groupId of [...expenseIds, ...incomeIds]) {
      const group = groupsById[groupId];
      if (!group) continue;
      if (!showHidden && group.hidden) continue;
      items.push({ type: "group", id: groupId });
      if (!collapsedGroups.has(groupId)) {
        for (const catId of group.categoryIds) {
          const cat = categoriesById[catId];
          if (!cat) continue;
          if (!showHidden && cat.hidden) continue;
          items.push({ type: "category", id: catId });
        }
      }
    }
    return items;
  }, [merged, showHidden, collapsedGroups]);

  const categorySearchOptions = useMemo<CategorySearchOption[]>(() => {
    if (!merged) return [];
    return buildCategorySearchOptions(merged);
  }, [merged]);

  // Selecting the whole month from a column header. Toggles off when the
  // already-selected month header is clicked again.
  const handleMonthHeaderSelect = useCallback((month: string) => {
    setContextMenu(null);
    setSelection(null);
    setGroupSelection(null);
    setRowSelectionLocal(null);
    setMonthSelection((prev) => (prev === month ? null : month));
  }, []);

  const handleCellFocus = useCallback(
    (categoryId: string, month: string) => {
      setContextMenu(null);
      setGroupSelection(null);
      setRowSelectionLocal(null);
      setMonthSelection(null);
      setSelection({
        anchorCategoryId: categoryId,
        anchorMonth: month,
        focusCategoryId: categoryId,
        focusMonth: month,
      });
    },
    [setSelection]
  );

  const handleGroupFocus = useCallback(
    (groupId: string, month: string) => {
      setContextMenu(null);
      setSelection(null);
      setRowSelectionLocal(null);
      setMonthSelection(null);
      setGroupSelection({ groupId, month });
    },
    [setSelection]
  );

  const handleRowLabelFocus = useCallback(
    (kind: "category" | "group", id: string) => {
      setContextMenu(null);
      setSelection(null);
      setGroupSelection(null);
      setMonthSelection(null);
      setRowSelectionLocal({ kind, id });
    },
    [setSelection]
  );

  const handleCellRangeSelect = useCallback(
    (categoryId: string, month: string) => {
      setSelection((prev) => {
        if (!prev) {
          return {
            anchorCategoryId: categoryId,
            anchorMonth: month,
            focusCategoryId: categoryId,
            focusMonth: month,
          };
        }
        return {
          ...prev,
          focusCategoryId: categoryId,
          focusMonth: month,
        };
      });
    },
    [setSelection]
  );

  /**
   * Unified navigation across the interleaved navItems list. The month axis
   * uses index `-1` for the row-label column (the first sticky column with
   * category / group names) and `0..activeMonths.length-1` for data columns.
   *
   * Pass `fromMonth = null` when the source is a row label.
   */
  const navigateFrom = useCallback(
    (fromItem: NavItem, fromMonth: string | null, dir: NavDirection) => {
      const itemIdx = navItems.findIndex(
        (i) => i.type === fromItem.type && i.id === fromItem.id
      );
      if (itemIdx === -1) return;
      // monthIdx === -1 represents the label column.
      const monthIdx = fromMonth === null ? -1 : activeMonths.indexOf(fromMonth);
      if (fromMonth !== null && monthIdx === -1) return;

      // Shift+nav: range extension — categories only, never crosses into
      // the label column (no range across the gutter).
      if (isRangeExtensionDir(dir)) {
        if (fromItem.type !== "category" || monthIdx === -1) return;
        setSelection((prev) => {
          if (!prev) return prev;
          const catOnlyItems = navItems.filter((i) => i.type === "category");
          const focusCatIdx = catOnlyItems.findIndex(
            (i) => i.id === prev.focusCategoryId
          );
          const focusMonthIdx = activeMonths.indexOf(prev.focusMonth);
          const target = computeRangeExtensionTarget({
            catItems: catOnlyItems,
            monthCount: activeMonths.length,
            skippedMonthIdxs: readOnlyMonthIndices,
            focus: { itemIdx: focusCatIdx, monthIdx: focusMonthIdx },
            dir,
            pageSize: PAGE_SIZE,
          });
          if (!target) return prev;
          const newFocusItem = catOnlyItems[target.itemIdx];
          const newFocusMonth = activeMonths[target.monthIdx];
          if (!newFocusItem || !newFocusMonth) return prev;
          return {
            ...prev,
            focusCategoryId: newFocusItem.id,
            focusMonth: newFocusMonth,
          };
        });
        return;
      }

      const target = computeCursorTarget({
        navItems,
        monthCount: activeMonths.length,
        skippedMonthIdxs: readOnlyMonthIndices,
        current: { itemIdx, monthIdx },
        dir,
        pageSize: PAGE_SIZE,
      });
      if (!target) return;
      setMonthSelection(null);
      const { itemIdx: newItemIdx, monthIdx: newMonthIdx } = target;

      const newItem = navItems[newItemIdx];
      if (!newItem) return;

      // Label column: select the row, focus the label element.
      if (newMonthIdx === -1) {
        setContextMenu(null);
        setSelection(null);
        setGroupSelection(null);
        const kind = newItem.type === "group" ? "group" : "category";
        setRowSelectionLocal({ kind, id: newItem.id });
        const attr = newItem.type === "group" ? "data-row-group-id" : "data-row-category-id";
        document
          .querySelector<HTMLElement>(`[${attr}="${CSS.escape(newItem.id)}"]`)
          ?.focus();
        return;
      }

      const newMonth = activeMonths[newMonthIdx];
      if (!newMonth) return;

      if (newItem.type === "group") {
        setContextMenu(null);
        setSelection(null);
        setRowSelectionLocal(null);
        setGroupSelection({ groupId: newItem.id, month: newMonth });
        document
          .querySelector<HTMLElement>(
            `[data-group-id="${CSS.escape(newItem.id)}"][data-group-month="${CSS.escape(newMonth)}"]`
          )
          ?.focus();
      } else {
        setContextMenu(null);
        setGroupSelection(null);
        setRowSelectionLocal(null);
        setSelection({
          anchorCategoryId: newItem.id,
          anchorMonth: newMonth,
          focusCategoryId: newItem.id,
          focusMonth: newMonth,
        });
        document
          .querySelector<HTMLElement>(
            `[data-month="${CSS.escape(newMonth)}"][data-category-id="${CSS.escape(newItem.id)}"]`
          )
          ?.focus();
      }
    },
    [navItems, activeMonths, readOnlyMonthIndices, setSelection]
  );

  const handleCellNavigate = useCallback(
    (fromCategoryId: string, fromMonth: string, dir: NavDirection) => {
      navigateFrom({ type: "category", id: fromCategoryId }, fromMonth, dir);
    },
    [navigateFrom]
  );

  const handleGroupNavigate = useCallback(
    (fromGroupId: string, fromMonth: string, dir: NavDirection) => {
      navigateFrom({ type: "group", id: fromGroupId }, fromMonth, dir);
    },
    [navigateFrom]
  );

  /** Navigation from a row-label (first column) cell. fromMonth is null. */
  const handleRowLabelNavigate = useCallback(
    (kind: "category" | "group", id: string, dir: NavDirection) => {
      navigateFrom({ type: kind, id }, null, dir);
    },
    [navigateFrom]
  );

  const selectedMonth =
    selection?.focusMonth ??
    groupSelection?.month ??
    monthSelection ??
    firstSelectableMonth;

  const handleCategoryJumpSelect = useCallback(
    (option: CategorySearchOption) => {
      const month = selectedMonth;
      if (!month) return;

      setContextMenu(null);
      setGroupSelection(null);
      setRowSelectionLocal(null);
      setMonthSelection(null);
      setSelection({
        anchorCategoryId: option.categoryId,
        anchorMonth: month,
        focusCategoryId: option.categoryId,
        focusMonth: month,
      });

      if (!showHidden && (option.hidden || option.groupHidden)) {
        onToggleShowHidden();
      }
      if (collapsedGroups.has(option.groupId)) {
        onToggleCollapse(option.groupId);
      }

      setPendingCategoryJump({
        categoryId: option.categoryId,
        groupId: option.groupId,
        month,
        hidden: option.hidden,
        groupHidden: option.groupHidden,
        attempts: 0,
      });
    },
    [
      selectedMonth,
      showHidden,
      collapsedGroups,
      onToggleShowHidden,
      onToggleCollapse,
      setSelection,
    ]
  );

  useEffect(() => {
    if (!pendingCategoryJump) return;
    if (
      (!showHidden && (pendingCategoryJump.hidden || pendingCategoryJump.groupHidden)) ||
      collapsedGroups.has(pendingCategoryJump.groupId)
    ) {
      return;
    }
    const frame = requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>(
        `[data-month="${CSS.escape(pendingCategoryJump.month)}"][data-category-id="${CSS.escape(pendingCategoryJump.categoryId)}"]`
      );
      if (!el) {
        setPendingCategoryJump((current) => {
          if (
            !current ||
            current.month !== pendingCategoryJump.month ||
            current.categoryId !== pendingCategoryJump.categoryId
          ) {
            return current;
          }
          if (current.attempts >= 6) return null;
          return { ...current, attempts: current.attempts + 1 };
        });
        return;
      }
      el.scrollIntoView({ block: "center", inline: "nearest" });
      el.focus();
      setMonthSelection(null);
      setSelection({
        anchorCategoryId: pendingCategoryJump.categoryId,
        anchorMonth: pendingCategoryJump.month,
        focusCategoryId: pendingCategoryJump.categoryId,
        focusMonth: pendingCategoryJump.month,
      });
      setPendingCategoryJump(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [pendingCategoryJump, showHidden, collapsedGroups, setSelection]);

  /** Copy selected cell values as tab-delimited text (dollar amounts). */
  const handleCopySelection = useCallback(() => {
    if (!selection) return;

    const anchorCatIdx = categories.findIndex((c) => c.id === selection.anchorCategoryId);
    const focusCatIdx = categories.findIndex((c) => c.id === selection.focusCategoryId);
    const anchorMonthIdx = activeMonths.indexOf(selection.anchorMonth);
    const focusMonthIdx = activeMonths.indexOf(selection.focusMonth);

    if (anchorCatIdx === -1 || focusCatIdx === -1 || anchorMonthIdx === -1 || focusMonthIdx === -1) return;

    const minCat = Math.min(anchorCatIdx, focusCatIdx);
    const maxCat = Math.max(anchorCatIdx, focusCatIdx);
    const minMonth = Math.min(anchorMonthIdx, focusMonthIdx);
    const maxMonth = Math.max(anchorMonthIdx, focusMonthIdx);

    const currentEdits = useBudgetEditsStore.getState().edits;

    const rows: string[] = [];
    for (let ci = minCat; ci <= maxCat; ci++) {
      const cat = categories[ci];
      if (!cat) continue;
      const cols: string[] = [];
      for (let mi = minMonth; mi <= maxMonth; mi++) {
        const month = activeMonths[mi];
        if (!month) continue;

        // Read the in-window month state from the provider's raw map.
        const monthState = rawMonthsMap.get(month);
        const catData = monthState?.categoriesById[cat.id] ?? cat;

        const cellKey: BudgetCellKey = `${month}:${cat.id}`;
        const staged = currentEdits[cellKey];
        const minor = staged != null ? staged.nextBudgeted : catData.budgeted;
        cols.push((minor / 100).toFixed(2));
      }
      rows.push(cols.join("\t"));
    }

    const text = rows.join("\n");
    navigator.clipboard.writeText(text).catch((err) => {
      // BM-15: surface clipboard errors instead of silently swallowing — user
      // sees Ctrl+C "do nothing" otherwise (e.g. in non-secure context, or
      // when permissions are denied).
      const message = err instanceof Error ? err.message : "Could not copy to clipboard";
      toast.error("Copy failed", { description: message });
    });
  }, [selection, categories, activeMonths, rawMonthsMap]);

  // Context menu handler
  const handleCellContextMenu = useCallback(
    (catId: string, month: string, carryover: boolean, x: number, y: number) => {
      // Spreadsheet convention: right-clicking inside the selection acts on the
      // whole selection; right-clicking outside it moves the selection to that
      // cell first. Without this the menu silently acts on a selection the user
      // can no longer see, which the group and column targets made obvious by
      // contrast - they always say what they will change.
      const insideSelection =
        selection != null &&
        resolveSelectionCells(selection, activeMonths, categories).some(
          (cell) => cell.month === month && cell.categoryId === catId
        );
      if (!insideSelection) {
        setSelection({
          anchorCategoryId: catId,
          anchorMonth: month,
          focusCategoryId: catId,
          focusMonth: month,
        });
      }
      setContextMenu({
        x,
        y,
        target: { kind: "cell", categoryId: catId, month, carryover },
      });
    },
    [selection, activeMonths, categories, setSelection]
  );

  /**
   * The cells a right-click target stands for.
   *
   * `categories` is filtered by `showHidden` but never by collapse state, so a
   * collapsed group resolves to all of its categories without being opened -
   * which is the whole point of acting on the group row.
   */
  const resolveContextTargetCells = useCallback(
    (target: ContextMenuTarget): ResolvedCell[] => {
      switch (target.kind) {
        case "cell":
          return selection
            ? resolveSelectionCells(selection, activeMonths, categories)
            : [{ month: target.month, categoryId: target.categoryId }];
        case "group":
          return resolveGroupCells(target.groupId, [target.month], categories);
        case "group-row":
          return resolveGroupCells(target.groupId, activeMonths, categories);
        case "month":
          return resolveMonthCells(target.month, categories);
      }
    },
    [selection, activeMonths, categories]
  );

  /** Plain-language description of what a group or column action will change. */
  const describeContextTarget = useCallback(
    (target: ContextMenuTarget): string | undefined => {
      const groupName = (groupId: string) =>
        merged?.groupsById[groupId]?.name ?? "Category group";
      switch (target.kind) {
        case "cell":
          return undefined;
        case "group":
          return `${groupName(target.groupId)} - ${formatMonthLabel(target.month, "long")}`;
        case "group-row":
          return `${groupName(target.groupId)} - all ${activeMonths.length} months`;
        case "month":
          return `All categories - ${formatMonthLabel(target.month, "long")}`;
      }
    },
    [merged, activeMonths]
  );

  const handleGroupContextMenu = useCallback(
    (groupId: string, month: string, x: number, y: number) => {
      setContextMenu({ x, y, target: { kind: "group", groupId, month } });
    },
    []
  );

  const handleGroupRowContextMenu = useCallback(
    (groupId: string, x: number, y: number) => {
      setContextMenu({ x, y, target: { kind: "group-row", groupId } });
    },
    []
  );

  const handleMonthContextMenu = useCallback(
    (month: string, x: number, y: number) => {
      setContextMenu({ x, y, target: { kind: "month", month } });
    },
    []
  );

  // Carryover toggle — immediate API action (not staged). Opens the progress
  // dialog which drives the actual PATCH loop and shows partial-failure UI.
  const handleCarryoverToggle = useCallback(() => {
    if (!connection || contextMenu?.target.kind !== "cell") return;
    const { categoryId, month, carryover } = contextMenu.target;
    const monthsToUpdate = activeMonths.filter(
      (m) => m >= month && !readOnlyMonths.has(m)
    );
    if (monthsToUpdate.length === 0) return;

    const cat = rawMonthsMap.get(month)?.categoriesById[categoryId];

    setCarryoverRequest({
      input: {
        categoryIds: [categoryId],
        months: monthsToUpdate,
        newValue: !carryover,
      },
      categoryLabel: cat?.name,
    });
    setContextMenu(null);
  }, [connection, contextMenu, activeMonths, readOnlyMonths, rawMonthsMap]);

  const clearGridSelection = useCallback(() => {
    setContextMenu(null);
    setSelection(null);
    setGroupSelection(null);
    setRowSelectionLocal(null);
    setMonthSelection(null);
  }, []);

  // Clear selection on any click outside the workspace div (TopBar, Sidebar, Toolbar, etc.)
  useEffect(() => {
    const handleDocMouseDown = (e: MouseEvent) => {
      const target = e.target as Element;
      if (target.closest("[role=dialog]")) return;
      if (target.closest("[data-budget-details-panel]")) return;
      if (workspaceRef.current?.contains(target)) return;
      clearGridSelection();
    };
    document.addEventListener("mousedown", handleDocMouseDown);
    return () => document.removeEventListener("mousedown", handleDocMouseDown);
  }, [clearGridSelection]);

  /**
   * Loads the months an action needs to read, using the shared query cache.
   *
   * Bulk actions previously peeked at the cache with `getQueryData`, so a
   * lookback month that had not been prefetched silently vanished from the
   * calculation. Everything now goes through here: a month is either loaded
   * or reported, never quietly treated as absent.
   */
  const ensureMonths = useCallback(
    (months: string[]) =>
      ensureMonthsData(queryClient, connection, months, availableMonths),
    [queryClient, connection, availableMonths]
  );

  /**
   * Run a bulk action against a right-click target, or - when invoked from the
   * keyboard - against the current cell selection.
   *
   * A group row or a month column is just a set of cells, so the only real
   * difference is how the cells are resolved. Those scopes always go through
   * the preview dialog: a column is every category, which is a large staged
   * change and a slow save, and it should be seen before it is made.
   */
  const runBulkAction = useCallback(
    async (action: BulkActionType, target?: ContextMenuTarget) => {
      const cells = target
        ? resolveContextTargetCells(target)
        : selection
          ? resolveSelectionCells(selection, activeMonths, categories)
          : [];
      if (cells.length === 0) return;

      const isCellScope = !target || target.kind === "cell";
      if (!isCellScope || !IMMEDIATE_BULK_ACTIONS.includes(action)) {
        setPendingBulk({
          action,
          cells,
          scopeLabel: target ? describeContextTarget(target) : undefined,
        });
        return;
      }

      const targetMonths = [...new Set(cells.map((c) => c.month))];
      const needed = requiredSourceMonths(action, targetMonths);

      // In-window months come from the provider; source months are loaded.
      const monthDataMap: Record<string, LoadedCategory[]> = {};
      for (const month of activeMonths) {
        const state = rawMonthsMap.get(month);
        if (state) monthDataMap[month] = Object.values(state.categoriesById);
      }

      // A cold cache means real requests, so say something while they run
      // rather than leaving the grid looking inert.
      const toastId = needed.length > 0 ? toast.loading("Loading months…") : undefined;
      let failedToLoad: string[] = [];
      try {
        if (needed.length > 0) {
          const loaded = await ensureMonths(needed);
          Object.assign(monthDataMap, loaded.monthDataMap);
          // A month that exists but would not load is a fault, not absent data.
          failedToLoad = loaded.failed;
        }

        const result = previewBulk(action, cells, activeMonths, categories, monthDataMap);
        if (!result) {
          toast.error("That action needs a value.", { id: toastId });
          return;
        }

        const { rows, skips: baseSkips } = collectSkips(result, readOnlyMonths);
        const skips = { ...baseSkips, failedToLoad };
        const skipNote = hasSomethingToReport(skips) ? describeSkips(skips) : null;
        const avgNote = describeAverageWindow(result.averageWindow);
        const description = [skipNote, avgNote].filter(Boolean).join(" · ") || undefined;

        if (rows.length === 0) {
          toast.error(
            skipNote ? `Nothing to update - ${skipNote}.` : "No cells would be changed.",
            { id: toastId }
          );
          return;
        }

        applyBulk(rows);
        toast.success(
          `Updated ${rows.length} cell${rows.length !== 1 ? "s" : ""}`,
          { id: toastId, description }
        );
      } catch (err) {
        toast.error("Could not load the months this action needs", {
          id: toastId,
          description: err instanceof Error ? err.message : undefined,
        });
      }
    },
    [
      selection,
      activeMonths,
      categories,
      rawMonthsMap,
      ensureMonths,
      previewBulk,
      applyBulk,
      readOnlyMonths,
      resolveContextTargetCells,
      describeContextTarget,
    ]
  );

  const copySelection = useCallback((): boolean => {
    if (!selection) return false;
    handleCopySelection();
    return true;
  }, [selection, handleCopySelection]);

  // Multi-cell Delete: zero out every cell in the selection.
  // Single-cell Delete is handled by BudgetCell's own keymap; we return
  // `false` here so the dispatcher doesn't preventDefault and the cell
  // handler can do its work.
  const zeroMultiCellSelection = useCallback((): boolean => {
    if (!selection) return false;
    const cells = resolveSelectionCells(selection, activeMonths, categories);
    if (cells.length <= 1) return false;
    const newEdits: StagedBudgetEdit[] = cells.flatMap((cell) => {
      if (readOnlyMonths.has(cell.month)) return [];
      const serverCat = rawMonthsMap.get(cell.month)?.categoriesById[cell.categoryId];
      return [{
        month: cell.month,
        categoryId: cell.categoryId,
        nextBudgeted: 0,
        previousBudgeted: serverCat?.budgeted ?? 0,
        source: "manual" as const,
      }];
    });
    if (newEdits.length === 0) return false;
    stageBulkEdits(newEdits);
    return true;
  }, [selection, activeMonths, categories, readOnlyMonths, rawMonthsMap, stageBulkEdits]);

  // Lookup used by the rectangle-fill helpers. Reads non-reactively from the
  // edits store so the workspace doesn't re-render on every keystroke.
  const buildFillLookup = useCallback((): FillSourceLookup => {
    const edits = useBudgetEditsStore.getState().edits;
    return (month, categoryId) => {
      if (readOnlyMonths.has(month)) return null;
      const serverCat = rawMonthsMap.get(month)?.categoriesById[categoryId];
      if (!serverCat) return null;
      const editKey: BudgetCellKey = `${month}:${categoryId}`;
      const stagedEdit = edits[editKey];
      const current = stagedEdit?.nextBudgeted ?? serverCat.budgeted;
      return { current, server: serverCat.budgeted };
    };
  }, [readOnlyMonths, rawMonthsMap]);

  const fillFromActive = useCallback((): boolean => {
    if (!selection) return false;
    const newEdits = buildFillFromActiveEdits(selection, activeMonths, categories, buildFillLookup());
    if (!newEdits || newEdits.length === 0) return false;
    stageBulkEdits(newEdits);
    return true;
  }, [selection, activeMonths, categories, buildFillLookup, stageBulkEdits]);

  const fillDown = useCallback((): boolean => {
    if (!selection) return false;
    const newEdits = buildFillDownEdits(selection, activeMonths, categories, buildFillLookup());
    if (!newEdits || newEdits.length === 0) return false;
    stageBulkEdits(newEdits);
    return true;
  }, [selection, activeMonths, categories, buildFillLookup, stageBulkEdits]);

  const fillRight = useCallback((): boolean => {
    if (!selection) return false;
    const newEdits = buildFillRightEdits(selection, activeMonths, categories, buildFillLookup());
    if (!newEdits || newEdits.length === 0) return false;
    stageBulkEdits(newEdits);
    return true;
  }, [selection, activeMonths, categories, buildFillLookup, stageBulkEdits]);

  // Alt+L / Alt+A — wrap the existing bulk-action path. Returns false on
  // no-selection so the dispatcher doesn't preventDefault and the keystroke
  // can fall through (browser-default bindings for Alt+L/A are unused, but
  // we still keep the convention).
  const fillPrevMonth = useCallback((): boolean => {
    if (!selection) return false;
    // Fire-and-forget: the keymap only needs to know the binding was claimed,
    // and the action reports its own outcome by toast.
    void runBulkAction("copy-previous-month");
    return true;
  }, [selection, runBulkAction]);

  const fillAvg3 = useCallback((): boolean => {
    if (!selection) return false;
    void runBulkAction("avg-3-months");
    return true;
  }, [selection, runBulkAction]);

  const fillAvg6 = useCallback((): boolean => {
    if (!selection) return false;
    void runBulkAction("avg-6-months");
    return true;
  }, [selection, runBulkAction]);

  const fillAvg12 = useCallback((): boolean => {
    if (!selection) return false;
    void runBulkAction("avg-12-months");
    return true;
  }, [selection, runBulkAction]);

  const fillPriorYear = useCallback((): boolean => {
    if (!selection) return false;
    void runBulkAction("copy-prior-year-same-month");
    return true;
  }, [selection, runBulkAction]);

  // Alt+C: toggle carryover for all selected categories across the selected
  // month range. newValue is derived from the anchor cell's current carryover state.
  const toggleCarryoverForSelection = useCallback((): boolean => {
    if (!selection || !connection) return false;
    const anchorCatId = selection.anchorCategoryId;
    const anchorMonthIdx = activeMonths.indexOf(selection.anchorMonth);
    const focusMonthIdx = activeMonths.indexOf(selection.focusMonth);
    if (anchorMonthIdx === -1 || focusMonthIdx === -1) return false;
    const minMonthIdx = Math.min(anchorMonthIdx, focusMonthIdx);
    const maxMonthIdx = Math.max(anchorMonthIdx, focusMonthIdx);
    const monthsToUpdate = activeMonths
      .slice(minMonthIdx, maxMonthIdx + 1)
      .filter((month) => !readOnlyMonths.has(month));
    if (monthsToUpdate.length === 0) return false;

    const anchorCat = rawMonthsMap.get(selection.anchorMonth)?.categoriesById[anchorCatId];
    if (!anchorCat) return false;

    const anchorCatIdx = categories.findIndex((c) => c.id === selection.anchorCategoryId);
    const focusCatIdx = categories.findIndex((c) => c.id === selection.focusCategoryId);
    if (anchorCatIdx === -1 || focusCatIdx === -1) return false;
    const minCatIdx = Math.min(anchorCatIdx, focusCatIdx);
    const maxCatIdx = Math.max(anchorCatIdx, focusCatIdx);
    const categoryIds = categories.slice(minCatIdx, maxCatIdx + 1).map((c) => c.id);

    setCarryoverRequest({
      input: {
        categoryIds,
        months: monthsToUpdate,
        newValue: !anchorCat.carryover,
      },
      categoryLabel: categoryIds.length === 1 ? anchorCat.name : undefined,
    });
    return true;
  }, [selection, connection, activeMonths, readOnlyMonths, rawMonthsMap, categories]);

  const handleKeyDown = useWorkspaceKeymap({
    undo,
    redo,
    copySelection,
    zeroMultiCellSelection,
    fillFromActive,
    fillDown,
    fillRight,
    fillPrevMonth,
    fillAvg3,
    fillAvg6,
    fillAvg12,
    fillPriorYear,
    cycleCellView: onCycleCellView,
    toggleShowHidden: onToggleShowHidden,
    expandAll: onExpandAll,
    collapseAll: onCollapseAll,
    panMonthsPrev: onPanMonthsPrev,
    panMonthsNext: onPanMonthsNext,
    openCategorySearch: () => setCategorySearchOpen(true),
    toggleCarryoverForSelection,
    openShortcutsHelp: onOpenShortcutsHelp,
  });

  const handleWorkspaceKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const target = e.target as HTMLElement;
      if (
        target.closest("[role=dialog]") ||
        target.matches("input, textarea, select, [contenteditable='true']")
      ) {
        return;
      }
      handleKeyDown(e);
    },
    [handleKeyDown]
  );

  // Clipboard paste: parse tab-delimited text and stage bulk edits
  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLDivElement>) => {
      const target = e.target as HTMLElement | null;
      if (
        target?.closest(
          "input, textarea, select, [contenteditable='true'], [contenteditable='']"
        )
      ) {
        return;
      }
      if (!selection) return;
      const text = e.clipboardData.getData("text/plain");
      if (!text) return;

      const pasteGrid = parsePastePayload(text);
      if (pasteGrid.length === 0 || pasteGrid[0]?.length === 0) return;

      const isSingleValue = pasteGrid.length === 1 && pasteGrid[0]?.length === 1;
      const singleStr = isSingleValue ? (pasteGrid[0]?.[0] ?? "") : "";
      const singleResult = isSingleValue ? parseBudgetExpression(singleStr) : null;

      const newEdits: StagedBudgetEdit[] = [];

      if (isSingleValue && singleResult?.ok) {
        // Single value pasted: fill every cell in the current selection rectangle.
        const cells = resolveSelectionCells(selection, activeMonths, categories);
        for (const cell of cells) {
          if (readOnlyMonths.has(cell.month)) continue;
          const serverCat = rawMonthsMap.get(cell.month)?.categoriesById[cell.categoryId];
          newEdits.push({
            month: cell.month,
            categoryId: cell.categoryId,
            nextBudgeted: singleResult.value,
            previousBudgeted: serverCat?.budgeted ?? 0,
            source: "paste",
          });
        }
      } else {
        // Multi-value paste: fill from anchor, expand as far as the paste grid.
        const anchorCatIdx = categories.findIndex(
          (c) => c.id === selection.anchorCategoryId
        );
        const anchorMonthIdx = activeMonths.indexOf(selection.anchorMonth);
        if (anchorCatIdx === -1 || anchorMonthIdx === -1) return;

        for (let ri = 0; ri < pasteGrid.length; ri++) {
          const row = pasteGrid[ri];
          if (!row) continue;
          for (let ci = 0; ci < row.length; ci++) {
            const cellStr = row[ci] ?? "";
            const result = parseBudgetExpression(cellStr);
            if (!result.ok) continue;

            const cat = categories[anchorCatIdx + ri];
            const month = activeMonths[anchorMonthIdx + ci];
            if (!cat || !month) continue;
            if (readOnlyMonths.has(month)) continue;

            const serverCat = rawMonthsMap.get(month)?.categoriesById[cat.id];

            newEdits.push({
              month,
              categoryId: cat.id,
              nextBudgeted: result.value,
              previousBudgeted: serverCat?.budgeted ?? 0,
              source: "paste",
            });
          }
        }
      }

      if (newEdits.length > 0) {
        e.preventDefault();
        stageBulkEdits(newEdits);
      }
    },
    [selection, categories, activeMonths, readOnlyMonths, stageBulkEdits, rawMonthsMap]
  );

  return (
    <div
      ref={workspaceRef}
      className="flex flex-col flex-1 min-h-0"
      onKeyDown={handleWorkspaceKeyDown}
      onPaste={handlePaste}
      tabIndex={-1}
      aria-label="Budget workspace"
    >
      <div
        className="flex-1 min-w-0 overflow-auto"
        onClick={(e) => {
          const target = e.target as Element;
          if (target.closest("[role=grid]")) return;
          clearGridSelection();
        }}
      >
        <BudgetGrid
          activeMonths={activeMonths}
          availableMonths={availableMonths}
          budgetMode={budgetMode}
          cellView={cellView}
          selection={selection}
          groupSelection={groupSelection}
          rowSelection={rowSelection}
          monthSelection={monthSelection}
          readOnlyMonths={readOnlyMonths}
          collapsedGroups={collapsedGroups}
          onToggleCollapse={onToggleCollapse}
          showHidden={showHidden}
          showSpendingBars={showSpendingBars}
          showDecimals={showDecimals}
          onCellFocus={handleCellFocus}
          onCellRangeSelect={handleCellRangeSelect}
          onCellNavigate={handleCellNavigate}
          onCellContextMenu={handleCellContextMenu}
          onGroupFocus={handleGroupFocus}
          onGroupContextMenu={handleGroupContextMenu}
          onGroupRowContextMenu={handleGroupRowContextMenu}
          onMonthContextMenu={handleMonthContextMenu}
          onGroupNavigate={handleGroupNavigate}
          onRowLabelFocus={handleRowLabelFocus}
          onRowLabelNavigate={handleRowLabelNavigate}
          onClearSelection={clearGridSelection}
          onMonthSelect={handleMonthHeaderSelect}
        />
      </div>
      <BudgetSelectionSummary
        selection={selection}
        activeMonths={activeMonths}
        categories={categories}
        cellView={cellView}
      />

      {pendingBulk !== null && (
        <BulkActionDialog
          targetCells={pendingBulk.cells}
          scopeLabel={pendingBulk.scopeLabel}
          activeMonths={activeMonths}
          categories={categories}
          readOnlyMonths={readOnlyMonths}
          availableMonths={availableMonths}
          ensureMonths={ensureMonths}
          monthDataMap={(() => {
            const map: Record<string, LoadedCategory[]> = {};
            for (const month of activeMonths) {
              const state = rawMonthsMap.get(month);
              if (state) map[month] = Object.values(state.categoriesById);
            }
            return map;
          })()}
          initialAction={pendingBulk.action}
          onClose={() => setPendingBulk(null)}
        />
      )}

      {categorySearchOpen && (
        <CategoryJumpDialog
          open={categorySearchOpen}
          options={categorySearchOptions}
          onOpenChange={setCategorySearchOpen}
          onSelect={handleCategoryJumpSelect}
        />
      )}

      {contextMenu && (() => {
        const target = contextMenu.target;
        const cell = target.kind === "cell" ? target : null;
        const contextMenuBalance = cell
          ? effectiveMonthsMap.get(cell.month)?.categoriesById[cell.categoryId]?.balance
            ?? rawMonthsMap.get(cell.month)?.categoriesById[cell.categoryId]?.balance
            ?? 0
          : 0;
        const mode = contextMenuBalance < 0 ? "cover" : "transfer";
        const scope =
          target.kind === "cell" ? "cell" : target.kind === "month" ? "month" : "group";
        return (
          <BudgetCellContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            carryover={cell?.carryover ?? false}
            budgetMode={budgetMode}
            categoryBalance={contextMenuBalance}
            scope={scope}
            scopeLabel={describeContextTarget(target)}
            scopeCellCount={
              target.kind === "cell" ? undefined : resolveContextTargetCells(target).length
            }
            onToggleCarryover={handleCarryoverToggle}
            onOpenTransfer={() =>
              cell && onOpenTransfer?.(cell.categoryId, cell.month, mode)
            }
            onBulkAction={(action) => void runBulkAction(action, target)}
            onClose={() => setContextMenu(null)}
          />
        );
      })()}

      {carryoverRequest && (
        <BudgetCarryoverProgressDialog
          request={carryoverRequest.input}
          categoryLabel={carryoverRequest.categoryLabel}
          onClose={() => setCarryoverRequest(null)}
        />
      )}
    </div>
  );
}
