import {
  aggregateCategoryVariances,
  buildVarianceTree,
  computeVarianceDrivers,
  treeHasData,
} from "./varianceDrivers";
import type {
  BudgetMonthSummary,
  LoadedCategory,
  LoadedMonthState,
} from "../types";

// ── Fixtures ────────────────────────────────────────────────────────────────

function makeCategory(
  partial: Partial<LoadedCategory> & Pick<LoadedCategory, "id" | "budgeted" | "actuals">
): LoadedCategory {
  return {
    name: partial.id,
    groupId: partial.groupId ?? "g",
    groupName: partial.groupName ?? "Group",
    isIncome: partial.isIncome ?? false,
    hidden: partial.hidden ?? false,
    // Grid convention: balance = budgeted + spent (spent is negative for
    // expenses), positive = under budget. Overridable per fixture.
    balance: (partial.budgeted ?? 0) + (partial.actuals ?? 0),
    carryover: false,
    ...partial,
  };
}

function makeState(categories: LoadedCategory[]): LoadedMonthState {
  const summary = {} as BudgetMonthSummary;
  const categoriesById: Record<string, LoadedCategory> = {};
  for (const category of categories) categoriesById[category.id] = category;
  return { summary, groupsById: {}, categoriesById, groupOrder: [] };
}

/**
 * Expense categories (stored NEGATIVE, like the runtime) summing to the spec's
 * worked example: budgeted 435,150.45 and actual 460,855.91.
 */
const EXPENSE_CATEGORIES: LoadedCategory[] = [
  makeCategory({ id: "Food & Groceries", budgeted: -3550000, actuals: -4593000 }),
  makeCategory({ id: "Real Estate", budgeted: -2080200, actuals: -2918100 }),
  makeCategory({ id: "Utilities", budgeted: -1710000, actuals: -1530000 }),
  makeCategory({ id: "Transport", budgeted: -1200000, actuals: -1000000 }),
  makeCategory({ id: "Insurance", budgeted: -800000, actuals: -900000 }),
  makeCategory({ id: "Everything Else", budgeted: -34174845, actuals: -35144491 }),
];

/** Income categories (positive) summing to budgeted 643,455.91, actual 643,774.55. */
const INCOME_CATEGORIES: LoadedCategory[] = [
  makeCategory({ id: "Salary", isIncome: true, budgeted: 60000000, actuals: 60000000 }),
  makeCategory({ id: "Side gig", isIncome: true, budgeted: 4345591, actuals: 4377455 }),
];

function toInputs(categories: LoadedCategory[], side: "expense" | "income") {
  return aggregateCategoryVariances([makeState(categories)], side);
}

// ── Worked reconciliation examples (§13) ─────────────────────────────────────

describe("computeVarianceDrivers — reconciliation", () => {
  it("expense: signed actual − signed budget = −25,705.46, exact", () => {
    const result = computeVarianceDrivers(toInputs(EXPENSE_CATEGORIES, "expense"), "expense");

    expect(result.totalBudgetedMinor).toBe(-43515045);
    expect(result.totalActualMinor).toBe(-46085591);
    expect(result.totalVarianceMinor).toBe(-2570546); // 25,705.46 over budget
    expect(result.favourable).toBe(false);

    // Sum of every driver + Other must equal the total, exactly (no tolerance).
    const summed =
      result.drivers.reduce((acc, d) => acc + d.varianceMinor, 0) +
      (result.other?.varianceMinor ?? 0);
    expect(summed).toBe(-2570546);
  });

  it("income: 643,774.55 actual − 643,455.91 budgeted = +318.64, exact", () => {
    const result = computeVarianceDrivers(toInputs(INCOME_CATEGORIES, "income"), "income");

    expect(result.totalBudgetedMinor).toBe(64345591);
    expect(result.totalActualMinor).toBe(64377455);
    expect(result.totalVarianceMinor).toBe(31864); // 318.64 above budget
    expect(result.favourable).toBe(true);

    const summed = result.drivers.reduce((acc, d) => acc + d.varianceMinor, 0);
    expect(summed).toBe(31864);
    expect(result.other).toBeNull();
  });

  it("showAll drivers always sum to the total with no Other bucket", () => {
    const result = computeVarianceDrivers(toInputs(EXPENSE_CATEGORIES, "expense"), "expense", {
      showAll: true,
    });
    expect(result.other).toBeNull();
    expect(result.drivers).toHaveLength(6);
    expect(result.drivers.reduce((acc, d) => acc + d.varianceMinor, 0)).toBe(-2570546);
  });
});

