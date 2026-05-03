import {
  buildBudgetTransactionBrowserOptions,
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
  it("builds visible month and expense category jump options", () => {
    const options: BudgetTransactionBrowserOptions =
      buildBudgetTransactionBrowserOptions(model());

    expect(options.months).toEqual([
      { month: "2026-04", label: "Apr 26" },
      { month: "2026-05", label: "May 26" },
    ]);
    expect(options.categories).toEqual([
      {
        id: "expenses",
        entity: "group",
        title: "Expenses",
        subtitle: "Expense group",
        categoryIds: ["food"],
      },
      {
        id: "food",
        entity: "category",
        title: "Food",
        subtitle: "Expenses",
        categoryIds: ["food"],
      },
    ]);
  });
});
