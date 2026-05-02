import {
  calculateSectionTotal,
  getSectionEffectiveView,
} from "./sectionTotals";
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

function state(): LoadedMonthState {
  return {
    summary: {
      month: "2026-04",
      incomeAvailable: 0,
      lastMonthOverspent: 0,
      forNextMonth: 0,
      totalBudgeted: -700_000,
      toBudget: 0,
      fromLastMonth: 0,
      totalIncome: 1_100_000,
      totalSpent: -650_000,
      totalBalance: 50_000,
    },
    groupOrder: [
      "income-visible",
      "income-hidden",
      "expense-visible",
      "expense-hidden",
    ],
    groupsById: {
      "income-visible": group({
        id: "income-visible",
        name: "Income",
        isIncome: true,
        categoryIds: ["salary", "bonus-hidden"],
        budgeted: 900_000,
        actuals: 1_000_000,
        balance: 100_000,
      }),
      "income-hidden": group({
        id: "income-hidden",
        name: "Hidden Income",
        isIncome: true,
        hidden: true,
        categoryIds: ["side-income"],
        budgeted: 300_000,
        actuals: 300_000,
        balance: 0,
      }),
      "expense-visible": group({
        id: "expense-visible",
        name: "Expenses",
        categoryIds: ["rent"],
        budgeted: -600_000,
        actuals: -550_000,
        balance: 50_000,
      }),
      "expense-hidden": group({
        id: "expense-hidden",
        name: "Hidden Expenses",
        hidden: true,
        categoryIds: ["hidden-expense"],
        budgeted: -100_000,
        actuals: -100_000,
        balance: 0,
      }),
    },
    categoriesById: {
      salary: category({
        id: "salary",
        groupId: "income-visible",
        groupName: "Income",
        isIncome: true,
        budgeted: 900_000,
        actuals: 1_000_000,
        balance: 100_000,
      }),
      "bonus-hidden": category({
        id: "bonus-hidden",
        groupId: "income-visible",
        groupName: "Income",
        isIncome: true,
        hidden: true,
        budgeted: 200_000,
        actuals: 200_000,
        balance: 0,
      }),
      "side-income": category({
        id: "side-income",
        groupId: "income-hidden",
        groupName: "Hidden Income",
        isIncome: true,
        budgeted: 300_000,
        actuals: 300_000,
        balance: 0,
      }),
      rent: category({
        id: "rent",
        groupId: "expense-visible",
        groupName: "Expenses",
        budgeted: -600_000,
        actuals: -550_000,
        balance: 50_000,
      }),
      "hidden-expense": category({
        id: "hidden-expense",
        groupId: "expense-hidden",
        groupName: "Hidden Expenses",
        hidden: true,
        budgeted: -100_000,
        actuals: -100_000,
        balance: 0,
      }),
    },
  };
}

describe("section total helpers", () => {
  it("uses the income spent view for envelope income rows", () => {
    expect(
      getSectionEffectiveView({
        budgetMode: "envelope",
        filter: "income",
        cellView: "budgeted",
      })
    ).toBe("spent");
    expect(
      getSectionEffectiveView({
        budgetMode: "tracking",
        filter: "income",
        cellView: "budgeted",
      })
    ).toBe("budgeted");
  });

  it("uses API summary totals for tracking expense section totals", () => {
    const testState = state();

    expect(
      calculateSectionTotal({
        state: testState,
        filter: "expense",
        cellView: "budgeted",
        budgetMode: "tracking",
      })
    ).toBe(-700_000);
    expect(
      calculateSectionTotal({
        state: testState,
        filter: "expense",
        cellView: "spent",
        budgetMode: "tracking",
      })
    ).toBe(-650_000);
    expect(
      calculateSectionTotal({
        state: testState,
        filter: "expense",
        cellView: "balance",
        budgetMode: "tracking",
      })
    ).toBe(50_000);
  });

  it("uses API total income for tracking received income", () => {
    expect(
      calculateSectionTotal({
        state: state(),
        filter: "income",
        cellView: "spent",
        budgetMode: "tracking",
      })
    ).toBe(1_100_000);
  });

  it("uses visible income categories for tracking income budget and variance", () => {
    const testState = state();

    expect(
      calculateSectionTotal({
        state: testState,
        filter: "income",
        cellView: "budgeted",
        budgetMode: "tracking",
      })
    ).toBe(900_000);
    expect(
      calculateSectionTotal({
        state: testState,
        filter: "income",
        cellView: "balance",
        budgetMode: "tracking",
      })
    ).toBe(100_000);
  });

  it("keeps envelope totals based on group aggregates, including hidden groups", () => {
    const testState = state();

    expect(
      calculateSectionTotal({
        state: testState,
        filter: "expense",
        cellView: "budgeted",
        budgetMode: "envelope",
      })
    ).toBe(-700_000);
    expect(
      calculateSectionTotal({
        state: testState,
        filter: "income",
        cellView: "budgeted",
        budgetMode: "envelope",
      })
    ).toBe(1_300_000);
  });
});