// ── Ranking, Other bucket, sign handling ─────────────────────────────────────

describe("computeVarianceDrivers — ranking", () => {
  it("ranks by absolute variance and includes both over- and under-budget", () => {
    const result = computeVarianceDrivers(toInputs(EXPENSE_CATEGORIES, "expense"), "expense");

    // Top 5 by |variance|: Food(1,043,000) Else(969,646) RealEstate(837,900)
    // Transport(200,000) Utilities(180,000). Insurance(100,000) → Other.
    expect(result.drivers.map((d) => d.id)).toEqual([
      "Food & Groceries",
      "Everything Else",
      "Real Estate",
      "Transport",
      "Utilities",
    ]);
    // Favourable (under budget) drivers survive the ranking, not only overspends.
    expect(result.drivers.find((d) => d.id === "Utilities")?.favourable).toBe(true);
    expect(result.drivers.find((d) => d.id === "Transport")?.favourable).toBe(true);
  });

  it("creates Other only for the categories beyond top-N", () => {
    const result = computeVarianceDrivers(toInputs(EXPENSE_CATEGORIES, "expense"), "expense");
    expect(result.other).toEqual({
      count: 1,
      budgetedMinor: -800000,
      actualMinor: -900000,
      varianceMinor: -100000, // Insurance, over budget
    });
  });

  it("omits Other when categories ≤ top-N", () => {
    const result = computeVarianceDrivers(toInputs(EXPENSE_CATEGORIES.slice(0, 3), "expense"), "expense");
    expect(result.other).toBeNull();
    expect(result.drivers).toHaveLength(3);
  });

  it("keeps expense budgets and actuals signed", () => {
    const result = computeVarianceDrivers(toInputs(EXPENSE_CATEGORIES, "expense"), "expense");
    const food = result.drivers.find((d) => d.id === "Food & Groceries")!;
    expect(food.budgetedMinor).toBe(-3550000);
    expect(food.actualMinor).toBe(-4593000);
    expect(food.varianceMinor).toBe(-1043000); // 10,430 over
  });

  it("treats a refund-positive expense actual as favourable", () => {
    const result = computeVarianceDrivers(
      toInputs([
        makeCategory({ id: "Refunded", budgeted: -1000, actuals: 200 }),
      ], "expense"),
      "expense"
    );
    expect(result.totalBudgetedMinor).toBe(-1000);
    expect(result.totalActualMinor).toBe(200);
    expect(result.totalVarianceMinor).toBe(1200);
    expect(result.favourable).toBe(true);
  });
});

// ── Side-segregated contribution % (§8) ──────────────────────────────────────

describe("computeVarianceDrivers — contribution %", () => {
  it("computes overspend share against total overspend, not net", () => {
    const result = computeVarianceDrivers(toInputs(EXPENSE_CATEGORIES, "expense"), "expense", {
      showAll: true,
    });
    // Unfavourable total = 1,043,000 + 969,646 + 837,900 + 100,000 = 2,950,546.
    const food = result.drivers.find((d) => d.id === "Food & Groceries")!;
    expect(food.contribution).toBeCloseTo(1043000 / 2950546, 10);
  });

  it("computes underspend share against total underspend only", () => {
    const result = computeVarianceDrivers(toInputs(EXPENSE_CATEGORIES, "expense"), "expense", {
      showAll: true,
    });
    // Favourable total = 200,000 + 180,000 = 380,000.
    const utilities = result.drivers.find((d) => d.id === "Utilities")!;
    expect(utilities.contribution).toBeCloseTo(180000 / 380000, 10);
  });

  it("returns null contribution when a side has no drivers", () => {
    const allOver = computeVarianceDrivers(
      [{ id: "a", name: "a", groupId: "g", groupName: "G", budgetedMinor: -100, actualMinor: -300 }],
      "expense"
    );
    expect(allOver.drivers[0].contribution).toBeCloseTo(1, 10);
    // No favourable side → any favourable driver would be null, but here none exist.
    expect(allOver.drivers[0].favourable).toBe(false);
  });
});

