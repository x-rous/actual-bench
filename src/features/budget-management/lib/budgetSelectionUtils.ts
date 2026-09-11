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
 * The selection rectangle standing for a whole category group.
 *
 * A group's categories occupy a contiguous run in `categories` (it is built by
 * flattening groups in order), so "this group" needs no selection shape of its
 * own - it is an ordinary anchor/focus pair. That is what lets the footer, the
 * grid highlight, copy/paste and the bulk actions treat a group exactly as they
 * treat a dragged range, with no special case anywhere.
 *
 * Returns null when the group contributes no visible categories - every one of
 * them hidden with the toggle off - because there is then nothing to select.
 */
export function resolveGroupSelection(
  groupId: string,
  categories: readonly LoadedCategory[],
  months: readonly string[]
): BudgetCellSelection | null {
  const inGroup = categories.filter((c) => c.groupId === groupId);
  const firstMonth = months[0];
  const lastMonth = months[months.length - 1];
  if (inGroup.length === 0 || !firstMonth || !lastMonth) return null;
  return {
    anchorCategoryId: inGroup[0]!.id,
    anchorMonth: firstMonth,
    focusCategoryId: inGroup[inGroup.length - 1]!.id,
    focusMonth: lastMonth,
  };
}

/**
 * Shift-clicking a group row: keep the existing anchor, move the focus to the
 * far edge of the group.
 *
 * Extending to the group's *last* category is what makes the gesture behave the
 * way a drag would - the range grows to swallow the whole group rather than
 * stopping at whichever row was clicked. With no existing selection there is
 * nothing to extend from, so the group's own range stands.
 */
export function extendSelectionToGroup(
  previous: BudgetCellSelection | null,
  groupRange: BudgetCellSelection,
  month: string
): BudgetCellSelection {
  if (!previous) return groupRange;
  return {
    ...previous,
    focusCategoryId: groupRange.focusCategoryId,
    focusMonth: month,
  };
}

/** How much of a group the current selection covers, for its row's indicator. */
export type GroupCoverage = "none" | "some" | "all";

/**
 * Whether a group's categories are wholly, partly or not at all inside a
 * selected index range.
 *
 * This is what makes a range spanning a **collapsed** group legible: its cells
 * are not rendered, so without the group row reporting them there is no way to
 * see what was caught. `bounds` is the same category index range the grid
 * already computes to highlight cells.
 */
export function groupSelectionCoverage(
  groupId: string,
  categories: readonly LoadedCategory[],
  bounds: { minCatIdx: number; maxCatIdx: number } | null
): GroupCoverage {
  if (!bounds) return "none";
  let total = 0;
  let covered = 0;
  for (let i = 0; i < categories.length; i++) {
    if (categories[i]!.groupId !== groupId) continue;
    total++;
    if (i >= bounds.minCatIdx && i <= bounds.maxCatIdx) covered++;
  }
  if (total === 0 || covered === 0) return "none";
  return covered === total ? "all" : "some";
}

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
