import { renderHook, act } from "@testing-library/react";
import { useBulkAction } from "./useBulkAction";
import { useBudgetEditsStore } from "@/store/budgetEdits";
import type { BudgetCellSelection, LoadedCategory } from "../types";

// ─── Fixtures ──────────────────────────────────────────────────────────────────

function cat(overrides: Partial<LoadedCategory> = {}): LoadedCategory {
  return {
    id: overrides.id ?? "c1",
    name: overrides.name ?? "Cat",
    groupId: overrides.groupId ?? "g1",
    groupName: overrides.groupName ?? "G",
    isIncome: overrides.isIncome ?? false,
    hidden: overrides.hidden ?? false,
    budgeted: overrides.budgeted ?? 0,
    actuals: overrides.actuals ?? 0,
    balance: overrides.balance ?? 0,
    carryover: overrides.carryover ?? false,
  };
}

const months = ["2026-01", "2026-02", "2026-03"];
const categories = [
  cat({ id: "c1", name: "Groceries", budgeted: 10000 }),
  cat({ id: "c2", name: "Rent", budgeted: 200000 }),
];

// Reset the budget edits store between tests so apply() side effects don't leak.
beforeEach(() => {
  useBudgetEditsStore.setState({
    edits: {},
    undoStack: [],
    redoStack: [],
    uiSelection: { month: null, categoryId: null, groupId: null },
    displayMonths: [],
  });
});

function fullSelection(): BudgetCellSelection {
  return {
    anchorMonth: months[0]!,
    anchorCategoryId: "c1",
    focusMonth: months[months.length - 1]!,
    focusCategoryId: "c2",
  };
}

function singleCell(month: string, categoryId: string): BudgetCellSelection {
  return {
    anchorMonth: month,
    anchorCategoryId: categoryId,
    focusMonth: month,
    focusCategoryId: categoryId,
  };
}

function monthDataMap(
  values: Record<string, Record<string, number>>
): Record<string, LoadedCategory[]> {
  const out: Record<string, LoadedCategory[]> = {};
  for (const [month, byCat] of Object.entries(values)) {
    out[month] = Object.entries(byCat).map(([id, budgeted]) =>
      cat({ id, budgeted })
    );
  }
  return out;
}

// ─── preview ──────────────────────────────────────────────────────────────────

