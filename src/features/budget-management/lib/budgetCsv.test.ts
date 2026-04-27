import {
  exportToCsv,
  exportBlankTemplate,
  parseCsv,
  matchImportRows,
  buildImportPreview,
} from "./budgetCsv";
import type {
  BudgetCellKey,
  LoadedCategory,
  LoadedGroup,
  LoadedMonthState,
  StagedBudgetEdit,
} from "../types";

// ─── Fixtures ──────────────────────────────────────────────────────────────────

function cat(overrides: Partial<LoadedCategory> = {}): LoadedCategory {
  return {
    id: overrides.id ?? "c1",
    name: overrides.name ?? "Groceries",
    groupId: overrides.groupId ?? "g1",
    groupName: overrides.groupName ?? "Food",
    isIncome: overrides.isIncome ?? false,
    hidden: overrides.hidden ?? false,
    budgeted: overrides.budgeted ?? 0,
    actuals: overrides.actuals ?? 0,
    balance: overrides.balance ?? 0,
    carryover: overrides.carryover ?? false,
  };
}

function group(overrides: Partial<LoadedGroup>): LoadedGroup {
  return {
    id: overrides.id ?? "g1",
    name: overrides.name ?? "Food",
    isIncome: overrides.isIncome ?? false,
    hidden: overrides.hidden ?? false,
    categoryIds: overrides.categoryIds ?? ["c1"],
    budgeted: overrides.budgeted ?? 0,
    actuals: overrides.actuals ?? 0,
    balance: overrides.balance ?? 0,
  };
}

function monthState(catsById: Record<string, LoadedCategory>): LoadedMonthState {
  return {
    summary: {
      month: "2026-01",
      incomeAvailable: 0,
      lastMonthOverspent: 0,
      forNextMonth: 0,
      totalBudgeted: 0,
      toBudget: 0,
      fromLastMonth: 0,
      totalIncome: 0,
      totalSpent: 0,
      totalBalance: 0,
    },
    groupsById: {},
    categoriesById: catsById,
    groupOrder: [],
  };
}

// ─── exportToCsv ───────────────────────────────────────────────────────────────

