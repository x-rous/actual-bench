import { buildTrackingDetailsMetrics } from "./budgetDetailsMetrics";
import type {
  BudgetDetailsModel,
  BudgetDetailsSelection,
  MonthActualStatus,
} from "./budgetDetailsModel";
import type { LoadedMonthState } from "../types";

function monthState(month: string, values: {
  incomeBudgeted: number;
  incomeActuals: number;
  expenseBudgeted: number;
  expenseActuals: number;
  summaryIncomeActuals?: number;
  summaryExpenseActuals?: number;
  summaryExpenseBudgeted?: number;
  summaryExpenseVariance?: number;
  groupExpenseBudgeted?: number;
  groupExpenseActuals?: number;
  groupExpenseBalance?: number;
  categoryExpenseBudgeted?: number;
  categoryExpenseActuals?: number;
}): LoadedMonthState {
  const summaryIncomeActuals =
    values.summaryIncomeActuals ?? values.incomeActuals;
  const summaryExpenseActuals =
    values.summaryExpenseActuals ?? values.expenseActuals;
  const summaryExpenseBudgeted =
    values.summaryExpenseBudgeted ?? values.expenseBudgeted;
  const summaryExpenseVariance =
    values.summaryExpenseVariance ??
    Math.abs(summaryExpenseBudgeted) - Math.abs(summaryExpenseActuals);
  const groupExpenseBudgeted =
    values.groupExpenseBudgeted ?? values.expenseBudgeted;
  const groupExpenseActuals =
    values.groupExpenseActuals ?? values.expenseActuals;
  const groupExpenseBalance =
    values.groupExpenseBalance ??
    Math.abs(groupExpenseBudgeted) - Math.abs(groupExpenseActuals);
  const categoryExpenseBudgeted =
    values.categoryExpenseBudgeted ?? values.expenseBudgeted;
  const categoryExpenseActuals =
    values.categoryExpenseActuals ?? values.expenseActuals;

  return {
    summary: {
      month,
      incomeAvailable: 0,
      lastMonthOverspent: 0,
      forNextMonth: 0,
      totalBudgeted: summaryExpenseBudgeted,
      toBudget: 0,
      fromLastMonth: 0,
      totalIncome: summaryIncomeActuals,
      totalSpent: summaryExpenseActuals,
      totalBalance: summaryExpenseVariance,
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
        budgeted: groupExpenseBudgeted,
        actuals: groupExpenseActuals,
        balance: groupExpenseBalance,
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
        budgeted: categoryExpenseBudgeted,
        actuals: categoryExpenseActuals,
        balance: Math.abs(categoryExpenseBudgeted) - Math.abs(categoryExpenseActuals),
        carryover: false,
      },
    },
  };
}

