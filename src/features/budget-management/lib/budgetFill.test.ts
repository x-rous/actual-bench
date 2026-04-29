import {
  buildFillFromActiveEdits,
  buildFillDownEdits,
  buildFillRightEdits,
  type FillSourceLookup,
} from "./budgetFill";
import type { BudgetCellSelection, LoadedCategory } from "../types";

const MONTHS = ["2026-01", "2026-02", "2026-03", "2026-04"];
const CATEGORIES: LoadedCategory[] = [
  { id: "c1", name: "Cat 1", groupId: "g1", groupName: "Group", isIncome: false, hidden: false, budgeted: 100, actuals: 0, balance: 0, carryover: false },
  { id: "c2", name: "Cat 2", groupId: "g1", groupName: "Group", isIncome: false, hidden: false, budgeted: 200, actuals: 0, balance: 0, carryover: false },
  { id: "c3", name: "Cat 3", groupId: "g1", groupName: "Group", isIncome: false, hidden: false, budgeted: 300, actuals: 0, balance: 0, carryover: false },
];

// Lookup that returns category-static values: server = c1=100, c2=200, c3=300.
// Override per-cell via the `overrides` map.
function makeLookup(overrides: Record<string, { current: number; server: number }> = {}): FillSourceLookup {
  return (month, catId) => {
    const key = `${month}:${catId}`;
    if (key in overrides) return overrides[key]!;
    const cat = CATEGORIES.find((c) => c.id === catId);
    if (!cat) return null;
    return { current: cat.budgeted, server: cat.budgeted };
  };
}

describe("buildFillFromActiveEdits", () => {
  it("fills every cell in the rectangle with the anchor's current value", () => {
    const selection: BudgetCellSelection = {
      anchorMonth: "2026-01",
      anchorCategoryId: "c1",
      focusMonth: "2026-02",
      focusCategoryId: "c3",
    };
    // anchor c1@2026-01 is staged to 999.
    const lookup = makeLookup({ "2026-01:c1": { current: 999, server: 100 } });
    const edits = buildFillFromActiveEdits(selection, MONTHS, CATEGORIES, lookup);
    expect(edits).not.toBeNull();
    // 2 months × 3 cats = 6 cells, anchor included (since current ≠ server).
    expect(edits!).toHaveLength(6);
    for (const e of edits!) {
      expect(e.nextBudgeted).toBe(999);
    }
  });

  it("skips the anchor when its current already equals server (no-op)", () => {
    const selection: BudgetCellSelection = {
      anchorMonth: "2026-01",
      anchorCategoryId: "c1",
      focusMonth: "2026-02",
      focusCategoryId: "c2",
    };
    // anchor's current==server; no need to re-stage it.
    const edits = buildFillFromActiveEdits(selection, MONTHS, CATEGORIES, makeLookup());
    // Should have 4 cells (2x2), minus anchor itself = 3.
    expect(edits).toHaveLength(3);
    expect(edits!.find((e) => e.month === "2026-01" && e.categoryId === "c1")).toBeUndefined();
  });

  it("returns null on an invalid selection", () => {
    const bad: BudgetCellSelection = {
      anchorMonth: "ZZZ",
      anchorCategoryId: "c1",
      focusMonth: "2026-02",
      focusCategoryId: "c2",
    };
    expect(buildFillFromActiveEdits(bad, MONTHS, CATEGORIES, makeLookup())).toBeNull();
  });
});