describe("exportToCsv", () => {
  const groups = [group({ id: "g1", name: "Food", categoryIds: ["c1"] })];
  const months = ["2026-01", "2026-02"];
  const monthDataMap: Record<string, LoadedMonthState> = {
    "2026-01": monthState({ c1: cat({ id: "c1", budgeted: 15000 }) }),
    "2026-02": monthState({ c1: cat({ id: "c1", budgeted: 16000 }) }),
  };

  it("emits a header row followed by one row per category", () => {
    const csv = exportToCsv(months, groups, monthDataMap, {
      months,
      includeHidden: false,
      includeIncome: false,
    });
    const lines = csv.split("\n");
    expect(lines[0]).toBe("Group Name,Category Name,2026-01,2026-02");
    expect(lines[1]).toBe("Food,Groceries,150.00,160.00");
  });

  it("uses month-specific budgeted values from monthDataMap", () => {
    const csv = exportToCsv(months, groups, monthDataMap, {
      months,
      includeHidden: false,
      includeIncome: false,
    });
    const dataRow = csv.split("\n")[1]!;
    expect(dataRow).toMatch(/150\.00,160\.00$/);
  });

  it("emits 0.00 for months missing from monthDataMap", () => {
    const csv = exportToCsv(["2026-01", "2099-12"], groups, monthDataMap, {
      months: ["2026-01", "2099-12"],
      includeHidden: false,
      includeIncome: false,
    });
    expect(csv.split("\n")[1]).toBe("Food,Groceries,150.00,0.00");
  });

  it("excludes hidden categories when includeHidden is false", () => {
    const map: Record<string, LoadedMonthState> = {
      "2026-01": monthState({
        c1: cat({ id: "c1", budgeted: 15000 }),
        c2: cat({ id: "c2", name: "Secret", hidden: true, budgeted: 9999 }),
      }),
    };
    const groupsWithHidden = [
      group({ id: "g1", name: "Food", categoryIds: ["c1", "c2"] }),
    ];
    const csv = exportToCsv(["2026-01"], groupsWithHidden, map, {
      months: ["2026-01"],
      includeHidden: false,
      includeIncome: false,
    });
    expect(csv).not.toMatch(/Secret/);
  });

  it("includes hidden categories when includeHidden is true", () => {
    const map: Record<string, LoadedMonthState> = {
      "2026-01": monthState({
        c1: cat({ id: "c1", budgeted: 15000 }),
        c2: cat({ id: "c2", name: "Secret", hidden: true, budgeted: 9999 }),
      }),
    };
    const groupsWithHidden = [
      group({ id: "g1", name: "Food", categoryIds: ["c1", "c2"] }),
    ];
    const csv = exportToCsv(["2026-01"], groupsWithHidden, map, {
      months: ["2026-01"],
      includeHidden: true,
      includeIncome: false,
    });
    expect(csv).toMatch(/Secret/);
  });

  it("excludes income groups when includeIncome is false", () => {
    const map: Record<string, LoadedMonthState> = {
      "2026-01": monthState({ inc1: cat({ id: "inc1", isIncome: true }) }),
    };
    const groupsMix = [
      group({ id: "gi", name: "Income", isIncome: true, categoryIds: ["inc1"] }),
    ];
    const csv = exportToCsv(["2026-01"], groupsMix, map, {
      months: ["2026-01"],
      includeHidden: false,
      includeIncome: false,
    });
    expect(csv).not.toMatch(/Income/);
  });

  it("uses staged values when stagedEdits is provided", () => {
    const stagedEdits: Record<BudgetCellKey, StagedBudgetEdit> = {
      "2026-01:c1": {
        month: "2026-01",
        categoryId: "c1",
        nextBudgeted: 99999,
        previousBudgeted: 15000,
        source: "manual",
      },
    };
    const csv = exportToCsv(
      months,
      groups,
      monthDataMap,
      { months, includeHidden: false, includeIncome: false },
      stagedEdits
    );
    const dataRow = csv.split("\n")[1]!;
    expect(dataRow).toMatch(/999\.99,160\.00$/);
  });

  it("escapes commas and quotes in names by wrapping in quotes", () => {
    const trickyGroups = [
      group({ id: "g1", name: 'Food, "weird"', categoryIds: ["c1"] }),
    ];
    const map: Record<string, LoadedMonthState> = {
      "2026-01": monthState({ c1: cat({ id: "c1", name: "A,B" }) }),
    };
    const csv = exportToCsv(["2026-01"], trickyGroups, map, {
      months: ["2026-01"],
      includeHidden: false,
      includeIncome: false,
    });
    // Group name has a comma + quotes, category has a comma — both need quoting.
    expect(csv.split("\n")[1]).toBe('"Food, ""weird""","A,B",0.00');
  });
});

// ─── exportBlankTemplate ──────────────────────────────────────────────────────

describe("exportBlankTemplate", () => {
  it("emits empty cells for all months", () => {
    const groups = [group({ id: "g1", name: "Food", categoryIds: ["c1"] })];
    const csv = exportBlankTemplate(
      ["2026-01", "2026-02"],
      groups,
      { c1: cat({ id: "c1" }) },
      { months: ["2026-01", "2026-02"], includeHidden: false, includeIncome: false }
    );
    expect(csv.split("\n")[1]).toBe("Food,Groceries,,");
  });
});

// ─── parseCsv ─────────────────────────────────────────────────────────────────

