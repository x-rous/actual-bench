import {
  buildBudgetTransactionBrowserOptions,
  buildMonthCategoriesDrilldown,
  buildRangeCategoriesDrilldown,
  type BudgetTransactionBrowserOptions,
} from "./budgetTransactionBrowser";
import type { BudgetDetailsModel } from "./budgetDetailsModel";
import type { LoadedMonthState } from "../types";

function monthState(): LoadedMonthState {
  return {
    summary: {
      month: "2026-04",
      incomeAvailable: 0,
      lastMonthOverspent: 0,
      forNextMonth: 0,
      totalBudgeted: -10000,
      toBudget: 0,
      fromLastMonth: 0,
      totalIncome: 0,
      totalSpent: -5000,
      totalBalance: 5000,
    },
    groupOrder: ["expenses", "income"],
    groupsById: {
      expenses: {
        id: "expenses",
        name: "Expenses",
        isIncome: false,
        hidden: false,
        categoryIds: ["food", "hidden-food"],
        budgeted: -10000,
        actuals: -5000,
        balance: 5000,
      },
      income: {
        id: "income",
        name: "Income",
        isIncome: true,
        hidden: false,
        categoryIds: ["paycheck"],
        budgeted: 10000,
        actuals: 10000,
        balance: 0,
      },
    },
    categoriesById: {
      food: {
        id: "food",
        name: "Food",
        groupId: "expenses",
        groupName: "Expenses",
        isIncome: false,
        hidden: false,
        budgeted: -10000,
        actuals: -5000,
        balance: 5000,
        carryover: false,
      },
      "hidden-food": {
        id: "hidden-food",
        name: "Hidden Food",
        groupId: "expenses",
        groupName: "Expenses",
        isIncome: false,
        hidden: true,
        budgeted: -10000,
        actuals: -5000,
        balance: 5000,
        carryover: false,
      },
      paycheck: {
        id: "paycheck",
        name: "Paycheck",
        groupId: "income",
        groupName: "Income",
        isIncome: true,
        hidden: false,
        budgeted: 10000,
        actuals: 10000,
        balance: 0,
        carryover: false,
      },
    },
  };
}

function model(): BudgetDetailsModel {
  return {
    budgetMode: "tracking",
    displayMonths: ["2026-04", "2026-05"],
    rangeLabel: "Apr 2026 - May 2026",
    selection: {
      scope: "month",
      entity: "category",
      month: "2026-04",
      categoryId: "food",
    },
    months: [
      { month: "2026-04", status: "past", state: monthState() },
      { month: "2026-05", status: "current-partial", state: undefined },
    ],
    coverage: {
      totalMonths: 2,
      pastCount: 1,
      currentCount: 1,
      futureCount: 0,
      actualLikeCount: 2,
      hasFuture: false,
      isFutureOnly: false,
      label: "1 actualized - 1 current partial",
    },
    edits: {},
  };
}

describe("budget transaction browser options", () => {
  it("builds visible month and side-tagged category jump options", () => {
    const options: BudgetTransactionBrowserOptions =
      buildBudgetTransactionBrowserOptions(model());

    expect(options.months).toEqual([
      { month: "2026-04", label: "Apr 26" },
      { month: "2026-05", label: "May 26" },
    ]);
    // The whole-side options lead: they are the widest selection on offer, and
    // the list reads outside-in from there.
    expect(options.categories).toEqual([
      {
        id: "__all_expenses__",
        entity: "group",
        side: "expense",
        title: "All expenses",
        subtitle: "Every expense category",
        categoryIds: ["food"],
      },
      {
        id: "__all_income__",
        entity: "group",
        side: "income",
        title: "All income",
        subtitle: "Every income category",
        categoryIds: ["paycheck"],
      },
      {
        id: "expenses",
        entity: "group",
        side: "expense",
        title: "Expenses",
        subtitle: "Expense group",
        categoryIds: ["food"],
      },
      {
        id: "food",
        entity: "category",
        side: "expense",
        title: "Food",
        subtitle: "Expenses",
        categoryIds: ["food"],
      },
      {
        id: "income",
        entity: "group",
        side: "income",
        title: "Income",
        subtitle: "Income group",
        categoryIds: ["paycheck"],
      },
      {
        id: "paycheck",
        entity: "category",
        side: "income",
        title: "Paycheck",
        subtitle: "Income",
        categoryIds: ["paycheck"],
      },
    ]);
  });
});