describe("buildFillDownEdits", () => {
  it("copies top-row values down each column", () => {
    const selection: BudgetCellSelection = {
      anchorMonth: "2026-01",
      anchorCategoryId: "c1",
      focusMonth: "2026-02",
      focusCategoryId: "c3",
    };
    // top row staged: c1@Jan=999, c1@Feb=888.
    const lookup = makeLookup({
      "2026-01:c1": { current: 999, server: 100 },
      "2026-02:c1": { current: 888, server: 100 },
    });
    const edits = buildFillDownEdits(selection, MONTHS, CATEGORIES, lookup);
    expect(edits).not.toBeNull();
    // 2 months × 2 rows below top = 4 edits.
    expect(edits).toHaveLength(4);
    // Jan column: c2 and c3 should be 999.
    expect(edits!.find((e) => e.month === "2026-01" && e.categoryId === "c2")?.nextBudgeted).toBe(999);
    expect(edits!.find((e) => e.month === "2026-01" && e.categoryId === "c3")?.nextBudgeted).toBe(999);
    // Feb column: c2 and c3 should be 888.
    expect(edits!.find((e) => e.month === "2026-02" && e.categoryId === "c2")?.nextBudgeted).toBe(888);
    expect(edits!.find((e) => e.month === "2026-02" && e.categoryId === "c3")?.nextBudgeted).toBe(888);
    // previousBudgeted is the server value, not the source's value.
    expect(edits!.find((e) => e.month === "2026-01" && e.categoryId === "c2")?.previousBudgeted).toBe(200);
    expect(edits!.find((e) => e.month === "2026-01" && e.categoryId === "c3")?.previousBudgeted).toBe(300);
  });

  it("returns null when selection is single-row (nothing below)", () => {
    const selection: BudgetCellSelection = {
      anchorMonth: "2026-01",
      anchorCategoryId: "c2",
      focusMonth: "2026-03",
      focusCategoryId: "c2",
    };
    expect(buildFillDownEdits(selection, MONTHS, CATEGORIES, makeLookup())).toBeNull();
  });

  it("works regardless of anchor/focus orientation (anchor below focus)", () => {
    const selection: BudgetCellSelection = {
      anchorMonth: "2026-01",
      anchorCategoryId: "c3",  // anchor at bottom
      focusMonth: "2026-01",
      focusCategoryId: "c1",   // focus at top
    };
    const lookup = makeLookup({ "2026-01:c1": { current: 50, server: 100 } });
    const edits = buildFillDownEdits(selection, MONTHS, CATEGORIES, lookup);
    expect(edits).toHaveLength(2);
    // Top is c1 regardless of which way the user dragged.
    expect(edits!.every((e) => e.nextBudgeted === 50)).toBe(true);
  });
});

describe("buildFillRightEdits", () => {
  it("copies left-column values right across each row", () => {
    const selection: BudgetCellSelection = {
      anchorMonth: "2026-01",
      anchorCategoryId: "c1",
      focusMonth: "2026-03",
      focusCategoryId: "c2",
    };
    const lookup = makeLookup({
      "2026-01:c1": { current: 999, server: 100 },
      "2026-01:c2": { current: 555, server: 200 },
    });
    const edits = buildFillRightEdits(selection, MONTHS, CATEGORIES, lookup);
    expect(edits).not.toBeNull();
    // 2 rows × 2 cols right of leftmost = 4 edits.
    expect(edits).toHaveLength(4);
    // c1 row: Feb and Mar should be 999.
    expect(edits!.find((e) => e.month === "2026-02" && e.categoryId === "c1")?.nextBudgeted).toBe(999);
    expect(edits!.find((e) => e.month === "2026-03" && e.categoryId === "c1")?.nextBudgeted).toBe(999);
    // c2 row: Feb and Mar should be 555.
    expect(edits!.find((e) => e.month === "2026-02" && e.categoryId === "c2")?.nextBudgeted).toBe(555);
    expect(edits!.find((e) => e.month === "2026-03" && e.categoryId === "c2")?.nextBudgeted).toBe(555);
  });

  it("returns null when selection is single-column", () => {
    const selection: BudgetCellSelection = {
      anchorMonth: "2026-02",
      anchorCategoryId: "c1",
      focusMonth: "2026-02",
      focusCategoryId: "c3",
    };
    expect(buildFillRightEdits(selection, MONTHS, CATEGORIES, makeLookup())).toBeNull();
  });
});
