import {
  getTrackingExpenseVariance,
  getTrackingExpenseVarianceLabel,
  getTrackingResultLabel,
  getTrackingResultValue,
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

  it("calculates visible tracking totals excluding hidden categories", () => {
    expect(getTrackingSummaryTotals(state())).toEqual({
      incomeBudgeted: 500_000,
      incomeActuals: 520_000,
      expenseBudgeted: 300_000,
      expenseActuals: 280_000,
    });
  });

  it("calculates expense variance only for past/current months", () => {
    expect(getTrackingExpenseVariance(state(), "2026-04", now)).toBe(20_000);
    expect(getTrackingExpenseVarianceLabel(state(), "2026-04", now)).toBe(
      "Under plan"
    );

    expect(getTrackingExpenseVariance(state(), "2026-06", now)).toBeNull();
    expect(getTrackingExpenseVarianceLabel(state(), "2026-06", now)).toBe(
      "Plan-only"
    );
  });

  it("uses actual result for past months and planned result for current/future months", () => {
    expect(getTrackingResultValue(state(), "2026-04", now)).toBe(240_000);
    expect(getTrackingResultLabel(state(), "2026-04", now)).toBe("Saved");

    expect(getTrackingResultValue(state(), "2026-05", now)).toBe(200_000);
    expect(getTrackingResultLabel(state(), "2026-05", now)).toBe(
      "Projected saved"
    );
    expect(getTrackingResultValue(state(), "2026-06", now)).toBe(200_000);
    expect(getTrackingResultLabel(state(), "2026-06", now)).toBe(
      "Projected saved"
    );
  });
});
