import type { NavDirection, NavItem } from "../types";

/**
 * Pure target computation for cursor navigation in the budget grid.
 *
 * The grid model:
 *   - `navItems`  — interleaved list: group rows + (when expanded) their categories.
 *   - `monthIdx`  — 0..monthCount-1 for data columns; -1 for the row-label column.
 *
 * Two pure functions live here so the keymap layer can be unit-tested
 * without rendering the workspace:
 *   - `computeCursorTarget`           single-cursor moves (no range extension).
 *   - `computeRangeExtensionTarget`   shift-* range moves (focus only, anchor stays).
 *
 * Side effects (setSelection, focus DOM, clear context menus) live in
 * `BudgetWorkspace.navigateFrom`.
 */

export type CursorPos = { itemIdx: number; monthIdx: number };

function isSkippedMonth(
  monthIdx: number,
  skippedMonthIdxs?: ReadonlySet<number>
): boolean {
  return monthIdx >= 0 && skippedMonthIdxs?.has(monthIdx) === true;
}

function findNextNavigableMonth(
  startMonthIdx: number,
  step: 1 | -1,
  lastMonthIdx: number,
  skippedMonthIdxs?: ReadonlySet<number>
): number | null {
  for (
    let monthIdx = startMonthIdx;
    monthIdx >= 0 && monthIdx <= lastMonthIdx;
    monthIdx += step
  ) {
    if (!isSkippedMonth(monthIdx, skippedMonthIdxs)) return monthIdx;
  }
  return null;
}

function firstNavigableMonth(
  lastMonthIdx: number,
  skippedMonthIdxs?: ReadonlySet<number>
): number {
  return findNextNavigableMonth(0, 1, lastMonthIdx, skippedMonthIdxs) ?? -1;
}

function lastNavigableMonth(
  lastMonthIdx: number,
  skippedMonthIdxs?: ReadonlySet<number>
): number {
  return (
    findNextNavigableMonth(
      lastMonthIdx,
      -1,
      lastMonthIdx,
      skippedMonthIdxs
    ) ?? -1
  );
}

/**
 * `shift-*` directions extend the selection focus instead of moving the
 * cursor — except for `shift-tab`, which is a wrap-aware backwards tab.
 */
export function isRangeExtensionDir(dir: NavDirection): boolean {
  return dir.startsWith("shift-") && dir !== "shift-tab";
}

// ─── Single-cursor moves ──────────────────────────────────────────────────

export type CursorNavInput = {
  navItems: NavItem[];
  monthCount: number;
  skippedMonthIdxs?: ReadonlySet<number>;
  current: CursorPos;
  dir: NavDirection;
  pageSize: number;
};

/** Returns null when the direction isn't a single-cursor move (e.g. shift-*). */
export function computeCursorTarget(input: CursorNavInput): CursorPos | null {
  const { navItems, monthCount, skippedMonthIdxs, current, dir, pageSize } =
    input;
  const lastItemIdx = navItems.length - 1;
  const lastMonthIdx = monthCount - 1;
  let newItemIdx = current.itemIdx;
  let newMonthIdx = current.monthIdx;

  switch (dir) {
    case "up":
      newItemIdx = Math.max(0, current.itemIdx - 1);
      break;
    case "down":
      newItemIdx = Math.min(lastItemIdx, current.itemIdx + 1);
      break;
    case "left":
      // -1 is the label column; never go further left.
      newMonthIdx =
        findNextNavigableMonth(
          current.monthIdx - 1,
          -1,
          lastMonthIdx,
          skippedMonthIdxs
        ) ?? -1;
      break;
    case "right":
      newMonthIdx =
        findNextNavigableMonth(
          Math.max(0, current.monthIdx + 1),
          1,
          lastMonthIdx,
          skippedMonthIdxs
        ) ?? current.monthIdx;
      break;
    case "page-up":
      newItemIdx = Math.max(0, current.itemIdx - pageSize);
      break;
    case "page-down":
      newItemIdx = Math.min(lastItemIdx, current.itemIdx + pageSize);
      break;
    case "row-start":
      newMonthIdx = firstNavigableMonth(lastMonthIdx, skippedMonthIdxs);
      break;
    case "row-end":
      newMonthIdx = lastNavigableMonth(lastMonthIdx, skippedMonthIdxs);
      break;
    case "grid-start":
      newItemIdx = 0;
      newMonthIdx = firstNavigableMonth(lastMonthIdx, skippedMonthIdxs);
      break;
    case "grid-end":
      newItemIdx = lastItemIdx;
      newMonthIdx = lastNavigableMonth(lastMonthIdx, skippedMonthIdxs);
      break;
    case "section-up": {
      // Walk back to the previous group row. If currently on a group, skip
      // past it to the one above; if no earlier group exists, land on item 0.
      let i = current.itemIdx - 1;
      while (i >= 0 && navItems[i]?.type !== "group") i--;
      newItemIdx = i >= 0 ? i : 0;
      break;
    }
    case "section-down": {
      // Walk forward to the next group row; clamp at the last item.
      let i = current.itemIdx + 1;
      while (i <= lastItemIdx && navItems[i]?.type !== "group") i++;
      newItemIdx = i <= lastItemIdx ? i : lastItemIdx;
      break;
    }
    case "tab":
      if (
        current.monthIdx < lastMonthIdx &&
        findNextNavigableMonth(
          Math.max(0, current.monthIdx + 1),
          1,
          lastMonthIdx,
          skippedMonthIdxs
        ) !== null
      ) {
        newMonthIdx = findNextNavigableMonth(
          Math.max(0, current.monthIdx + 1),
          1,
          lastMonthIdx,
          skippedMonthIdxs
        )!;
      } else {
        // Wrap to the next row's label column.
        newMonthIdx = -1;
        newItemIdx = Math.min(lastItemIdx, current.itemIdx + 1);
      }
      break;
    case "shift-tab":
      if (current.monthIdx > -1) {
        newMonthIdx =
          findNextNavigableMonth(
            current.monthIdx - 1,
            -1,
            lastMonthIdx,
            skippedMonthIdxs
          ) ?? -1;
      } else {
        // Wrap to the previous row's last data cell.
        newMonthIdx = lastNavigableMonth(lastMonthIdx, skippedMonthIdxs);
        newItemIdx = Math.max(0, current.itemIdx - 1);
      }
      break;
    default:
      return null;
  }

  return { itemIdx: newItemIdx, monthIdx: newMonthIdx };
}