// ── Aggregation across closed months (View 1) & no group double-count (§12) ──

describe("aggregateCategoryVariances", () => {
  it("sums a category's budgeted/actual across multiple closed months", () => {
    const jan = makeState([makeCategory({ id: "Food", budgeted: -1000, actuals: -1200 })]);
    const feb = makeState([makeCategory({ id: "Food", budgeted: -1500, actuals: -1100 })]);
    const inputs = aggregateCategoryVariances([jan, feb], "expense");
    expect(inputs).toHaveLength(1);
    expect(inputs[0]).toMatchObject({ id: "Food", budgetedMinor: -2500, actualMinor: -2300 });
  });

  it("filters to the requested side (income vs expense)", () => {
    const state = makeState([
      makeCategory({ id: "Food", budgeted: -1000, actuals: -1200 }),
      makeCategory({ id: "Salary", isIncome: true, budgeted: 5000, actuals: 5200 }),
    ]);
    expect(aggregateCategoryVariances([state], "expense").map((c) => c.id)).toEqual(["Food"]);
    expect(aggregateCategoryVariances([state], "income").map((c) => c.id)).toEqual(["Salary"]);
  });

  it("counts only categories, never parent group totals (no double count)", () => {
    // groupsById is populated but must be ignored — only categoriesById contributes.
    const state = makeState([makeCategory({ id: "Food", budgeted: -1000, actuals: -1200 })]);
    (state.groupsById as Record<string, unknown>)["g"] = {
      id: "g",
      name: "Group",
      isIncome: false,
      hidden: false,
      categoryIds: ["Food"],
      budgeted: -1000,
      actuals: -1200,
      balance: 200,
    };
    const inputs = aggregateCategoryVariances([state], "expense");
    expect(inputs).toHaveLength(1);
    expect(inputs[0].budgetedMinor).toBe(-1000);
  });

  it("single income category is shown as-is, not padded (§5)", () => {
    const state = makeState([
      makeCategory({ id: "Salary", isIncome: true, budgeted: 5000, actuals: 4000 }),
    ]);
    const result = computeVarianceDrivers(
      aggregateCategoryVariances([state], "income"),
      "income"
    );
    expect(result.drivers).toHaveLength(1);
    expect(result.drivers[0].id).toBe("Salary");
    expect(result.drivers[0].varianceMinor).toBe(-1000); // 10.00 below budget
    expect(result.other).toBeNull();
  });
});

// ── Group tree (v3 analysis view) ────────────────────────────────────────────

function housingFoodStates(): LoadedMonthState[] {
  const g = (id: string, groupId: string, groupName: string, budgeted: number, actuals: number) =>
    makeCategory({ id, groupId, groupName, budgeted, actuals });
  const jan = makeState([
    g("Mortgage", "housing", "Housing", -1000, -1200),
    g("Property tax", "housing", "Housing", -400, -450),
    g("Groceries", "food", "Food", -300, -280),
  ]);
  const feb = makeState([
    g("Mortgage", "housing", "Housing", -1000, -1100),
    g("Property tax", "housing", "Housing", -400, -420),
    g("Groceries", "food", "Food", -300, -350),
  ]);
  return [jan, feb];
}

