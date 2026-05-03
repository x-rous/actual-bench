import {
  computeCursorTarget,
  computeRangeExtensionTarget,
  type CursorPos,
} from "./cursorNav";
import type { NavDirection, NavItem } from "../types";

// Test fixture: 2 expense groups (each with 3 cats) + 1 income group (1 cat).
//   nav[0]  group A
//   nav[1]  cat A1
//   nav[2]  cat A2
//   nav[3]  cat A3
//   nav[4]  group B
//   nav[5]  cat B1
//   nav[6]  cat B2
//   nav[7]  cat B3
//   nav[8]  group C (income)
//   nav[9]  cat C1
const NAV_ITEMS: NavItem[] = [
  { type: "group", id: "A" },
  { type: "category", id: "A1" },
  { type: "category", id: "A2" },
  { type: "category", id: "A3" },
  { type: "group", id: "B" },
  { type: "category", id: "B1" },
  { type: "category", id: "B2" },
  { type: "category", id: "B3" },
  { type: "group", id: "C" },
  { type: "category", id: "C1" },
];

const CAT_ITEMS: NavItem[] = NAV_ITEMS.filter((i) => i.type === "category");

const MONTH_COUNT = 12;
const PAGE_SIZE = 10;

function move(current: CursorPos, dir: NavDirection): CursorPos | null {
  return computeCursorTarget({ navItems: NAV_ITEMS, monthCount: MONTH_COUNT, current, dir, pageSize: PAGE_SIZE });
}

function moveSkipping(
  current: CursorPos,
  dir: NavDirection,
  skippedMonthIdxs: ReadonlySet<number>
): CursorPos | null {
  return computeCursorTarget({
    navItems: NAV_ITEMS,
    monthCount: MONTH_COUNT,
    skippedMonthIdxs,
    current,
    dir,
    pageSize: PAGE_SIZE,
  });
}

function extend(focus: CursorPos, dir: NavDirection): CursorPos | null {
  return computeRangeExtensionTarget({ catItems: CAT_ITEMS, monthCount: MONTH_COUNT, focus, dir, pageSize: PAGE_SIZE });
}

function extendSkipping(
  focus: CursorPos,
  dir: NavDirection,
  skippedMonthIdxs: ReadonlySet<number>
): CursorPos | null {
  return computeRangeExtensionTarget({
    catItems: CAT_ITEMS,
    monthCount: MONTH_COUNT,
    skippedMonthIdxs,
    focus,
    dir,
    pageSize: PAGE_SIZE,
  });
}

describe("computeCursorTarget — single step", () => {
  it("up moves one item up, clamped at 0", () => {
    expect(move({ itemIdx: 5, monthIdx: 3 }, "up")).toEqual({ itemIdx: 4, monthIdx: 3 });
    expect(move({ itemIdx: 0, monthIdx: 3 }, "up")).toEqual({ itemIdx: 0, monthIdx: 3 });
  });

  it("down moves one item down, clamped at last", () => {
    expect(move({ itemIdx: 5, monthIdx: 3 }, "down")).toEqual({ itemIdx: 6, monthIdx: 3 });
    expect(move({ itemIdx: 9, monthIdx: 3 }, "down")).toEqual({ itemIdx: 9, monthIdx: 3 });
  });

  it("left moves one month left, allows entering label column", () => {
    expect(move({ itemIdx: 5, monthIdx: 3 }, "left")).toEqual({ itemIdx: 5, monthIdx: 2 });
    expect(move({ itemIdx: 5, monthIdx: 0 }, "left")).toEqual({ itemIdx: 5, monthIdx: -1 });
    expect(move({ itemIdx: 5, monthIdx: -1 }, "left")).toEqual({ itemIdx: 5, monthIdx: -1 });
  });

  it("right moves one month right, clamped at last", () => {
    expect(move({ itemIdx: 5, monthIdx: 3 }, "right")).toEqual({ itemIdx: 5, monthIdx: 4 });
    expect(move({ itemIdx: 5, monthIdx: 11 }, "right")).toEqual({ itemIdx: 5, monthIdx: 11 });
  });
});

describe("computeCursorTarget — page", () => {
  it("page-up jumps pageSize rows, clamped at 0", () => {
    expect(move({ itemIdx: 9, monthIdx: 3 }, "page-up")).toEqual({ itemIdx: 0, monthIdx: 3 });
    expect(move({ itemIdx: 5, monthIdx: 3 }, "page-up")).toEqual({ itemIdx: 0, monthIdx: 3 });
  });

  it("page-down jumps pageSize rows, clamped at last", () => {
    expect(move({ itemIdx: 0, monthIdx: 3 }, "page-down")).toEqual({ itemIdx: 9, monthIdx: 3 });
    expect(move({ itemIdx: 5, monthIdx: 3 }, "page-down")).toEqual({ itemIdx: 9, monthIdx: 3 });
  });
});