describe("useBulkAction.preview", () => {
  it("returns null for an empty selection", () => {
    const { result } = renderHook(() => useBulkAction());
    const empty: BudgetCellSelection = {
      anchorMonth: "missing",
      anchorCategoryId: "missing",
      focusMonth: "missing",
      focusCategoryId: "missing",
    };
    const rows = result.current.preview("set-to-zero", empty, months, categories, {});
    expect(rows).toBeNull();
  });

  describe("set-to-zero", () => {
    it("zeros every cell in the rectangle", () => {
      const { result } = renderHook(() => useBulkAction());
      const map = monthDataMap({
        "2026-01": { c1: 10000, c2: 200000 },
        "2026-02": { c1: 11000, c2: 200000 },
        "2026-03": { c1: 12000, c2: 200000 },
      });
      const rows = result.current.preview(
        "set-to-zero",
        fullSelection(),
        months,
        categories,
        map
      );
      expect(rows).toHaveLength(6);
      for (const row of rows!) expect(row.nextBudgeted).toBe(0);
    });
  });

  describe("set-fixed", () => {
    it("uses fixedAmount from params", () => {
      const { result } = renderHook(() => useBulkAction());
      const rows = result.current.preview(
        "set-fixed",
        singleCell("2026-01", "c1"),
        months,
        categories,
        monthDataMap({ "2026-01": { c1: 10000 } }),
        { fixedAmount: 50000 }
      );
      expect(rows).toEqual([
        {
          month: "2026-01",
          categoryId: "c1",
          categoryName: "Groceries",
          previousBudgeted: 10000,
          nextBudgeted: 50000,
        },
      ]);
    });

    it("returns null when fixedAmount is missing", () => {
      const { result } = renderHook(() => useBulkAction());
      const rows = result.current.preview(
        "set-fixed",
        singleCell("2026-01", "c1"),
        months,
        categories,
        monthDataMap({ "2026-01": { c1: 10000 } })
      );
      expect(rows).toBeNull();
    });
  });

  describe("apply-percentage", () => {
    it("multiplies each cell by the percentage and rounds to minor units", () => {
      const { result } = renderHook(() => useBulkAction());
      const rows = result.current.preview(
        "apply-percentage",
        singleCell("2026-01", "c1"),
        months,
        categories,
        monthDataMap({ "2026-01": { c1: 10000 } }),
        { percentage: 1.1 }
      );
      expect(rows?.[0]?.nextBudgeted).toBe(11000);
    });

    it("returns null when percentage is missing", () => {
      const { result } = renderHook(() => useBulkAction());
      const rows = result.current.preview(
        "apply-percentage",
        singleCell("2026-01", "c1"),
        months,
        categories,
        monthDataMap({ "2026-01": { c1: 10000 } })
      );
      expect(rows).toBeNull();
    });
  });

  describe("copy-previous-month", () => {
    it("copies the prior in-window month's budgeted value", () => {
      const { result } = renderHook(() => useBulkAction());
      const map = monthDataMap({
        "2026-01": { c1: 10000 },
        "2026-02": { c1: 99999 },
      });
      const rows = result.current.preview(
        "copy-previous-month",
        singleCell("2026-02", "c1"),
        months,
        categories,
        map
      );
      expect(rows?.[0]?.nextBudgeted).toBe(10000);
    });

    it("skips cells in the first month (no previous month in window)", () => {
      const { result } = renderHook(() => useBulkAction());
      const map = monthDataMap({ "2026-01": { c1: 10000 } });
      const rows = result.current.preview(
        "copy-previous-month",
        singleCell("2026-01", "c1"),
        months,
        categories,
        map
      );
      expect(rows).toBeNull();
    });
  });

  describe("copy-from-month", () => {
    it("copies from the named source month", () => {
      const { result } = renderHook(() => useBulkAction());
      const map = monthDataMap({
        "2026-01": { c1: 12345 },
        "2026-02": { c1: 99999 },
      });
      const rows = result.current.preview(
        "copy-from-month",
        singleCell("2026-02", "c1"),
        months,
        categories,
        map,
        { sourceMonth: "2026-01" }
      );
      expect(rows?.[0]?.nextBudgeted).toBe(12345);
    });

    it("returns null when sourceMonth is missing from monthDataMap", () => {
      const { result } = renderHook(() => useBulkAction());
      const rows = result.current.preview(
        "copy-from-month",
        singleCell("2026-02", "c1"),
        months,
        categories,
        monthDataMap({}),
        { sourceMonth: "2099-12" }
      );
      expect(rows).toBeNull();
    });
  });

  describe("avg-N-months", () => {
    it("averages the prior 3 months when avg-3-months is requested", () => {
      const { result } = renderHook(() => useBulkAction());
      // For target month 2026-04, look back at 2026-01 (1000), -02 (2000), -03 (3000)
      const lookbackMonths = ["2026-01", "2026-02", "2026-03", "2026-04"];
      const map = monthDataMap({
        "2026-01": { c1: 1000 },
        "2026-02": { c1: 2000 },
        "2026-03": { c1: 3000 },
        "2026-04": { c1: 9999 },
      });
      const rows = result.current.preview(
        "avg-3-months",
        singleCell("2026-04", "c1"),
        lookbackMonths,
        categories,
        map
      );
      expect(rows?.[0]?.nextBudgeted).toBe(2000);
    });

    it("averages over only the months with data when some are missing", () => {
      const { result } = renderHook(() => useBulkAction());
      const map = monthDataMap({
        // 2026-01 + 2026-02 missing entirely
        "2026-03": { c1: 6000 },
        "2026-04": { c1: 9999 },
      });
      const rows = result.current.preview(
        "avg-3-months",
        singleCell("2026-04", "c1"),
        ["2026-04"],
        categories,
        map
      );
      // Only 2026-03 had data → average is 6000.
      expect(rows?.[0]?.nextBudgeted).toBe(6000);
    });

    it("skips cells when no prior months have data", () => {
      const { result } = renderHook(() => useBulkAction());
      const rows = result.current.preview(
        "avg-3-months",
        singleCell("2026-04", "c1"),
        ["2026-04"],
        categories,
        monthDataMap({ "2026-04": { c1: 9999 } })
      );
      expect(rows).toBeNull();
    });
  });
});

// ─── apply ────────────────────────────────────────────────────────────────────

describe("useBulkAction.apply", () => {
  it("stages every preview row as a single bulk edit (one undo step)", () => {
    const { result } = renderHook(() => useBulkAction());
    const map = monthDataMap({
      "2026-01": { c1: 10000 },
      "2026-02": { c1: 20000 },
    });
    const rows = result.current.preview(
      "set-to-zero",
      {
        anchorMonth: "2026-01",
        anchorCategoryId: "c1",
        focusMonth: "2026-02",
        focusCategoryId: "c1",
      },
      ["2026-01", "2026-02"],
      categories,
      map
    );

    act(() => {
      result.current.apply(rows!);
    });

    const edits = useBudgetEditsStore.getState().edits;
    expect(Object.keys(edits).sort()).toEqual(["2026-01:c1", "2026-02:c1"]);
    expect(edits["2026-01:c1"]?.source).toBe("bulk-action");
    expect(edits["2026-01:c1"]?.nextBudgeted).toBe(0);
    expect(edits["2026-02:c1"]?.nextBudgeted).toBe(0);

    // Single undo step — undoStack length 1 after one bulk apply.
    expect(useBudgetEditsStore.getState().undoStack).toHaveLength(1);
  });
});