describe("parseCsv", () => {
  it("returns an empty array when input has only a header", () => {
    expect(parseCsv("Group Name,Category Name,2026-01")).toEqual([]);
  });

  it("strips the UTF-8 BOM (Excel-saved files)", () => {
    const csv = "﻿Group Name,Category Name,2026-01\nFood,Groceries,150.00";
    const rows = parseCsv(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.groupName).toBe("Food");
  });

  it("handles CRLF line endings", () => {
    const csv = "Group Name,Category Name,2026-01\r\nFood,Groceries,150.00\r\n";
    const rows = parseCsv(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.monthValues["2026-01"]).toBe("150.00");
  });

  it("parses quoted cells containing commas", () => {
    const csv = 'Group Name,Category Name,2026-01\n"Food, drink",Groceries,150.00';
    const rows = parseCsv(csv);
    expect(rows[0]?.groupName).toBe("Food, drink");
  });

  it("parses escaped double-quotes inside quoted cells", () => {
    const csv = 'Group Name,Category Name,2026-01\n"He said ""hi""",Cat,1.00';
    const rows = parseCsv(csv);
    expect(rows[0]?.groupName).toBe('He said "hi"');
  });

  it("skips fully empty lines", () => {
    const csv = "Group Name,Category Name,2026-01\n\nFood,Groceries,150.00\n";
    const rows = parseCsv(csv);
    expect(rows).toHaveLength(1);
  });

  it("treats empty value cells as no-op (not present in monthValues)", () => {
    const csv = "Group Name,Category Name,2026-01,2026-02\nFood,Groceries,150.00,";
    const rows = parseCsv(csv);
    expect(rows[0]?.monthValues["2026-01"]).toBe("150.00");
    expect(rows[0]?.monthValues["2026-02"]).toBeUndefined();
  });

  it("trims whitespace from group, category, and value cells", () => {
    const csv = "Group Name,Category Name,2026-01\n  Food  ,  Groceries  ,  150.00  ";
    const rows = parseCsv(csv);
    expect(rows[0]?.groupName).toBe("Food");
    expect(rows[0]?.categoryName).toBe("Groceries");
    expect(rows[0]?.monthValues["2026-01"]).toBe("150.00");
  });
});

// ─── matchImportRows ──────────────────────────────────────────────────────────

describe("matchImportRows", () => {
  const categories = [
    cat({ id: "c1", name: "Groceries", groupId: "g1", groupName: "Food" }),
    cat({ id: "c2", name: "Rent", groupId: "g2", groupName: "Housing" }),
  ];
  const availableMonths = ["2026-01", "2026-02", "2026-03"];
  const visibleMonths = ["2026-01", "2026-02"];

  it("marks rows with an exact group:category match", () => {
    const result = matchImportRows(
      [{ groupName: "Food", categoryName: "Groceries", monthValues: { "2026-01": "150" } }],
      categories,
      availableMonths,
      visibleMonths
    );
    expect(result[0]?.matchStatus).toBe("exact");
    expect(result[0]?.matchedCategoryId).toBe("c1");
  });

  it("matches case-insensitively", () => {
    const result = matchImportRows(
      [{ groupName: "FOOD", categoryName: "groceries", monthValues: {} }],
      categories,
      availableMonths,
      visibleMonths
    );
    expect(result[0]?.matchStatus).toBe("exact");
  });

  it("falls back to a Levenshtein suggestion at distance 1 (single insertion)", () => {
    const result = matchImportRows(
      [
        {
          groupName: "Food",
          categoryName: "Groceriess", // distance 1 from "groceries"
          monthValues: {},
        },
      ],
      categories,
      availableMonths,
      visibleMonths
    );
    expect(result[0]?.matchStatus).toBe("suggested");
    expect(result[0]?.matchedCategoryId).toBe("c1");
  });

  it("falls back to a Levenshtein suggestion at distance 2 (single substitution + deletion)", () => {
    const result = matchImportRows(
      [
        {
          groupName: "Food",
          categoryName: "Grocries", // distance 2 from "groceries" (delete 'e', sub no — actually 1 deletion)
          monthValues: {},
        },
      ],
      categories,
      availableMonths,
      visibleMonths
    );
    expect(result[0]?.matchStatus).toBe("suggested");
  });

  it("rejects suggestions when distance is 3 or greater", () => {
    const result = matchImportRows(
      [{ groupName: "Food", categoryName: "Xocries", monthValues: {} }],
      categories,
      availableMonths,
      visibleMonths
    );
    expect(result[0]?.matchStatus).toBe("unmatched");
  });

  it("returns unmatched when no key is within distance 2", () => {
    const result = matchImportRows(
      [{ groupName: "Travel", categoryName: "Hotels", monthValues: {} }],
      categories,
      availableMonths,
      visibleMonths
    );
    expect(result[0]?.matchStatus).toBe("unmatched");
    expect(result[0]?.matchedCategoryId).toBeNull();
  });

  it("classifies months as available, out-of-range, or absent", () => {
    const result = matchImportRows(
      [
        {
          groupName: "Food",
          categoryName: "Groceries",
          monthValues: {
            "2026-01": "1", // visible → available
            "2026-03": "3", // available but not visible → out-of-range
            "2099-12": "9", // not on server at all → absent
          },
        },
      ],
      categories,
      availableMonths,
      visibleMonths
    );
    expect(result[0]?.monthAvailability).toEqual({
      "2026-01": "available",
      "2026-03": "out-of-range",
      "2099-12": "absent",
    });
  });
});

