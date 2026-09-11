import {
  resolveSelectionCells,
  resolveGroupCells,
  resolveMonthCells,
  parsePastePayload,
} from "./budgetSelectionUtils";
import type { BudgetCellSelection, LoadedCategory } from "../types";

function cat(id: string, groupId = "g"): LoadedCategory {
  return {
    id,
    name: id,
    groupId,
    groupName: "G",
    isIncome: false,
    hidden: false,
    budgeted: 0,
    actuals: 0,
    balance: 0,
    carryover: false,
  };
}

const months = ["2026-01", "2026-02", "2026-03", "2026-04"];
const categories = [cat("c1"), cat("c2"), cat("c3")];

function sel(
  anchorMonth: string,
  anchorCat: string,
  focusMonth: string,
  focusCat: string
): BudgetCellSelection {
  return {
    anchorMonth,
    anchorCategoryId: anchorCat,
    focusMonth,
    focusCategoryId: focusCat,
  };
}

describe("resolveSelectionCells", () => {
  it("returns a single cell when anchor and focus are identical", () => {
    const cells = resolveSelectionCells(
      sel("2026-02", "c2", "2026-02", "c2"),
      months,
      categories
    );
    expect(cells).toEqual([{ month: "2026-02", categoryId: "c2" }]);
  });

  it("returns the rectangle for a forward selection (anchor top-left, focus bottom-right)", () => {
    const cells = resolveSelectionCells(
      sel("2026-01", "c1", "2026-02", "c2"),
      months,
      categories
    );
    expect(cells).toEqual([
      { month: "2026-01", categoryId: "c1" },
      { month: "2026-01", categoryId: "c2" },
      { month: "2026-02", categoryId: "c1" },
      { month: "2026-02", categoryId: "c2" },
    ]);
  });

  it("returns the same rectangle when anchor/focus are inverted on the month axis", () => {
    const forward = resolveSelectionCells(
      sel("2026-01", "c1", "2026-03", "c2"),
      months,
      categories
    );
    const inverted = resolveSelectionCells(
      sel("2026-03", "c1", "2026-01", "c2"),
      months,
      categories
    );
    expect(inverted).toEqual(forward);
  });

  it("returns the same rectangle when anchor/focus are inverted on the category axis", () => {
    const forward = resolveSelectionCells(
      sel("2026-01", "c1", "2026-02", "c3"),
      months,
      categories
    );
    const inverted = resolveSelectionCells(
      sel("2026-01", "c3", "2026-02", "c1"),
      months,
      categories
    );
    expect(inverted).toEqual(forward);
  });

  it("returns an empty list when the anchor month is missing", () => {
    expect(
      resolveSelectionCells(sel("2099-12", "c1", "2026-01", "c1"), months, categories)
    ).toEqual([]);
  });

  it("returns an empty list when the focus category is missing", () => {
    expect(
      resolveSelectionCells(sel("2026-01", "c1", "2026-01", "missing"), months, categories)
    ).toEqual([]);
  });
});

describe("parsePastePayload", () => {
  it("parses a single cell", () => {
    expect(parsePastePayload("100")).toEqual([["100"]]);
  });

  it("parses a single row of tab-separated cells", () => {
    expect(parsePastePayload("1\t2\t3")).toEqual([["1", "2", "3"]]);
  });

  it("parses a single column of newline-separated cells", () => {
    expect(parsePastePayload("1\n2\n3")).toEqual([["1"], ["2"], ["3"]]);
  });

  it("parses a 2x2 grid", () => {
    expect(parsePastePayload("1\t2\n3\t4")).toEqual([
      ["1", "2"],
      ["3", "4"],
    ]);
  });

  it("handles CRLF line endings (Windows clipboard)", () => {
    expect(parsePastePayload("1\t2\r\n3\t4")).toEqual([
      ["1", "2"],
      ["3", "4"],
    ]);
  });

  it("drops a trailing empty row produced by a trailing newline", () => {
    expect(parsePastePayload("1\t2\n3\t4\n")).toEqual([
      ["1", "2"],
      ["3", "4"],
    ]);
  });

  it("preserves empty cells inside a row", () => {
    expect(parsePastePayload("1\t\t3")).toEqual([["1", "", "3"]]);
  });
});

// ─── Group and column targets ─────────────────────────────────────────────────

/**
 * A group row is a summarization layer over its categories, so acting on one is
 * defined as acting on all of them - including when the group is collapsed,
 * which is the case that makes it worth having.
 */
describe("resolveGroupCells", () => {
  const mixed = [
    cat("a1", "groceries"),
    cat("a2", "groceries"),
    cat("b1", "bills"),
  ];

  it("covers every category in the group, for each month", () => {
    expect(resolveGroupCells("groceries", ["2026-01", "2026-02"], mixed)).toEqual([
      { month: "2026-01", categoryId: "a1" },
      { month: "2026-01", categoryId: "a2" },
      { month: "2026-02", categoryId: "a1" },
      { month: "2026-02", categoryId: "a2" },
    ]);
  });

  it("never reaches into another group", () => {
    const cells = resolveGroupCells("bills", ["2026-01"], mixed);
    expect(cells).toEqual([{ month: "2026-01", categoryId: "b1" }]);
  });

  it("is empty for a group with no visible categories", () => {
    // `categories` is already filtered by showHidden, so a group whose rows are
    // all hidden resolves to nothing rather than to hidden cells.
    expect(resolveGroupCells("missing", ["2026-01"], mixed)).toEqual([]);
  });
});

describe("resolveMonthCells", () => {
  it("covers every visible category in that month, across groups", () => {
    const mixed = [cat("a1", "groceries"), cat("b1", "bills")];
    expect(resolveMonthCells("2026-03", mixed)).toEqual([
      { month: "2026-03", categoryId: "a1" },
      { month: "2026-03", categoryId: "b1" },
    ]);
  });

  it("is empty when nothing is visible", () => {
    expect(resolveMonthCells("2026-03", [])).toEqual([]);
  });
});

