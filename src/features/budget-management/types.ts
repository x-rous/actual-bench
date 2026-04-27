/**
 * Domain types for the Budget Management Workspace feature.
 *
 * All types are sourced from specs/001-budget-management-workspace/data-model.md.
 * Amounts are in minor units (integer, 100ths of currency unit).
 */

// ─── Core domain ─────────────────────────────────────────────────────────────

/**
 * Lowercase canonical form for the feature.
 * Mapped from overview's "Envelope" | "Tracking" | "Unidentified" at the hook boundary.
 */
export type BudgetMode = "envelope" | "tracking" | "unidentified";

/** Composite key uniquely identifying a category-month intersection. */
export type BudgetCellKey = `${string}:${string}`; // `${month}:${categoryId}`

// ─── Loaded server data ───────────────────────────────────────────────────────

/** Month-level summary totals — top-level fields from GET /months/{month}. */
export type BudgetMonthSummary = {
  month: string;
  incomeAvailable: number;
  lastMonthOverspent: number;
  forNextMonth: number;
  totalBudgeted: number;
  toBudget: number;
  fromLastMonth: number;
  totalIncome: number;
  totalSpent: number;
  totalBalance: number;
};

/**
 * A normalized category group.
 * `categoryIds` preserves the API-returned category order within the group.
 * `isIncome` is the authoritative flag — present at both group and category level in the API.
 */
export type LoadedGroup = {
  id: string;
  name: string;
  isIncome: boolean;
  hidden: boolean;
  categoryIds: string[];  // ordered list — use with LoadedMonthState.categoriesById
  budgeted: number;
  /** Actual money flow for the month: `spent` (expense groups) or `received` (income groups). */
  actuals: number;
  balance: number;
};

/**
 * A normalized budget category.
 * `isIncome` is inherited from the parent group at parse time.
 * `groupName` is denormalized at parse time.
 */
export type LoadedCategory = {
  id: string;
  name: string;
  groupId: string;
  groupName: string;
  isIncome: boolean;
  hidden: boolean;
  budgeted: number;
  /** Actual money flow for the month: `spent` (expense categories) or `received` (income categories). */
  actuals: number;
  balance: number;
  carryover: boolean;
};

/**
 * Normalized in-memory month state produced by useMonthData.
 * `groupOrder` preserves the API-returned group order.
 * Use groupOrder + groupsById to iterate groups in order.
 */
export type LoadedMonthState = {
  summary: BudgetMonthSummary;
  groupsById: Record<string, LoadedGroup>;
  categoriesById: Record<string, LoadedCategory>;
  groupOrder: string[];
};

// ─── Staged edits ─────────────────────────────────────────────────────────────

/** Stored in budgetEditsStore as Record<BudgetCellKey, StagedBudgetEdit>. */
export type StagedBudgetEdit = {
  month: string;
  categoryId: string;
  nextBudgeted: number;
  previousBudgeted: number;
  source: "manual" | "paste" | "bulk-action" | "import";
  saveError?: string;
};

/**
 * @deprecated As of BM-19, undo/redo uses inverse patches rather than full
 * snapshots. Kept exported only so external callers can still import the
 * name; new code should reference the patch shape in `store/budgetEdits.ts`.
 */
export type BudgetEditSnapshot = Record<BudgetCellKey, StagedBudgetEdit>;

/** Internal patch shape used by the undo/redo stack (BM-19). */
export type BudgetEditPatch = {
  key: BudgetCellKey;
  prev: StagedBudgetEdit | undefined;
};

// ─── Navigation ───────────────────────────────────────────────────────────────

export type NavDirection =
  | "up" | "down" | "left" | "right"
  | "shift-up" | "shift-down" | "shift-left" | "shift-right"
  | "tab" | "shift-tab";

/** What value the grid cells display. Only "budgeted" allows editing. */
export type CellView = "budgeted" | "spent" | "balance";

// ─── Selection ────────────────────────────────────────────────────────────────

/** Local state within the workspace — not persisted. */
export type BudgetCellSelection = {
  anchorMonth: string;
  anchorCategoryId: string;
  focusMonth: string;
  focusCategoryId: string;
};

/** Derived from BudgetCellSelection + StagedBudgetEdit map. */
export type BudgetSelectionSummary = {
  selectedMonths: string[];
  selectedCategoryIds: string[];
  totalCellsInSelection: number;
  affectedCellCount: number;
  totalStagedDelta: number;
};

// ─── Save ─────────────────────────────────────────────────────────────────────

/** Returned by useBudgetSave after a save attempt. */
export type BudgetSaveResult = {
  month: string;
  categoryId: string;
  status: "success" | "error";
  message?: string;
};

// ─── Envelope immediate actions ───────────────────────────────────────────────

/** Input for POST /months/{month}/categorytransfers */
export type CategoryTransferInput = {
  fromCategoryId: string;
  toCategoryId: string;
  amount: number;
};

/** Input for POST /months/{month}/nextmonthbudgethold */
export type NextMonthHoldInput = {
  amount: number;
};

// ─── Store shape ──────────────────────────────────────────────────────────────

/** Flat navigation item for the interleaved keyboard-nav list in BudgetWorkspace. */
export type NavItem =
  | { type: "category"; id: string }
  | { type: "group"; id: string };

/** Whole-row selection on the first column (category label or group label). */
export type RowSelection = { kind: "category" | "group"; id: string };

export type BudgetEditsState = {
  edits: Record<BudgetCellKey, StagedBudgetEdit>;
  /** BM-19: stack of inverse-patch lists. Each list reverses one user action. */
  undoStack: BudgetEditPatch[][];
  redoStack: BudgetEditPatch[][];
  /** Currently focused cell or group — synced by BudgetWorkspace so BudgetDraftPanel can read it. */
  uiSelection: { month: string | null; categoryId: string | null; groupId: string | null };
  /** Currently selected row label, mutually exclusive with uiSelection. */
  rowSelection: RowSelection | null;
  /** The 12 months currently visible in the grid window — synced by BudgetManagementView. */
  displayMonths: string[];
};

export type BudgetEditsActions = {
  stageEdit: (edit: StagedBudgetEdit) => void;
  stageBulkEdits: (edits: StagedBudgetEdit[]) => void;
  removeEdit: (key: BudgetCellKey) => void;
  discardAll: () => void;
  clearEditsForMonths: (months: string[]) => void;
  clearEditsForKeys: (keys: BudgetCellKey[]) => void;
  setSaveError: (key: BudgetCellKey, message: string) => void;
  clearSaveError: (key: BudgetCellKey) => void;
  pushUndo: () => void;
  undo: () => void;
  redo: () => void;
  hasPendingEdits: () => boolean;
  /** Pass groupId to indicate a group row is selected; pass categoryId for a category cell.
   *  The two are mutually exclusive — whichever is non-null takes precedence. */
  setUiSelection: (month: string | null, categoryId: string | null, groupId?: string | null) => void;
  /** Set the row-label selection; clears any cell/group-cell selection in uiSelection. */
  setRowSelection: (selection: RowSelection | null) => void;
  setDisplayMonths: (months: string[]) => void;
};
