import type { NavDirection } from "../types";

/**
 * Per-scope handler context. Each scope's handlers receive a focused
 * context shape — keeps the surface narrow and the unit-tests trivial.
 *
 * Phase 0 only includes fields used by the currently-wired shortcuts.
 * Later phases will extend these as new actions are added.
 */

export type CellContext = {
  /** True when the cell is income+envelope (income editing blocked). */
  blocked: boolean;
  /** True when the active CellView isn't editable (spent / balance). */
  viewBlocked: boolean;
  navigate: (dir: NavDirection) => void;
  enterEdit: (initialChar?: string) => void;
  /** Zero out this cell's budgeted value (handles already-zero + revert-to-original cases). */
  clearValue: () => void;
};

export type CellEditContext = {
  /** Returns true if the commit succeeded (value parsed cleanly). */
  commitEdit: () => boolean;
  cancelEdit: () => void;
  navigate: (dir: NavDirection) => void;
};

export type GroupCellContext = {
  navigate: (dir: NavDirection) => void;
  toggleCollapse: () => void;
};

export type RowLabelContext = {
  /** The row label is always in the leftmost column — left-arrow no-ops. */
  navigate: (dir: NavDirection) => void;
  /** Provided for group rows; omitted for category rows (Space binding inert there). */
  toggleCollapse?: () => void;
};

export type WorkspaceContext = {
  undo: () => void;
  redo: () => void;
  /**
   * Returns `false` when there's no selection — lets the dispatcher fall
   * through so the browser's default Ctrl+C still works (no selection
   * means there's nothing to copy in the grid).
   */
  copySelection: () => boolean;
  /**
   * Multi-cell zero. Returning `false` lets the keymap dispatcher know the
   * action was a no-op for this scope so it can avoid swallowing the event
   * — single-cell Delete is handled by `BudgetCell` and the workspace
   * should stay out of its way.
   */
  zeroMultiCellSelection: () => boolean;
  // ── Tier 2 range-edit ──────────────────────────────────────────────────
  /** Returns `false` when there's no selection. */
  fillFromActive: () => boolean;
  /** Returns `false` when selection is single-row (nothing to fill into). */
  fillDown: () => boolean;
  /** Returns `false` when selection is single-column. */
  fillRight: () => boolean;
  /** Wraps the existing `copy-previous-month` bulk action. */
  fillPrevMonth: () => boolean;
  /** Wraps the existing `avg-3-months` bulk action. */
  fillAvg3: () => boolean;
  // ── Tier 3 view & visibility ───────────────────────────────────────────
  cycleCellView: () => void;
  toggleShowHidden: () => void;
  expandAll: () => void;
  collapseAll: () => void;
  panMonthsPrev: () => void;
  panMonthsNext: () => void;
  // ── Tier 4 selection actions ───────────────────────────────────────────
  /**
   * Toggle carryover for the anchor cell's category across the selected
   * month range. Returns `false` when there's no selection or when the
   * anchor cell isn't loaded yet (so the caller doesn't preventDefault).
   */
  toggleCarryoverForSelection: () => boolean;
  // ── Discoverability ────────────────────────────────────────────────────
  openShortcutsHelp: () => void;
};
