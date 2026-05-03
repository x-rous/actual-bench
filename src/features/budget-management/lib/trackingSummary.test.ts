import {
  getTrackingIncomeCell,
  getTrackingExpenseVariance,
  getTrackingExpenseVarianceLabel,
  getTrackingResultCell,
  getTrackingResultLabel,
  getTrackingResultValue,
  getTrackingSpendingCell,
  getTrackingSummaryTotals,
} from "./trackingSummary";
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
  const income = category({
    id: "income",
    groupId: "income-group",
    groupName: "Income",
    isIncome: true,
    budgeted: 500_000,
    actuals: 520_000,
  });
  const rent = category({
    id: "rent",
    groupId: "expense-group",
    groupName: "Expenses",
    budgeted: -300_000,
    actuals: -280_000,
  });
  const hiddenExpense = category({
    id: "hidden-expense",
    groupId: "expense-group",
    groupName: "Expenses",
    hidden: true,
    budgeted: -100_000,
    actuals: -100_000,
  });

  return {
    summary: {
      month: "2026-04",
      incomeAvailable: 0,
      lastMonthOverspent: 0,
      forNextMonth: 0,
      totalBudgeted: -400_000,
      toBudget: 0,
      fromLastMonth: 0,
      totalIncome: 520_000,
      totalSpent: -380_000,
      totalBalance: 140_000,
    },
    groupOrder: ["income-group", "expense-group"],
    groupsById: {
      "income-group": group({
        id: "income-group",
        name: "Income",
        isIncome: true,
        categoryIds: ["income"],
      }),
      "expense-group": group({
        id: "expense-group",
        name: "Expenses",
        categoryIds: ["rent", "hidden-expense"],
      }),
    },
    categoriesById: {
      income,
      rent,
      "hidden-expense": hiddenExpense,
    },
  };
}

describe("tracking summary helpers", () => {
  const now = new Date("2026-05-02T12:00:00Z");

  it("uses API month summary totals for tracking actuals and expense budget", () => {
    expect(getTrackingSummaryTotals(state())).toEqual({
      incomeBudgeted: 500_000,
      incomeActuals: 520_000,
      expenseBudgeted: 400_000,
      expenseActuals: 380_000,
    });
  });

  it("calculates expense variance only for past/current months", () => {
    expect(getTrackingExpenseVariance(state(), "2026-04", now)).toBe(140_000);
    expect(getTrackingExpenseVarianceLabel(state(), "2026-04", now)).toBe(
      "Under budget"
    );

    expect(getTrackingExpenseVariance(state(), "2026-06", now)).toBeNull();
    expect(getTrackingExpenseVarianceLabel(state(), "2026-06", now)).toBe(
      "Budgeted"
    );
  });

  it("builds spending cells without treating future months as actual performance", () => {
    expect(getTrackingSpendingCell(state(), "2026-04", now)).toMatchObject({
      label: "Under budget",
      value: 140_000,
      signed: true,
      tone: "positive",
    });

    expect(getTrackingSpendingCell(state(), "2026-06", now)).toMatchObject({
      label: "Budgeted",
      value: 400_000,
      tone: "future",
    });
  });

  it("uses shorter current-month labels", () => {
    expect(getTrackingSpendingCell(state(), "2026-05", now)).toMatchObject({
      label: "Under so far",
      value: 140_000,
    });

    expect(getTrackingIncomeCell(state(), "2026-05", now)).toMatchObject({
      label: "Ahead so far",
      value: 104,
      tone: "muted",
    });
  });

  it("uses actual result for past months and planned result for current/future months", () => {
    expect(getTrackingResultValue(state(), "2026-04", now)).toBe(140_000);
    expect(getTrackingResultLabel(state(), "2026-04", now)).toBe("Saved");

    expect(getTrackingResultValue(state(), "2026-05", now)).toBe(100_000);
    expect(getTrackingResultLabel(state(), "2026-05", now)).toBe(
      "Projected saved"
    );
    expect(getTrackingResultCell(state(), "2026-05", now)).toMatchObject({
      tone: "future",
    });
    expect(getTrackingResultValue(state(), "2026-06", now)).toBe(100_000);
    expect(getTrackingResultLabel(state(), "2026-06", now)).toBe(
      "Projected saved"
    );
  });

  it("keeps future result and income cells visually muted", () => {
    expect(getTrackingResultCell(state(), "2026-06", now)).toMatchObject({
      label: "Projected saved",
      value: 100_000,
      tone: "future",
    });

    expect(getTrackingIncomeCell(state(), "2026-06", now)).toMatchObject({
      label: "Budgeted",
      value: 500_000,
      tone: "future",
    });
  });

  it("treats near-match income as on target", () => {
    const testState = state();
    testState.summary.totalIncome = 499_500;

    expect(getTrackingIncomeCell(testState, "2026-04", now)).toMatchObject({
      label: "On target",
      value: 100,
      valueKind: "percent",
      tone: "neutral",
    });

    testState.summary.totalIncome = 502_000;
    expect(getTrackingIncomeCell(testState, "2026-04", now)).toMatchObject({
      label: "On target",
      value: 100,
      tone: "neutral",
    });

    testState.summary.totalIncome = 503_000;
    expect(getTrackingIncomeCell(testState, "2026-04", now)).toMatchObject({
      label: "Ahead",
      value: 101,
      tone: "positive",
    });
  });
});