describe("buildMonthCategoriesDrilldown", () => {
  it("collects visible expense categories for the month (excludes hidden)", () => {
    const drill = buildMonthCategoriesDrilldown(monthState(), "2026-04", "expense");
    expect(drill).toEqual({
      id: "__month_expenses__",
      monthStart: "2026-04",
      monthEnd: "2026-04",
      title: "All expenses",
      entity: "group",
      side: "expense",
      categoryIds: ["food"],
    });
  });

  it("collects visible income categories for the month", () => {
    const drill = buildMonthCategoriesDrilldown(monthState(), "2026-04", "income");
    expect(drill).toMatchObject({
      id: "__month_income__",
      title: "All income",
      categoryIds: ["paycheck"],
    });
  });

  it("returns null when the month has no matching categories", () => {
    const state = monthState();
    // Hide the only income category → no income to drill into.
    state.categoriesById.paycheck.hidden = true;
    expect(buildMonthCategoriesDrilldown(state, "2026-04", "income")).toBeNull();
  });
});

/*
 * The period summary's actuals cover every visible category across the months
 * the figure sums. Reading categories from a single month would silently drop
 * anything created or retired partway through the window, so the ids are
 * unioned across the range - and the range itself has to be the months that
 * were summed, not the whole view, or the dialog opens on a different number
 * than the one that was clicked.
 */
describe("buildRangeCategoriesDrilldown", () => {
  const state = (categories: { id: string; income?: boolean; hidden?: boolean }[]) => ({
    groupOrder: ["g-exp", "g-inc"],
    groupsById: {
      "g-exp": { id: "g-exp", name: "Expenses", isIncome: false, hidden: false,
        categoryIds: categories.filter((c) => !c.income).map((c) => c.id) },
      "g-inc": { id: "g-inc", name: "Income", isIncome: true, hidden: false,
        categoryIds: categories.filter((c) => c.income).map((c) => c.id) },
    },
    categoriesById: Object.fromEntries(
      categories.map((c) => [c.id, {
        id: c.id, name: c.id, groupId: c.income ? "g-inc" : "g-exp", groupName: c.income ? "Income" : "Expenses",
        isIncome: !!c.income, hidden: !!c.hidden,
      }])
    ),
  }) as unknown as LoadedMonthState;

  it("unions categories across the range and spans its loaded months", () => {
    const result = buildRangeCategoriesDrilldown(
      [
        { month: "2026-01", state: state([{ id: "food" }]) },
        { month: "2026-02", state: state([{ id: "food" }, { id: "fuel" }]) },
      ],
      "expense"
    );
    expect(result).toMatchObject({
      monthStart: "2026-01",
      monthEnd: "2026-02",
      title: "All expenses",
      side: "expense",
      entity: "group",
    });
    expect(result?.categoryIds.sort()).toEqual(["food", "fuel"]);
  });

  it("keeps to the requested side and skips hidden categories", () => {
    const months = [
      { month: "2026-01", state: state([{ id: "food" }, { id: "salary", income: true }, { id: "old", hidden: true }]) },
    ];
    expect(buildRangeCategoriesDrilldown(months, "income")?.categoryIds).toEqual(["salary"]);
    expect(buildRangeCategoriesDrilldown(months, "expense")?.categoryIds).toEqual(["food"]);
  });

  it("ignores months with no loaded state when bounding the range", () => {
    const result = buildRangeCategoriesDrilldown(
      [
        { month: "2026-01", state: null },
        { month: "2026-02", state: state([{ id: "food" }]) },
        { month: "2026-03", state: null },
      ],
      "expense"
    );
    expect(result).toMatchObject({ monthStart: "2026-02", monthEnd: "2026-02" });
  });

  it("returns null when nothing on that side is visible", () => {
    expect(buildRangeCategoriesDrilldown([{ month: "2026-01", state: null }], "expense")).toBeNull();
    expect(
      buildRangeCategoriesDrilldown([{ month: "2026-01", state: state([{ id: "food" }]) }], "income")
    ).toBeNull();
  });
});
