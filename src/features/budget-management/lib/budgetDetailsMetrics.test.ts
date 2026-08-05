import {
  buildTrackingDetailsMetrics,
  buildEnvelopeDetailsMetrics,
  buildMonthSummaryMeter,
} from "./budgetDetailsMetrics";
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

describe("details meter (F-086)", () => {
  it("attaches a plan-progress meter to a tracking expense selection", () => {
    const metrics = buildTrackingDetailsMetrics(
      modelForSelection({
        selection: { scope: "month", entity: "category", month: "2026-04", categoryId: "expense-cat" },
        state: monthState("2026-04", {
          incomeBudgeted: 0,
          incomeActuals: 0,
          expenseBudgeted: -300_000,
          expenseActuals: -280_000,
          categoryExpenseBudgeted: -300_000,
          categoryExpenseActuals: -280_000,
        }),
      })
    );
    // Budgeted 3000, spent 2800 → under by 200.
    expect(metrics.meter).toMatchObject({
      total: 300_000,
      filled: 280_000,
      remaining: 20_000,
      remainingLabel: "under",
      variant: "expense",
    });
  });

  it("omits the meter on a future (plan-only) month", () => {
    const metrics = buildTrackingDetailsMetrics(
      modelForSelection({
        selection: { scope: "month", entity: "category", month: "2026-04", categoryId: "expense-cat" },
        status: "future",
      })
    );
    expect(metrics.meter).toBeUndefined();
  });

  it("omits the envelope meter for an income target", () => {
    const metrics = buildEnvelopeDetailsMetrics(
      modelForSelection({
        selection: { scope: "month", entity: "category", month: "2026-04", categoryId: "income-cat" },
        state: monthState("2026-04", {
          incomeBudgeted: 500_000,
          incomeActuals: 480_000,
          expenseBudgeted: -300_000,
          expenseActuals: -280_000,
        }),
      })
    );
    expect(metrics.meter).toBeUndefined();
  });
});

describe("buildMonthSummaryMeter", () => {
  it("builds an envelope-fill meter (available = spent + balance)", () => {
    const meter = buildMonthSummaryMeter({
      isTracking: false,
      budgeted: 60_000,
      spent: 45_000,
      balance: 15_000,
    });
    expect(meter).toMatchObject({
      total: 60_000, // 45k spent + 15k balance
      filled: 45_000,
      remaining: 15_000,
      remainingLabel: "left",
      variant: "expense",
    });
  });

  it("flags an overspent envelope (negative balance) as over", () => {
    const meter = buildMonthSummaryMeter({
      isTracking: false,
      budgeted: 60_000,
      spent: 70_000,
      balance: -10_000,
    });
    expect(meter?.remaining).toBe(-10_000);
    expect(meter?.remainingLabel).toBe("over");
  });

  it("builds a plan-progress meter in tracking mode", () => {
    const meter = buildMonthSummaryMeter({
      isTracking: true,
      budgeted: 60_000,
      spent: 45_000,
      balance: 15_000,
    });
    expect(meter).toMatchObject({
      total: 60_000, // budgeted is the track in tracking mode
      filled: 45_000,
      remainingLabel: "under",
    });
  });

  it("returns no meter when nothing is budgeted and nothing spent", () => {
    expect(
      buildMonthSummaryMeter({ isTracking: false, budgeted: 0, spent: 0, balance: 0 })
    ).toBeUndefined();
    expect(
      buildMonthSummaryMeter({ isTracking: true, budgeted: 0, spent: 0, balance: 0 })
    ).toBeUndefined();
  });

  it("uses a neutral 'on budget' label when tracking expense is exactly on plan", () => {
    const meter = buildTrackingDetailsMetrics(
      modelForSelection({
        selection: { scope: "month", entity: "category", month: "2026-04", categoryId: "expense-cat" },
        state: monthState("2026-04", {
          incomeBudgeted: 0,
          incomeActuals: 0,
          expenseBudgeted: -300_000,
          expenseActuals: -300_000,
          categoryExpenseBudgeted: -300_000,
          categoryExpenseActuals: -300_000,
        }),
      })
    ).meter;
    expect(meter).toMatchObject({ remaining: 0, remainingLabel: "on budget" });
  });

  it("uses a neutral 'on plan' label when tracking income exactly hits plan", () => {
    const meter = buildTrackingDetailsMetrics(
      modelForSelection({
        selection: { scope: "month", entity: "category", month: "2026-04", categoryId: "income-cat" },
        state: monthState("2026-04", {
          incomeBudgeted: 500_000,
          incomeActuals: 500_000,
          expenseBudgeted: -300_000,
          expenseActuals: -280_000,
        }),
      })
    ).meter;
    expect(meter).toMatchObject({ remaining: 0, remainingLabel: "on plan", variant: "income" });
  });
});