// ─── buildImportPreview ───────────────────────────────────────────────────────

describe("buildImportPreview", () => {
  const groups = [group({ id: "g1", name: "Food", categoryIds: ["c1"] })];
  const categoriesById = { c1: cat({ id: "c1", budgeted: 12000 }) };

  it("emits one preview entry per available month with values converted to minor units", () => {
    const approved = [
      {
        csvRow: {
          groupName: "Food",
          categoryName: "Groceries",
          monthValues: { "2026-01": "150.00", "2026-02": "175.50" },
        },
        matchedCategoryId: "c1",
        matchedCategoryName: "Groceries",
        matchedGroupName: "Food",
        matchStatus: "exact" as const,
        monthAvailability: {
          "2026-01": "available" as const,
          "2026-02": "available" as const,
        },
      },
    ];
    const preview = buildImportPreview(approved, groups, categoriesById);
    expect(preview).toEqual([
      {
        categoryId: "c1",
        categoryName: "Groceries",
        groupName: "Food",
        month: "2026-01",
        previousBudgeted: 12000,
        nextBudgeted: 15000,
      },
      {
        categoryId: "c1",
        categoryName: "Groceries",
        groupName: "Food",
        month: "2026-02",
        previousBudgeted: 12000,
        nextBudgeted: 17550,
      },
    ]);
  });

  it("excludes out-of-range and absent months", () => {
    const approved = [
      {
        csvRow: {
          groupName: "Food",
          categoryName: "Groceries",
          monthValues: { "2026-01": "1", "2026-03": "3", "2099-12": "9" },
        },
        matchedCategoryId: "c1",
        matchedCategoryName: "Groceries",
        matchedGroupName: "Food",
        matchStatus: "exact" as const,
        monthAvailability: {
          "2026-01": "available" as const,
          "2026-03": "out-of-range" as const,
          "2099-12": "absent" as const,
        },
      },
    ];
    const preview = buildImportPreview(approved, groups, categoriesById);
    expect(preview.map((e) => e.month)).toEqual(["2026-01"]);
  });

  it("skips rows with no matched category", () => {
    const approved = [
      {
        csvRow: { groupName: "X", categoryName: "Y", monthValues: { "2026-01": "1" } },
        matchedCategoryId: null,
        matchedCategoryName: null,
        matchedGroupName: null,
        matchStatus: "unmatched" as const,
        monthAvailability: { "2026-01": "available" as const },
      },
    ];
    expect(buildImportPreview(approved, groups, categoriesById)).toEqual([]);
  });

  it("skips cells whose decimal value cannot be parsed", () => {
    const approved = [
      {
        csvRow: {
          groupName: "Food",
          categoryName: "Groceries",
          monthValues: { "2026-01": "garbage" },
        },
        matchedCategoryId: "c1",
        matchedCategoryName: "Groceries",
        matchedGroupName: "Food",
        matchStatus: "exact" as const,
        monthAvailability: { "2026-01": "available" as const },
      },
    ];
    expect(buildImportPreview(approved, groups, categoriesById)).toEqual([]);
  });
});