function modelForSelection({
  selection,
  month = "2026-04",
  status = "past",
  state = monthState(month, {
    incomeBudgeted: 500_000,
    incomeActuals: 520_000,
    expenseBudgeted: -300_000,
    expenseActuals: -280_000,
  }),
}: {
  selection: BudgetDetailsSelection;
  month?: string;
  status?: MonthActualStatus;
  state?: LoadedMonthState;
}): BudgetDetailsModel {
  return {
    budgetMode: "tracking",
    displayMonths: [month],
    rangeLabel: "Apr 2026",
    selection,
    months: [{ month, status, state }],
    coverage: {
      totalMonths: 1,
      pastCount: status === "past" ? 1 : 0,
      currentCount: status === "current-partial" ? 1 : 0,
      futureCount: status === "future" ? 1 : 0,
      actualLikeCount: status === "future" ? 0 : 1,
      hasFuture: status === "future",
      isFutureOnly: status === "future",
      label:
        status === "future"
          ? "1 future plan-only"
          : status === "current-partial"
            ? "1 current partial"
            : "1 actualized",
    },
    edits: {},
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
            summaryIncomeActuals: 525_000,
            summaryExpenseActuals: -281_000,
            summaryExpenseBudgeted: -305_000,
            summaryExpenseVariance: 22_000,
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
            summaryExpenseBudgeted: -310_000,
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
      expensesBudgeted: 305_000,
      expenseVariance: 22_000,
      netPlanVariance: 49_000,
    });
    expect(metrics.periodFullPlan).toEqual({
      incomeBudgeted: 1_000_000,
      expensesBudgeted: 615_000,
      plannedResult: 385_000,
    });
    expect(metrics.periodActuals).toEqual({
      incomeReceived: 525_000,
      expensesSpent: 281_000,
      result: 244_000,
    });
  });

  it("uses budget wording for selected expense label summaries", () => {
    const metrics = buildTrackingDetailsMetrics(
      modelForSelection({
        selection: {
          scope: "period",
          entity: "category",
          categoryId: "expense-cat",
        },
      })
    );

    expect(metrics.primary).toMatchObject({
      label: "Under budget to date by",
      value: 20_000,
    });
    expect(metrics.selectionToDate).toMatchObject({
      budgetLabel: "Budgeted to date",
      actualLabel: "Spent to date",
    });
    expect(metrics.selectionAverages).toMatchObject({
      budgetLabel: "Budgeted / month",
      actualLabel: "Spent / month",
    });
  });

  it("uses group aggregate values for selected Tracking groups", () => {
    const state = monthState("2026-04", {
      incomeBudgeted: 500_000,
      incomeActuals: 520_000,
      expenseBudgeted: -300_000,
      expenseActuals: -280_000,
      groupExpenseBudgeted: -450_000,
      groupExpenseActuals: -420_000,
      groupExpenseBalance: 30_000,
      categoryExpenseBudgeted: -300_000,
      categoryExpenseActuals: -260_000,
    });
    state.groupsById.expenses!.categoryIds.push("hidden-expense-cat");
    state.categoriesById["hidden-expense-cat"] = {
      id: "hidden-expense-cat",
      name: "Hidden Expense",
      groupId: "expenses",
      groupName: "Expenses",
      isIncome: false,
      hidden: true,
      budgeted: -100_000,
      actuals: -100_000,
      balance: 0,
      carryover: false,
    };

    const metrics = buildTrackingDetailsMetrics(
      modelForSelection({
        selection: {
          scope: "period",
          entity: "group",
          groupId: "expenses",
        },
        state,
      })
    );

    expect(metrics.primary).toMatchObject({
      label: "Under budget to date by",
      value: 30_000,
    });
    expect(metrics.selectionToDate).toMatchObject({
      budgeted: 450_000,
      actuals: 420_000,
      variance: 30_000,
    });
  });

  it("exposes visible category ids for selected expense group month transaction drilldown", () => {
    const state = monthState("2026-04", {
      incomeBudgeted: 500_000,
      incomeActuals: 520_000,
      expenseBudgeted: -300_000,
      expenseActuals: -280_000,
      groupExpenseBudgeted: -400_000,
      groupExpenseActuals: -360_000,
      groupExpenseBalance: 40_000,
    });
    state.groupsById.expenses!.categoryIds.push("hidden-expense-cat");
    state.categoriesById["hidden-expense-cat"] = {
      id: "hidden-expense-cat",
      name: "Hidden Expense",
      groupId: "expenses",
      groupName: "Expenses",
      isIncome: false,
      hidden: true,
      budgeted: -100_000,
      actuals: -100_000,
      balance: 0,
      carryover: false,
    };

    const metrics = buildTrackingDetailsMetrics(
      modelForSelection({
        selection: {
          scope: "month",
          entity: "group",
          month: "2026-04",
          groupId: "expenses",
        },
        state,
      })
    );

    expect(metrics.monthValues?.transactionDrilldown).toEqual({
      id: "expenses",
      month: "2026-04",
      title: "Expenses",
      entity: "group",
      categoryIds: ["expense-cat"],
    });
  });

  it("uses shorter budget wording for selected current expense month cells", () => {
    const metrics = buildTrackingDetailsMetrics(
      modelForSelection({
        month: "2026-05",
        status: "current-partial",
        selection: {
          scope: "month",
          entity: "category",
          month: "2026-05",
          categoryId: "expense-cat",
        },
        state: monthState("2026-05", {
          incomeBudgeted: 500_000,
          incomeActuals: 520_000,
          expenseBudgeted: -300_000,
          expenseActuals: -280_000,
        }),
      })
    );

    expect(metrics.primary).toMatchObject({
      label: "Under so far by",
      value: 20_000,
    });
    expect(metrics.monthValues).toMatchObject({
      actualLabel: "Spent",
    });
  });

  it("shows selected future Tracking month cells as budgeted only", () => {
    const metrics = buildTrackingDetailsMetrics(
      modelForSelection({
        month: "2026-06",
        status: "future",
        selection: {
          scope: "month",
          entity: "category",
          month: "2026-06",
          categoryId: "expense-cat",
        },
        state: monthState("2026-06", {
          incomeBudgeted: 500_000,
          incomeActuals: 0,
          expenseBudgeted: -300_000,
          expenseActuals: 0,
        }),
      })
    );

    expect(metrics.primary).toMatchObject({
      label: "Budgeted",
      value: 300_000,
    });
    expect(metrics.monthValues).toMatchObject({
      actuals: null,
      variance: null,
    });
  });

  it("treats near-target selected income as on target", () => {
    const metrics = buildTrackingDetailsMetrics(
      modelForSelection({
        selection: {
          scope: "period",
          entity: "category",
          categoryId: "income-cat",
        },
        state: monthState("2026-04", {
          incomeBudgeted: 500_000,
          incomeActuals: 498_000,
          expenseBudgeted: -300_000,
          expenseActuals: -280_000,
        }),
      })
    );

    expect(metrics.primary).toMatchObject({
      label: "On target to date",
      value: null,
      tone: "neutral",
    });
  });
});