describe("computeCursorTarget — row edges", () => {
  it("row-start jumps to month 0", () => {
    expect(move({ itemIdx: 5, monthIdx: 7 }, "row-start")).toEqual({ itemIdx: 5, monthIdx: 0 });
  });

  it("row-end jumps to the last month", () => {
    expect(move({ itemIdx: 5, monthIdx: 3 }, "row-end")).toEqual({ itemIdx: 5, monthIdx: 11 });
  });

  it("row-start from label column lands at month 0", () => {
    expect(move({ itemIdx: 5, monthIdx: -1 }, "row-start")).toEqual({ itemIdx: 5, monthIdx: 0 });
  });
});

describe("computeCursorTarget — grid corners", () => {
  it("grid-start lands on item 0, month 0", () => {
    expect(move({ itemIdx: 7, monthIdx: 5 }, "grid-start")).toEqual({ itemIdx: 0, monthIdx: 0 });
  });

  it("grid-end lands on the last item and last month", () => {
    expect(move({ itemIdx: 0, monthIdx: 0 }, "grid-end")).toEqual({ itemIdx: 9, monthIdx: 11 });
  });
});

describe("computeCursorTarget — section", () => {
  it("section-up from inside a section lands on its group header", () => {
    // From cat B2 (idx 6), section-up → group B (idx 4).
    expect(move({ itemIdx: 6, monthIdx: 3 }, "section-up")).toEqual({ itemIdx: 4, monthIdx: 3 });
  });

  it("section-up from a group header lands on the previous group header", () => {
    // From group B (idx 4), section-up → group A (idx 0).
    expect(move({ itemIdx: 4, monthIdx: 3 }, "section-up")).toEqual({ itemIdx: 0, monthIdx: 3 });
  });

  it("section-up from the first group lands at item 0 (no movement)", () => {
    expect(move({ itemIdx: 0, monthIdx: 3 }, "section-up")).toEqual({ itemIdx: 0, monthIdx: 3 });
  });

  it("section-down from a category lands on the next group header", () => {
    // From cat A2 (idx 2), section-down → group B (idx 4).
    expect(move({ itemIdx: 2, monthIdx: 3 }, "section-down")).toEqual({ itemIdx: 4, monthIdx: 3 });
  });

  it("section-down from a group header lands on the next group", () => {
    // From group A (idx 0), section-down → group B (idx 4).
    expect(move({ itemIdx: 0, monthIdx: 3 }, "section-down")).toEqual({ itemIdx: 4, monthIdx: 3 });
  });

  it("section-down past the last group lands on the last item", () => {
    // From cat C1 (idx 9), section-down → idx 9 (no further group).
    expect(move({ itemIdx: 9, monthIdx: 3 }, "section-down")).toEqual({ itemIdx: 9, monthIdx: 3 });
  });
});

describe("computeCursorTarget — tab wraparound", () => {
  it("tab from a non-last column moves right", () => {
    expect(move({ itemIdx: 5, monthIdx: 3 }, "tab")).toEqual({ itemIdx: 5, monthIdx: 4 });
  });

  it("tab from the last column wraps to next row's label column", () => {
    expect(move({ itemIdx: 5, monthIdx: 11 }, "tab")).toEqual({ itemIdx: 6, monthIdx: -1 });
  });

  it("shift-tab from non-label moves left", () => {
    expect(move({ itemIdx: 5, monthIdx: 3 }, "shift-tab")).toEqual({ itemIdx: 5, monthIdx: 2 });
  });

  it("shift-tab from label column wraps to previous row's last cell", () => {
    expect(move({ itemIdx: 5, monthIdx: -1 }, "shift-tab")).toEqual({ itemIdx: 4, monthIdx: 11 });
  });
});

describe("computeCursorTarget — unhandled directions", () => {
  it("returns null for shift-* directions (handled by extension fn)", () => {
    expect(move({ itemIdx: 5, monthIdx: 3 }, "shift-up")).toBeNull();
    expect(move({ itemIdx: 5, monthIdx: 3 }, "shift-page-down")).toBeNull();
  });
});

