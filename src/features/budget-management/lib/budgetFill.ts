import type {
  BudgetCellSelection,
  LoadedCategory,
  StagedBudgetEdit,
} from "../types";

/**
 * Cell-level value lookup used by the fill helpers. Returns:
 *   - `current`: effective value (staged value if any, else server-persisted)
 *   - `server`:  server-persisted value (becomes `previousBudgeted` on the
 *                staged edit so undo restores the canonical baseline)
 * Returns `null` when the cell isn't present in the workspace data (e.g.
 * a category that doesn't exist in that month). Callers skip `null`.
 */
export type FillSourceLookup = (
  month: string,
  categoryId: string
) => { current: number; server: number } | null;

type Bounds = {
  minMonthIdx: number;
  maxMonthIdx: number;
  minCatIdx: number;
  maxCatIdx: number;
};

function computeBounds(
  selection: BudgetCellSelection,
  months: string[],
  categories: LoadedCategory[]
): Bounds | null {
  const anchorMonthIdx = months.indexOf(selection.anchorMonth);
  const focusMonthIdx = months.indexOf(selection.focusMonth);
  const anchorCatIdx = categories.findIndex(
    (c) => c.id === selection.anchorCategoryId
  );
  const focusCatIdx = categories.findIndex(
    (c) => c.id === selection.focusCategoryId
  );
  if (
    anchorMonthIdx === -1 ||
    focusMonthIdx === -1 ||
    anchorCatIdx === -1 ||
    focusCatIdx === -1
  ) {
    return null;
  }
  return {
    minMonthIdx: Math.min(anchorMonthIdx, focusMonthIdx),
    maxMonthIdx: Math.max(anchorMonthIdx, focusMonthIdx),
    minCatIdx: Math.min(anchorCatIdx, focusCatIdx),
    maxCatIdx: Math.max(anchorCatIdx, focusCatIdx),
  };
}

function makeEdit(
  month: string,
  categoryId: string,
  next: number,
  server: number
): StagedBudgetEdit {
  return {
    month,
    categoryId,
    nextBudgeted: next,
    previousBudgeted: server,
    source: "manual",
  };
}

/**
 * Ctrl+Enter: apply the anchor cell's effective value to every cell in the
 * selection rectangle. Returns `null` when the selection is invalid or the
 * anchor's value is unavailable.
 */
export function buildFillFromActiveEdits(
  selection: BudgetCellSelection,
  months: string[],
  categories: LoadedCategory[],
  lookup: FillSourceLookup
): StagedBudgetEdit[] | null {
  const bounds = computeBounds(selection, months, categories);
  if (!bounds) return null;
  const anchor = lookup(selection.anchorMonth, selection.anchorCategoryId);
  if (!anchor) return null;
  const value = anchor.current;

  const edits: StagedBudgetEdit[] = [];
  for (let mi = bounds.minMonthIdx; mi <= bounds.maxMonthIdx; mi++) {
    const month = months[mi];
    if (!month) continue;
    for (let ci = bounds.minCatIdx; ci <= bounds.maxCatIdx; ci++) {
      const cat = categories[ci];
      if (!cat) continue;
      // Skip the anchor itself if it'd be a no-op.
      if (mi === months.indexOf(selection.anchorMonth) && cat.id === selection.anchorCategoryId) {
        if (anchor.current === anchor.server) continue;
      }
      const target = lookup(month, cat.id);
      if (!target) continue;
      edits.push(makeEdit(month, cat.id, value, target.server));
    }
  }
  return edits;
}

/**
 * Ctrl+D: per column, copy the topmost cell's value down. Returns `null`
 * when the selection has fewer than 2 rows (nothing to fill into).
 */
export function buildFillDownEdits(
  selection: BudgetCellSelection,
  months: string[],
  categories: LoadedCategory[],
  lookup: FillSourceLookup
): StagedBudgetEdit[] | null {
  const bounds = computeBounds(selection, months, categories);
  if (!bounds) return null;
  if (bounds.maxCatIdx === bounds.minCatIdx) return null;

  const edits: StagedBudgetEdit[] = [];
  for (let mi = bounds.minMonthIdx; mi <= bounds.maxMonthIdx; mi++) {
    const month = months[mi];
    if (!month) continue;
    const sourceCat = categories[bounds.minCatIdx];
    if (!sourceCat) continue;
    const source = lookup(month, sourceCat.id);
    if (!source) continue;
    const value = source.current;
    for (let ci = bounds.minCatIdx + 1; ci <= bounds.maxCatIdx; ci++) {
      const cat = categories[ci];
      if (!cat) continue;
      const target = lookup(month, cat.id);
      if (!target) continue;
      edits.push(makeEdit(month, cat.id, value, target.server));
    }
  }
  return edits;
}

/**
 * Ctrl+R: per row, copy the leftmost cell's value rightward. Returns `null`
 * when the selection has fewer than 2 columns.
 */
export function buildFillRightEdits(
  selection: BudgetCellSelection,
  months: string[],
  categories: LoadedCategory[],
  lookup: FillSourceLookup
): StagedBudgetEdit[] | null {
  const bounds = computeBounds(selection, months, categories);
  if (!bounds) return null;
  if (bounds.maxMonthIdx === bounds.minMonthIdx) return null;

  const edits: StagedBudgetEdit[] = [];
  for (let ci = bounds.minCatIdx; ci <= bounds.maxCatIdx; ci++) {
    const cat = categories[ci];
    if (!cat) continue;
    const sourceMonth = months[bounds.minMonthIdx];
    if (!sourceMonth) continue;
    const source = lookup(sourceMonth, cat.id);
    if (!source) continue;
    const value = source.current;
    for (let mi = bounds.minMonthIdx + 1; mi <= bounds.maxMonthIdx; mi++) {
      const month = months[mi];
      if (!month) continue;
      const target = lookup(month, cat.id);
      if (!target) continue;
      edits.push(makeEdit(month, cat.id, value, target.server));
    }
  }
  return edits;
}
