import {
  trackingIncomeBalance,
  trackingIncomeBudgeted,
  trackingVisibleIncomeCategories,
} from "./monthAuthority";
import type { LoadedCategory, LoadedGroup, LoadedMonthState } from "../types";

function category(overrides: Partial<LoadedCategory>): LoadedCategory {
  return {
    id: "cat",
    name: "Category",
    groupId: "group",
    groupName: "Group",
    isIncome: false,
    hidden: false,
    budgeted: 0,
    actuals: 0,
    balance: 0,
    carryover: false,
    ...overrides,
  };
}

function group(overrides: Partial<LoadedGroup>): LoadedGroup {
  return {
    id: "group",
    name: "Group",
    isIncome: false,
    hidden: false,
    categoryIds: [],
    budgeted: 0,
    actuals: 0,
    balance: 0,
    ...overrides,
  };
}

// Income with a visible category, a hidden category, and a hidden income group;
// plus an expense category that must never be counted as income.
function state(): LoadedMonthState {
  return {
    summary: {
      month: "2026-04",
      incomeAvailable: 0,
      lastMonthOverspent: 0,
      forNextMonth: 0,
      totalBudgeted: -100_000,
      toBudget: 0,
      fromLastMonth: 0,
      totalIncome: 0,
      totalSpent: 0,
      totalBalance: 0,
    },
    groupOrder: ["income", "income-hidden", "expenses"],
    groupsById: {
      income: group({ id: "income", isIncome: true, categoryIds: ["salary", "bonus-hidden"] }),
      "income-hidden": group({
        id: "income-hidden",
        isIncome: true,
        hidden: true,
        categoryIds: ["side"],
      }),
      expenses: group({ id: "expenses", categoryIds: ["rent"] }),
    },
    categoriesById: {
      salary: category({ id: "salary", groupId: "income", isIncome: true, budgeted: 500_000, balance: 20_000 }),
      "bonus-hidden": category({
        id: "bonus-hidden",
        groupId: "income",
        isIncome: true,
        hidden: true,
        budgeted: 300_000,
        balance: 5_000,
      }),
      side: category({ id: "side", groupId: "income-hidden", isIncome: true, budgeted: 200_000, balance: 1_000 }),
      rent: category({ id: "rent", groupId: "expenses", budgeted: -100_000, balance: 0 }),
    },
  };
}

describe("monthAuthority canonical selectors (BM-14)", () => {
  it("counts only visible income categories (excludes hidden cats and hidden groups)", () => {
    const ids = trackingVisibleIncomeCategories(state()).map((c) => c.id);
    expect(ids).toEqual(["salary"]);
  });

  it("sums budgeted income from visible income categories only", () => {
    // 500,000 (salary) — excludes bonus-hidden and the hidden group's side income.
    expect(trackingIncomeBudgeted(state())).toBe(500_000);
  });

  it("sums income balance from visible income categories only", () => {
    expect(trackingIncomeBalance(state())).toBe(20_000);
  });

  it("does not shift when a category's hidden flag changes visibility inclusion", () => {
    const s = state();
    s.categoriesById["bonus-hidden"]!.hidden = false;
    // Now bonus counts too: 500,000 + 300,000.
    expect(trackingIncomeBudgeted(s)).toBe(800_000);
  });
});