describe("computeCursorTarget — skipped months", () => {
  const leadingSkipped = new Set([0, 1, 2]);

  it("left jumps over skipped leading months to the label column", () => {
    expect(moveSkipping({ itemIdx: 5, monthIdx: 3 }, "left", leadingSkipped)).toEqual({
      itemIdx: 5,
      monthIdx: -1,
    });
  });

  it("right from the label column lands on the first non-skipped month", () => {
    expect(moveSkipping({ itemIdx: 5, monthIdx: -1 }, "right", leadingSkipped)).toEqual({
      itemIdx: 5,
      monthIdx: 3,
    });
  });

  it("row-start and grid-start use the first non-skipped month", () => {
    expect(moveSkipping({ itemIdx: 5, monthIdx: 8 }, "row-start", leadingSkipped)).toEqual({
      itemIdx: 5,
      monthIdx: 3,
    });
    expect(moveSkipping({ itemIdx: 5, monthIdx: 8 }, "grid-start", leadingSkipped)).toEqual({
      itemIdx: 0,
      monthIdx: 3,
    });
  });

  it("shift-tab wraps to the previous row's last non-skipped month", () => {
    expect(
      moveSkipping({ itemIdx: 5, monthIdx: -1 }, "shift-tab", new Set([10, 11]))
    ).toEqual({
      itemIdx: 4,
      monthIdx: 9,
    });
  });
});

// ─── Range extension ──────────────────────────────────────────────────────

describe("computeRangeExtensionTarget — single step", () => {
  it("shift-up moves focus one cat up", () => {
    expect(extend({ itemIdx: 3, monthIdx: 5 }, "shift-up")).toEqual({ itemIdx: 2, monthIdx: 5 });
  });

  it("shift-down clamps at last cat", () => {
    expect(extend({ itemIdx: 6, monthIdx: 5 }, "shift-down")).toEqual({ itemIdx: 6, monthIdx: 5 });
  });

  it("shift-left clamps at month 0 (label column not reachable for extension)", () => {
    expect(extend({ itemIdx: 3, monthIdx: 0 }, "shift-left")).toEqual({ itemIdx: 3, monthIdx: 0 });
    expect(extend({ itemIdx: 3, monthIdx: 5 }, "shift-left")).toEqual({ itemIdx: 3, monthIdx: 4 });
  });

  it("shift-right clamps at last month", () => {
    expect(extend({ itemIdx: 3, monthIdx: 11 }, "shift-right")).toEqual({ itemIdx: 3, monthIdx: 11 });
  });
});

describe("computeRangeExtensionTarget — page / row / grid", () => {
  it("shift-page-up clamps at 0", () => {
    expect(extend({ itemIdx: 6, monthIdx: 5 }, "shift-page-up")).toEqual({ itemIdx: 0, monthIdx: 5 });
  });

  it("shift-page-down clamps at last cat", () => {
    expect(extend({ itemIdx: 0, monthIdx: 5 }, "shift-page-down")).toEqual({ itemIdx: 6, monthIdx: 5 });
  });

  it("shift-row-start jumps to month 0", () => {
    expect(extend({ itemIdx: 3, monthIdx: 7 }, "shift-row-start")).toEqual({ itemIdx: 3, monthIdx: 0 });
  });

  it("shift-row-end jumps to last month", () => {
    expect(extend({ itemIdx: 3, monthIdx: 5 }, "shift-row-end")).toEqual({ itemIdx: 3, monthIdx: 11 });
  });

  it("shift-grid-start jumps to top-left", () => {
    expect(extend({ itemIdx: 6, monthIdx: 11 }, "shift-grid-start")).toEqual({ itemIdx: 0, monthIdx: 0 });
  });

  it("shift-grid-end jumps to bottom-right", () => {
    expect(extend({ itemIdx: 0, monthIdx: 0 }, "shift-grid-end")).toEqual({ itemIdx: 6, monthIdx: 11 });
  });
});

describe("computeRangeExtensionTarget — unhandled directions", () => {
  it("returns null for non-shift directions", () => {
    expect(extend({ itemIdx: 3, monthIdx: 5 }, "up")).toBeNull();
    expect(extend({ itemIdx: 3, monthIdx: 5 }, "page-down")).toBeNull();
    expect(extend({ itemIdx: 3, monthIdx: 5 }, "tab")).toBeNull();
  });
});

describe("computeRangeExtensionTarget — skipped months", () => {
  const leadingSkipped = new Set([0, 1, 2]);

  it("shift-left does not extend into skipped leading months", () => {
    expect(extendSkipping({ itemIdx: 3, monthIdx: 3 }, "shift-left", leadingSkipped)).toEqual({
      itemIdx: 3,
      monthIdx: 3,
    });
  });

  it("shift-row-start uses the first non-skipped month", () => {
    expect(extendSkipping({ itemIdx: 3, monthIdx: 8 }, "shift-row-start", leadingSkipped)).toEqual({
      itemIdx: 3,
      monthIdx: 3,
    });
  });
});
