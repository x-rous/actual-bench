import { buildTrackingDetailsMetrics } from "./budgetDetailsMetrics";
import type { BudgetDetailsModel } from "./budgetDetailsModel";
import type { LoadedMonthState } from "../types";

function monthState(month: string, values: {
  incomeBudgeted: number;
  incomeActuals: number;
  expenseBudgeted: number;
  expenseActuals: number;
}): LoadedMonthState {
  return {
    summary: {
      month,
      incomeAvailable: 0,
      lastMonthOverspent: 0,
      forNextMonth: 0,
      totalBudgeted: values.expenseBudgeted,
      toBudget: 0,
      fromLastMonth: 0,
      totalIncome: values.incomeActuals,
      totalSpent: values.expenseActuals,
      totalBalance: 0,
    },
    groupOrder: ["income", "expenses"],
    groupsById: {
      income: {
        id: "income",
        name: "Income",
        isIncome: true,
        hidden: false,
        categoryIds: ["income-cat"],
        budgeted: values.incomeBudgeted,
        actuals: values.incomeActuals,
        balance: 0,
      },
      expenses: {
        id: "expenses",
        name: "Expenses",
        isIncome: false,
        hidden: false,
        categoryIds: ["expense-cat"],
        budgeted: values.expenseBudgeted,
        actuals: values.expenseActuals,
        balance: 0,
      },
    },
    categoriesById: {
      "income-cat": {
        id: "income-cat",
        name: "Income",
        groupId: "income",
        groupName: "Income",
        isIncome: true,
        hidden: false,
        budgeted: values.incomeBudgeted,
        actuals: values.incomeActuals,
        balance: 0,
        carryover: false,
      },
      "expense-cat": {
        id: "expense-cat",
        name: "Expenses",
        groupId: "expenses",
        groupName: "Expenses",
        isIncome: false,
        hidden: false,
        budgeted: values.expenseBudgeted,
        actuals: values.expenseActuals,
        balance: 0,
        carryover: false,
      },
    },
  };
}

describe("buildTrackingDetailsMetrics", () => {
  it("separates expense variance from net plan variance in the period summary", () => {
    const model: BudgetDetailsModel = {
      budgetMode: "tracking",
      displayMonths: ["2026-01", "2026-02"],
      rangeLabel: "Jan 2026 - Feb 2026",
      selection: { scope: "period", entity: "none" },
      months: [
        {
          month: "2026-01",
          status: "past",
          state: monthState("2026-01", {
            incomeBudgeted: 500_000,
            incomeActuals: 520_000,
            expenseBudgeted: -300_000,
            expenseActuals: -280_000,
          }),
        },
        {
          month: "2026-02",
          status: "future",
          state: monthState("2026-02", {
            incomeBudgeted: 500_000,
            incomeActuals: 0,
            expenseBudgeted: -300_000,
            expenseActuals: 0,
          }),
        },
      ],
      coverage: {
        totalMonths: 2,
        pastCount: 1,
        currentCount: 0,
        futureCount: 1,
        actualLikeCount: 1,
        hasFuture: true,
        isFutureOnly: false,
        label: "1 actualized - 1 future plan-only",
      },
      edits: {},
    };

    const metrics = buildTrackingDetailsMetrics(model);

    expect(metrics.periodBudgetToDate).toEqual({
      incomeBudgeted: 500_000,
      expensesBudgeted: 300_000,
      expenseVariance: 20_000,
      netPlanVariance: 40_000,
    });
    expect(metrics.periodFullPlan).toEqual({
      incomeBudgeted: 1_000_000,
      expensesBudgeted: 600_000,
      plannedResult: 400_000,
    });
  });
});
