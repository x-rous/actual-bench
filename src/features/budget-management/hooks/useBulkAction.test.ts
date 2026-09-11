import { renderHook, act } from "@testing-library/react";
import { useBulkAction, requiredSourceMonths } from "./useBulkAction";
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
  it("returns an empty result for an empty selection", () => {
    const { result } = renderHook(() => useBulkAction());
    const empty: BudgetCellSelection = {
      anchorMonth: "missing",
      anchorCategoryId: "missing",
      focusMonth: "missing",
      focusCategoryId: "missing",
    };
    const res = result.current.preview("set-to-zero", empty, months, categories, {});
    expect(res?.rows).toEqual([]);
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
      expect(rows?.rows).toHaveLength(6);
      for (const row of rows!.rows) expect(row.nextBudgeted).toBe(0);
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
      expect(rows?.rows).toEqual([
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
      expect(rows?.rows[0]?.nextBudgeted).toBe(11000);
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
      expect(rows?.rows[0]?.nextBudgeted).toBe(10000);
    });

    it("resolves the month before the window for a first-column cell", () => {
      const { result } = renderHook(() => useBulkAction());
      // 2025-12 is outside the visible window but present in the map, which is
      // exactly what ensureMonthsData is for. Pre-PR-055 this returned nothing.
      const map = monthDataMap({
        "2025-12": { c1: 77000 },
        "2026-01": { c1: 10000 },
      });
      const rows = result.current.preview(
        "copy-previous-month",
        singleCell("2026-01", "c1"),
        months,
        categories,
        map
      );
      expect(rows?.rows[0]?.nextBudgeted).toBe(77000);
    });

    it("reports a skip when the previous month could not be loaded", () => {
      const { result } = renderHook(() => useBulkAction());
      const rows = result.current.preview(
        "copy-previous-month",
        singleCell("2026-01", "c1"),
        months,
        categories,
        monthDataMap({ "2026-01": { c1: 10000 } })
      );
      expect(rows?.rows).toEqual([]);
      expect(rows?.skipped["missing-source-month"]).toBe(1);
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
      expect(rows?.rows[0]?.nextBudgeted).toBe(12345);
    });

    it("reports a skip when sourceMonth is missing from monthDataMap", () => {
      const { result } = renderHook(() => useBulkAction());
      const rows = result.current.preview(
        "copy-from-month",
        singleCell("2026-02", "c1"),
        months,
        categories,
        monthDataMap({}),
        { sourceMonth: "2099-12" }
      );
      expect(rows?.rows).toEqual([]);
      expect(rows?.skipped["missing-source-month"]).toBe(1);
    });

    it("applies an optional percentage to the copied source value", () => {
      const { result } = renderHook(() => useBulkAction());
      const map = monthDataMap({
        "2026-01": { c1: 10000 },
        "2026-02": { c1: 99999 },
      });
      const rows = result.current.preview(
        "copy-from-month",
        singleCell("2026-02", "c1"),
        months,
        categories,
        map,
        { sourceMonth: "2026-01", percentage: 1.05 }
      );
      // 105% of the *source* (10000), not of the target's current 99999.
      expect(rows?.rows[0]?.nextBudgeted).toBe(10500);
    });
  });

  describe("copy-prior-year-same-month", () => {
    it("copies the value from twelve months earlier", () => {
      const { result } = renderHook(() => useBulkAction());
      const map = monthDataMap({
        "2025-02": { c1: 42000 },
        "2026-02": { c1: 999 },
      });
      const rows = result.current.preview(
        "copy-prior-year-same-month",
        singleCell("2026-02", "c1"),
        months,
        categories,
        map
      );
      expect(rows?.rows[0]?.nextBudgeted).toBe(42000);
    });

    it("maps a multi-month range positionally onto the prior year", () => {
      const { result } = renderHook(() => useBulkAction());
      // The guarantee that separates this from copy-from-month: each target
      // pulls its *own* counterpart, so Jan/Feb/Mar do not all get one month.
      const map = monthDataMap({
        "2025-01": { c1: 100 },
        "2025-02": { c1: 200 },
        "2025-03": { c1: 300 },
        "2026-01": { c1: 0 },
        "2026-02": { c1: 0 },
        "2026-03": { c1: 0 },
      });
      const rows = result.current.preview(
        "copy-prior-year-same-month",
        {
          anchorMonth: "2026-01",
          anchorCategoryId: "c1",
          focusMonth: "2026-03",
          focusCategoryId: "c1",
        },
        months,
        categories,
        map
      );
      expect(rows?.rows.map((r) => [r.month, r.nextBudgeted])).toEqual([
        ["2026-01", 100],
        ["2026-02", 200],
        ["2026-03", 300],
      ]);
    });

    it("multiplies the source value when a percentage is given", () => {
      const { result } = renderHook(() => useBulkAction());
      const map = monthDataMap({
        "2025-02": { c1: 42000 },
        "2026-02": { c1: 999 },
      });
      const rows = result.current.preview(
        "copy-prior-year-same-month-pct",
        singleCell("2026-02", "c1"),
        months,
        categories,
        map,
        { percentage: 1.05 }
      );
      expect(rows?.rows[0]?.nextBudgeted).toBe(44100);
    });

    it("behaves as an exact copy when no percentage is given", () => {
      const { result } = renderHook(() => useBulkAction());
      const map = monthDataMap({
        "2025-02": { c1: 42000 },
        "2026-02": { c1: 999 },
      });
      const rows = result.current.preview(
        "copy-prior-year-same-month-pct",
        singleCell("2026-02", "c1"),
        months,
        categories,
        map
      );
      expect(rows?.rows[0]?.nextBudgeted).toBe(42000);
    });

    it("distinguishes a missing source month from a missing category", () => {
      const { result } = renderHook(() => useBulkAction());
      // 2025-01 never loaded; 2025-02 loaded but has no c1 row.
      const map = monthDataMap({
        "2025-02": { c2: 1 },
        "2026-01": { c1: 0 },
        "2026-02": { c1: 0 },
      });
      const rows = result.current.preview(
        "copy-prior-year-same-month",
        {
          anchorMonth: "2026-01",
          anchorCategoryId: "c1",
          focusMonth: "2026-02",
          focusCategoryId: "c1",
        },
        months,
        categories,
        map
      );
      expect(rows?.rows).toEqual([]);
      expect(rows?.skipped).toEqual({
        "missing-source-month": 1,
        "missing-category": 1,
      });
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
      expect(rows?.rows[0]?.nextBudgeted).toBe(2000);
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
      expect(rows?.rows[0]?.nextBudgeted).toBe(6000);
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
      expect(rows?.rows).toEqual([]);
      expect(rows?.skipped["missing-source-month"]).toBe(1);
    });

    it("reports how many lookback months it actually resolved", () => {
      const { result } = renderHook(() => useBulkAction());
      const map = monthDataMap({
        // Only one of the three lookback months is present.
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
      // The average itself is legitimate; presenting it as a 3-month average
      // without saying it covered one month is what this guards against.
      expect(rows?.rows[0]?.nextBudgeted).toBe(6000);
      expect(rows?.averageWindow).toEqual({ requested: 3, resolved: 1 });
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
      result.current.apply(rows!.rows);
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

describe("avg-N-months-actuals", () => {
  /**
   * `actuals` is signed money flow: spending is negative, income received is
   * positive. A budget is stated the way `budgeted` is, so an expense average
   * has to come back as a magnitude.
   */
  function actualsMap(
    values: Record<string, Record<string, number>>,
    opts: { isIncome?: boolean } = {}
  ): Record<string, LoadedCategory[]> {
    const out: Record<string, LoadedCategory[]> = {};
    for (const [month, byCat] of Object.entries(values)) {
      out[month] = Object.entries(byCat).map(([id, actuals]) =>
        cat({ id, actuals, isIncome: opts.isIncome ?? false })
      );
    }
    return out;
  }

  it("budgets the average spend as a positive amount", () => {
    const { result } = renderHook(() => useBulkAction());
    const map = actualsMap({
      "2026-01": { c1: -1000 },
      "2026-02": { c1: -2000 },
      "2026-03": { c1: -3000 },
      "2026-04": { c1: 0 },
    });
    const rows = result.current.preview(
      "avg-3-months-actuals",
      singleCell("2026-04", "c1"),
      ["2026-04"],
      categories,
      map
    );
    // mean(-1000, -2000, -3000) = -2000 -> budget 2000
    expect(rows?.rows[0]?.nextBudgeted).toBe(2000);
  });

  it("never turns a refund-heavy average into a negative budget", () => {
    const { result } = renderHook(() => useBulkAction());
    const map = actualsMap({
      "2026-03": { c1: 4000 }, // net refund month
      "2026-04": { c1: 0 },
    });
    const rows = result.current.preview(
      "avg-3-months-actuals",
      singleCell("2026-04", "c1"),
      ["2026-04"],
      categories,
      map
    );
    expect(rows?.rows[0]?.nextBudgeted).toBe(0);
  });

  it("keeps income received positive", () => {
    const { result } = renderHook(() => useBulkAction());
    const incomeCats = [cat({ id: "i1", name: "Salary", isIncome: true })];
    const map = actualsMap(
      { "2026-03": { i1: 500000 }, "2026-04": { i1: 0 } },
      { isIncome: true }
    );
    const rows = result.current.preview(
      "avg-3-months-actuals",
      singleCell("2026-04", "i1"),
      ["2026-04"],
      incomeCats,
      map
    );
    expect(rows?.rows[0]?.nextBudgeted).toBe(500000);
  });

  it("reads actuals, not budgeted", () => {
    const { result } = renderHook(() => useBulkAction());
    const map: Record<string, LoadedCategory[]> = {
      "2026-03": [cat({ id: "c1", budgeted: 99999, actuals: -1500 })],
      "2026-04": [cat({ id: "c1", budgeted: 0, actuals: 0 })],
    };
    const rows = result.current.preview(
      "avg-3-months-actuals",
      singleCell("2026-04", "c1"),
      ["2026-04"],
      categories,
      map
    );
    expect(rows?.rows[0]?.nextBudgeted).toBe(1500);
  });

  it("blames the category, not the month, when the months loaded without it", () => {
    const { result } = renderHook(() => useBulkAction());
    // All three lookback months are present; none carries c1.
    const map: Record<string, LoadedCategory[]> = {
      "2026-01": [cat({ id: "other" })],
      "2026-02": [cat({ id: "other" })],
      "2026-03": [cat({ id: "other" })],
      "2026-04": [cat({ id: "c1" })],
    };
    const rows = result.current.preview(
      "avg-3-months-actuals",
      singleCell("2026-04", "c1"),
      ["2026-04"],
      categories,
      map
    );
    expect(rows?.skipped).toEqual({
      "missing-source-month": 0,
      "missing-category": 1,
    });
  });

  it("blames the month when none of the lookback months loaded", () => {
    const { result } = renderHook(() => useBulkAction());
    const rows = result.current.preview(
      "avg-3-months-actuals",
      singleCell("2026-04", "c1"),
      ["2026-04"],
      categories,
      { "2026-04": [cat({ id: "c1" })] }
    );
    expect(rows?.skipped).toEqual({
      "missing-source-month": 1,
      "missing-category": 0,
    });
  });

  it("asks for the same lookback months as the budgeted average", () => {
    expect(requiredSourceMonths("avg-3-months-actuals", ["2026-03"]).sort()).toEqual([
      "2025-12",
      "2026-01",
      "2026-02",
    ]);
  });
});

// ─── requiredSourceMonths ─────────────────────────────────────────────────────

describe("requiredSourceMonths", () => {
  it("asks for each cell's own prior-year counterpart", () => {
    expect(
      requiredSourceMonths("copy-prior-year-same-month", ["2026-01", "2026-02"]).sort()
    ).toEqual(["2025-01", "2025-02"]);
  });

  it("asks for the month before the window, not a window index", () => {
    expect(requiredSourceMonths("copy-previous-month", ["2026-01"])).toEqual([
      "2025-12",
    ]);
  });

  it("asks for the full lookback of an averaging action", () => {
    expect(requiredSourceMonths("avg-3-months", ["2026-03"]).sort()).toEqual([
      "2025-12",
      "2026-01",
      "2026-02",
    ]);
  });

  it("asks for nothing when the action reads no other month", () => {
    expect(requiredSourceMonths("set-to-zero", ["2026-01"])).toEqual([]);
  });
});