// ─── Range-extension moves (shift-*) ──────────────────────────────────────

export type RangeExtensionInput = {
  /** Categories only — group rows are not selectable for range extension. */
  catItems: NavItem[];
  monthCount: number;
  skippedMonthIdxs?: ReadonlySet<number>;
  /** Current focus position. itemIdx is into `catItems`; monthIdx is 0..N-1. */
  focus: CursorPos;
  dir: NavDirection;
  pageSize: number;
};

/** Returns null for non-extension directions. */
export function computeRangeExtensionTarget(
  input: RangeExtensionInput
): CursorPos | null {
  const { catItems, monthCount, skippedMonthIdxs, focus, dir, pageSize } =
    input;
  const lastCatIdx = catItems.length - 1;
  const lastMonthIdx = monthCount - 1;
  let newCatIdx = focus.itemIdx;
  let newMonthIdx = focus.monthIdx;

  switch (dir) {
    case "shift-up":
      newCatIdx = Math.max(0, focus.itemIdx - 1);
      break;
    case "shift-down":
      newCatIdx = Math.min(lastCatIdx, focus.itemIdx + 1);
      break;
    case "shift-left":
      newMonthIdx =
        findNextNavigableMonth(
          focus.monthIdx - 1,
          -1,
          lastMonthIdx,
          skippedMonthIdxs
        ) ?? focus.monthIdx;
      break;
    case "shift-right":
      newMonthIdx =
        findNextNavigableMonth(
          focus.monthIdx + 1,
          1,
          lastMonthIdx,
          skippedMonthIdxs
        ) ?? focus.monthIdx;
      break;
    case "shift-page-up":
      newCatIdx = Math.max(0, focus.itemIdx - pageSize);
      break;
    case "shift-page-down":
      newCatIdx = Math.min(lastCatIdx, focus.itemIdx + pageSize);
      break;
    case "shift-row-start":
      newMonthIdx =
        firstNavigableMonth(lastMonthIdx, skippedMonthIdxs) === -1
          ? focus.monthIdx
          : firstNavigableMonth(lastMonthIdx, skippedMonthIdxs);
      break;
    case "shift-row-end":
      newMonthIdx =
        lastNavigableMonth(lastMonthIdx, skippedMonthIdxs) === -1
          ? focus.monthIdx
          : lastNavigableMonth(lastMonthIdx, skippedMonthIdxs);
      break;
    case "shift-grid-start":
      newCatIdx = 0;
      newMonthIdx =
        firstNavigableMonth(lastMonthIdx, skippedMonthIdxs) === -1
          ? focus.monthIdx
          : firstNavigableMonth(lastMonthIdx, skippedMonthIdxs);
      break;
    case "shift-grid-end":
      newCatIdx = lastCatIdx;
      newMonthIdx =
        lastNavigableMonth(lastMonthIdx, skippedMonthIdxs) === -1
          ? focus.monthIdx
          : lastNavigableMonth(lastMonthIdx, skippedMonthIdxs);
      break;
    default:
      return null;
  }

  return { itemIdx: newCatIdx, monthIdx: newMonthIdx };
}
