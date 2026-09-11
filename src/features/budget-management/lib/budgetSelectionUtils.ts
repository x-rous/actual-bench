/**
 * Budget grid selection utilities.
 *
 * resolveSelectionCells: converts an anchor/focus BudgetCellSelection into
 * an explicit flat list of (month, categoryId) pairs for the rectangular region.
 *
 * parsePastePayload: splits tab-and-newline-delimited clipboard text (the
 * format produced by spreadsheet / grid copy operations) into a 2D array of
 * cell strings. Distinct from parseCsv which handles comma-separated files.
 */

import type { BudgetCellSelection, LoadedCategory } from "../types";

export type ResolvedCell = { month: string; categoryId: string };

/**
 * Every cell under a category group, for the given months.
 *
 * A group row is a summarization layer over its categories, so acting on one is
 * defined as acting on all of them. `categories` is the caller's visible list,
 * which is filtered by `showHidden` but never by collapse state - so a
 * collapsed group resolves exactly like an expanded one and nothing has to be
 * opened first.
 */
export function resolveGroupCells(
  groupId: string,
  months: readonly string[],
  categories: readonly LoadedCategory[]
): ResolvedCell[] {
  const cells: ResolvedCell[] = [];
  for (const month of months) {
    for (const cat of categories) {
      if (cat.groupId === groupId) cells.push({ month, categoryId: cat.id });
    }
  }
  return cells;
}

/** Every visible category's cell in one month - a whole column. */
export function resolveMonthCells(
  month: string,
  categories: readonly LoadedCategory[]
): ResolvedCell[] {
  return categories.map((cat) => ({ month, categoryId: cat.id }));
}

/**
 * Resolves a BudgetCellSelection to a flat list of (month, categoryId) pairs.
 * Uses the positions of anchor/focus months and categories in the provided
 * ordered arrays to determine the rectangular range.
 */
export function resolveSelectionCells(
  selection: BudgetCellSelection,
  months: string[],
  categories: LoadedCategory[]
): ResolvedCell[] {
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
    return [];
  }

  const minMonthIdx = Math.min(anchorMonthIdx, focusMonthIdx);
  const maxMonthIdx = Math.max(anchorMonthIdx, focusMonthIdx);
  const minCatIdx = Math.min(anchorCatIdx, focusCatIdx);
  const maxCatIdx = Math.max(anchorCatIdx, focusCatIdx);

  const cells: ResolvedCell[] = [];
  for (let mi = minMonthIdx; mi <= maxMonthIdx; mi++) {
    for (let ci = minCatIdx; ci <= maxCatIdx; ci++) {
      const month = months[mi];
      const cat = categories[ci];
      if (month && cat) {
        cells.push({ month, categoryId: cat.id });
      }
    }
  }
  return cells;
}

/**
 * Parses tab-and-newline-delimited clipboard paste text into a 2D array.
 * Rows are split on newlines; cells within each row are split on tabs.
 * Trailing empty rows (from a trailing newline) are discarded.
 */
export function parsePastePayload(text: string): string[][] {
  const rows = text.split(/\r?\n/);
  // Remove trailing empty row produced by a trailing newline
  if (rows.length > 0 && rows[rows.length - 1] === "") {
    rows.pop();
  }
  return rows.map((row) => row.split("\t"));
}
