"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useBudgetEditsStore } from "@/store/budgetEdits";
import { useConnectionStore, selectActiveInstance } from "@/store/connection";
import { addMonths } from "@/lib/budget/monthMath";
import { parseBudgetExpression } from "../lib/budgetMath";
import { buildReadOnlyMissingBudgetMonthSet } from "../lib/monthAvailability";
import { parsePastePayload, resolveSelectionCells } from "../lib/budgetSelectionUtils";
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
import { useBulkAction, type BulkActionType } from "../hooks/useBulkAction";
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
  LoadedMonthState,
  NavDirection,
  NavItem,
  RowSelection,
  StagedBudgetEdit,
} from "../types";

const IMMEDIATE_BULK_ACTIONS: BulkActionType[] = [
  "copy-previous-month",
  "set-to-zero",
  "avg-3-months",
  "avg-6-months",
  "avg-12-months",
];

type ContextMenuState = {
  x: number;
  y: number;
  categoryId: string;
  month: string;
  carryover: boolean;
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
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null);
  const [pendingBulkAction, setPendingBulkAction] = useState<BulkActionType | null>(null);
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
  // the store's setUiSelection (mutually exclusive).
  useEffect(() => {
    if (rowSelection) {
      setRowSelectionStore(rowSelection);
    } else if (groupSelection) {
      setUiSelection(groupSelection.month, null, groupSelection.groupId);
    } else {
      setUiSelection(selection?.anchorMonth ?? null, selection?.anchorCategoryId ?? null, null);
    }
  }, [selection, groupSelection, rowSelection, setUiSelection, setRowSelectionStore]);

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

  const handleCellFocus = useCallback(
    (categoryId: string, month: string) => {
      setContextMenu(null);
      setGroupSelection(null);
      setRowSelectionLocal(null);
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
      setGroupSelection({ groupId, month });
    },
    [setSelection]
  );

  const handleRowLabelFocus = useCallback(
    (kind: "category" | "group", id: string) => {
      setContextMenu(null);
      setSelection(null);
      setGroupSelection(null);
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
    firstSelectableMonth;

  const handleCategoryJumpSelect = useCallback(
    (option: CategorySearchOption) => {
      const month = selectedMonth;
      if (!month) return;

      setContextMenu(null);
      setGroupSelection(null);
      setRowSelectionLocal(null);
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
      setContextMenu({ x, y, categoryId: catId, month, carryover });
    },
    []
  );

  // Carryover toggle — immediate API action (not staged). Opens the progress
  // dialog which drives the actual PATCH loop and shows partial-failure UI.
  const handleCarryoverToggle = useCallback(() => {
    if (!connection || !contextMenu) return;
    const { categoryId, month, carryover } = contextMenu;
    const monthsToUpdate = activeMonths.filter(
      (m) => m >= month && !readOnlyMonths.has(m)
    );
    if (monthsToUpdate.length === 0) return;

    const cat = rawMonthsMap.get(month)?.categoriesById[categoryId];

    setCarryoverRequest({
      input: {
        categoryId,
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

  // Execute no-input bulk actions immediately from the context menu.
  const handleContextMenuBulkAction = useCallback(
    (action: BulkActionType) => {
      if (!selection) return;
      if (IMMEDIATE_BULK_ACTIONS.includes(action)) {
        const monthDataMap: Record<string, LoadedCategory[]> = {};
        // In-window months: read from the provider's raw map.
        for (const month of activeMonths) {
          const state = rawMonthsMap.get(month);
          if (state) monthDataMap[month] = Object.values(state.categoriesById);
        }
        // Lookback months for avg-N-months sit outside the provider window;
        // pull them from the shared TanStack cache when present.
        if (action === "avg-3-months" || action === "avg-6-months" || action === "avg-12-months") {
          const lookback = action === "avg-3-months" ? 3 : action === "avg-6-months" ? 6 : 12;
          let m = activeMonths[0] ?? "";
          for (let i = 0; i < lookback; i++) {
            m = addMonths(m, -1);
            const state = queryClient.getQueryData<LoadedMonthState>(["budget-month-data", connection?.id, m]);
            if (state) monthDataMap[m] = Object.values(state.categoriesById);
          }
        }
        const rows = previewBulk(action, selection, activeMonths, categories, monthDataMap)
          ?.filter((row) => !readOnlyMonths.has(row.month));
        if (rows && rows.length > 0) applyBulk(rows);
      } else {
        setPendingBulkAction(action);
      }
    },
    [
      selection,
      activeMonths,
      categories,
      rawMonthsMap,
      queryClient,
      connection,
      previewBulk,
      applyBulk,
      readOnlyMonths,
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
    handleContextMenuBulkAction("copy-previous-month");
    return true;
  }, [selection, handleContextMenuBulkAction]);

  const fillAvg3 = useCallback((): boolean => {
    if (!selection) return false;
    handleContextMenuBulkAction("avg-3-months");
    return true;
  }, [selection, handleContextMenuBulkAction]);

  // Alt+C: toggle carryover for the anchor's category across the selected
  // month range. The carryover dialog API is single-category, so a
  // multi-category selection is downgraded to the anchor's category — the
  // user can repeat Alt+C with each category selected. Right-click still
  // exposes the per-cell forward-propagation flow.
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

    setCarryoverRequest({
      input: {
        categoryId: anchorCatId,
        months: monthsToUpdate,
        newValue: !anchorCat.carryover,
      },
      categoryLabel: anchorCat.name,
    });
    return true;
  }, [selection, connection, activeMonths, readOnlyMonths, rawMonthsMap]);

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
          readOnlyMonths={readOnlyMonths}
          collapsedGroups={collapsedGroups}
          onToggleCollapse={onToggleCollapse}
          showHidden={showHidden}
          onCellFocus={handleCellFocus}
          onCellRangeSelect={handleCellRangeSelect}
          onCellNavigate={handleCellNavigate}
          onCellContextMenu={handleCellContextMenu}
          onGroupFocus={handleGroupFocus}
          onGroupNavigate={handleGroupNavigate}
          onRowLabelFocus={handleRowLabelFocus}
          onRowLabelNavigate={handleRowLabelNavigate}
          onClearSelection={clearGridSelection}
        />
      </div>
      <BudgetSelectionSummary
        selection={selection}
        activeMonths={activeMonths}
        categories={categories}
      />

      {pendingBulkAction !== null && selection && (
        <BulkActionDialog
          selection={selection}
          activeMonths={activeMonths}
          categories={categories}
          readOnlyMonths={readOnlyMonths}
          monthDataMap={(() => {
            const map: Record<string, LoadedCategory[]> = {};
            for (const month of activeMonths) {
              const state = rawMonthsMap.get(month);
              if (state) map[month] = Object.values(state.categoriesById);
            }
            return map;
          })()}
          initialAction={pendingBulkAction}
          onClose={() => setPendingBulkAction(null)}
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
        const contextMenuBalance =
          effectiveMonthsMap.get(contextMenu.month)?.categoriesById[contextMenu.categoryId]?.balance
          ?? rawMonthsMap.get(contextMenu.month)?.categoriesById[contextMenu.categoryId]?.balance
          ?? 0;
        const mode = contextMenuBalance < 0 ? "cover" : "transfer";
        return (
          <BudgetCellContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            carryover={contextMenu.carryover}
            budgetMode={budgetMode}
            categoryBalance={contextMenuBalance}
            onToggleCarryover={handleCarryoverToggle}
            onOpenTransfer={() => onOpenTransfer?.(contextMenu.categoryId, contextMenu.month, mode)}
            onBulkAction={handleContextMenuBulkAction}
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