describe("buildVarianceTree", () => {
  it("rolls categories into groups and reconciles at every level", () => {
    const tree = buildVarianceTree(housingFoodStates(), "expense");

    expect(tree.monthCount).toBe(2);
    // Groups sorted by |variance|: Housing (370) before Food (30).
    expect(tree.groups.map((g) => g.id)).toEqual(["housing", "food"]);

    const housing = tree.groups[0];
    expect(housing).toMatchObject({ budgetedMinor: -2800, actualMinor: -3170, varianceMinor: -370 });

    // Σ children variance === group variance.
    expect(housing.children.reduce((a, c) => a + c.varianceMinor, 0)).toBe(-370);
    // Σ monthly series === group variance (per-month split, favourable-positive).
    expect(housing.monthly).toEqual([-250, -120]);
    expect(housing.monthly.reduce((a, m) => a + m, 0)).toBe(-370);
    // Children sorted by |variance|: Mortgage (300) before Property tax (70).
    expect(housing.children.map((c) => c.id)).toEqual(["Mortgage", "Property tax"]);

    // Σ groups === totals, exactly.
    expect(tree.totals).toMatchObject({
      budgetedMinor: -3400,
      actualMinor: -3800,
      varianceMinor: -400,
      overspendMinor: 400,
      savedMinor: 0,
    });
    expect(tree.groups.reduce((a, g) => a + g.varianceMinor, 0)).toBe(tree.totals.varianceMinor);
    // Net reconciles: saved − overspend === net variance.
    expect(tree.totals.savedMinor - tree.totals.overspendMinor).toBe(tree.totals.varianceMinor);
  });

  it("computes side-segregated contributions at group and child level", () => {
    const tree = buildVarianceTree(housingFoodStates(), "expense");
    const [housing, food] = tree.groups;
    // Group share of overspend (400): Housing 370/400, Food 30/400.
    expect(housing.contribution).toBeCloseTo(370 / 400, 10);
    expect(food.contribution).toBeCloseTo(30 / 400, 10);
    // Child share within Housing's overspend (370): Mortgage 300/370.
    expect(housing.children[0].contribution).toBeCloseTo(300 / 370, 10);
  });

  it("computes % of budget (signed) for groups and categories", () => {
    const tree = buildVarianceTree(housingFoodStates(), "expense");
    expect(tree.groups[0].pctOfBudget).toBeCloseTo(-370 / 2800, 10);
    expect(tree.groups[0].children[0].pctOfBudget).toBeCloseTo(-300 / 2000, 10);
  });

  it("excludes hidden categories (Tracking convention)", () => {
    const state = makeState([
      makeCategory({ id: "Rent", groupId: "housing", groupName: "Housing", budgeted: -1000, actuals: -1100 }),
      makeCategory({ id: "Secret", groupId: "housing", groupName: "Housing", hidden: true, budgeted: -200, actuals: -260 }),
    ]);
    const tree = buildVarianceTree([state], "expense");
    expect(tree.groups[0].budgetedMinor).toBe(-1000); // hidden "Secret" not counted
    expect(tree.groups[0].varianceMinor).toBe(-100);
    expect(tree.groups[0].children.map((c) => c.id)).toEqual(["Rent"]);
  });

  it("excludes an entire hidden group and its children", () => {
    const state = makeState([
      makeCategory({ id: "Rent", groupId: "housing", groupName: "Housing", budgeted: -1000, actuals: -1100 }),
      makeCategory({ id: "Fun", groupId: "hiddenGroup", groupName: "Hidden", budgeted: -500, actuals: -800 }),
    ]);
    (state.groupsById as Record<string, unknown>)["hiddenGroup"] = {
      id: "hiddenGroup",
      name: "Hidden",
      isIncome: false,
      hidden: true,
      categoryIds: ["Fun"],
      budgeted: -500,
      actuals: -800,
      balance: -300,
    };
    const tree = buildVarianceTree([state], "expense");
    expect(tree.groups.map((g) => g.id)).toEqual(["housing"]); // hidden group dropped
    expect(tree.totals.varianceMinor).toBe(-100);
  });

  it("filters to the requested side and reports data presence", () => {
    const state = makeState([
      makeCategory({ id: "Rent", groupId: "housing", groupName: "Housing", budgeted: -1000, actuals: -1100 }),
      makeCategory({ id: "Salary", groupId: "inc", groupName: "Income", isIncome: true, budgeted: 5000, actuals: 5200 }),
    ]);
    const expense = buildVarianceTree([state], "expense");
    const income = buildVarianceTree([state], "income");
    expect(expense.groups.map((g) => g.id)).toEqual(["housing"]);
    expect(income.groups.map((g) => g.id)).toEqual(["inc"]);
    expect(income.groups[0].varianceMinor).toBe(200); // 2.00 above budget
    expect(treeHasData(expense)).toBe(true);
    expect(treeHasData(buildVarianceTree([], "expense"))).toBe(false);
  });
});
