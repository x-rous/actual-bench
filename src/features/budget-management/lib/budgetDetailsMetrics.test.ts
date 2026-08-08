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

function signedExpenseBudget(value: number): number {
  return value === 0 ? 0 : -Math.abs(value);
}

function signedExpenseVariance(budgeted: number, actuals: number): number {
  return actuals - signedExpenseBudget(budgeted);
}

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
    signedExpenseVariance(summaryExpenseBudgeted, summaryExpenseActuals);
  const groupExpenseBudgeted =
    values.groupExpenseBudgeted ?? values.expenseBudgeted;
  const groupExpenseActuals =
    values.groupExpenseActuals ?? values.expenseActuals;
  const groupExpenseBalance =
    values.groupExpenseBalance ??
    signedExpenseVariance(groupExpenseBudgeted, groupExpenseActuals);
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
        balance: signedExpenseVariance(
          categoryExpenseBudgeted,
          categoryExpenseActuals
        ),
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
      incomeActuals: 520_000,
      expensesBudgeted: -300_000,
      expenseVariance: 20_000,
      incomeVariance: 20_000,
      netPlanVariance: 44_000,
    });
    expect(metrics.periodFullPlan).toEqual({
      incomeBudgeted: 1_000_000,
      expensesBudgeted: -600_000,
      plannedResult: 400_000,
    });
    expect(metrics.periodActuals).toEqual({
      incomeReceived: 525_000,
      expensesSpent: -281_000,
      result: 244_000,
    });
  });

  it("keeps refund-positive expenses signed and keeps hidden rows out of budget variance", () => {
    const state = monthState("2026-03", {
      incomeBudgeted: 500_000,
      incomeActuals: 520_000,
      expenseBudgeted: -100_000,
      expenseActuals: 20_000,
      summaryIncomeActuals: 530_000,
      summaryExpenseActuals: -30_000,
    });
    state.groupOrder.push("hidden-income", "hidden-expenses");
    state.groupsById["hidden-income"] = {
      id: "hidden-income",
      name: "Hidden Income",
      isIncome: true,
      hidden: true,
      categoryIds: ["hidden-income-cat"],
      budgeted: 0,
      actuals: 10_000,
      balance: 0,
    };
    state.groupsById["hidden-expenses"] = {
      id: "hidden-expenses",
      name: "Hidden Expenses",
      isIncome: false,
      hidden: true,
      categoryIds: ["hidden-expense-cat"],
      budgeted: -50_000,
      actuals: -50_000,
      balance: 0,
    };
    state.categoriesById["hidden-income-cat"] = {
      id: "hidden-income-cat",
      name: "Hidden Income",
      groupId: "hidden-income",
      groupName: "Hidden Income",
      isIncome: true,
      hidden: false,
      budgeted: 0,
      actuals: 10_000,
      balance: 0,
      carryover: false,
    };
    state.categoriesById["hidden-expense-cat"] = {
      id: "hidden-expense-cat",
      name: "Hidden Expense",
      groupId: "hidden-expenses",
      groupName: "Hidden Expenses",
      isIncome: false,
      hidden: false,
      budgeted: -50_000,
      actuals: -50_000,
      balance: 0,
      carryover: false,
    };

    const metrics = buildTrackingDetailsMetrics(
      modelForSelection({ selection: { scope: "period", entity: "none" }, state })
    );

    expect(metrics.periodActuals).toEqual({
      incomeReceived: 530_000,
      expensesSpent: -30_000,
      result: 500_000,
    });
    expect(metrics.periodBudgetToDate).toEqual({
      incomeBudgeted: 500_000,
      incomeActuals: 520_000,
      expensesBudgeted: -100_000,
      expenseVariance: 120_000,
      incomeVariance: 20_000,
      netPlanVariance: 100_000,
    });
    expect(metrics.meter).toMatchObject({
      total: 100_000,
      filled: 0,
      remaining: 120_000,
      remainingLabel: "under",
    });
  });

  it("treats a selected expense category refund as favourable signed actuals", () => {
    const metrics = buildTrackingDetailsMetrics(
      modelForSelection({
        selection: {
          scope: "period",
          entity: "category",
          categoryId: "expense-cat",
        },
        state: monthState("2026-04", {
          incomeBudgeted: 0,
          incomeActuals: 0,
          expenseBudgeted: -100_000,
          expenseActuals: 20_000,
        }),
      })
    );

    expect(metrics.primary).toMatchObject({
      label: "Under budget to date by",
      value: 120_000,
    });
    expect(metrics.selectionToDate).toMatchObject({
      budgeted: -100_000,
      actuals: 20_000,
      variance: 120_000,
    });
    expect(metrics.meter).toMatchObject({
      total: 100_000,
      filled: 0,
      remaining: 120_000,
      remainingLabel: "under",
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
      budgetLabel: "Budgeted",
      actualLabel: "Spent",
    });
    expect(metrics.selectionAverages).toMatchObject({
      budgetLabel: "Budgeted / month",
      actualLabel: "Spent / month",
    });
  });

  // ── closed-vs-current separation (no blending of the in-progress month) ──
  // "now" sits on Aug 14 2026 (noon), so 2026-08 is the current partial month
  // (~43.5% elapsed) and 2026-07 is closed.
  const NOW = new Date(2026, 7, 14, 12, 0, 0);

  function periodModel(
    months: { month: string; status: MonthActualStatus; state: LoadedMonthState }[]
  ): BudgetDetailsModel {
    let pastCount = 0;
    let currentCount = 0;
    let futureCount = 0;
    for (const m of months) {
      if (m.status === "past") pastCount++;
      else if (m.status === "current-partial") currentCount++;
      else futureCount++;
    }
    return {
      budgetMode: "tracking",
      displayMonths: months.map((m) => m.month),
      rangeLabel: "range",
      selection: { scope: "period", entity: "none" },
      months,
      coverage: {
        totalMonths: months.length,
        pastCount,
        currentCount,
        futureCount,
        actualLikeCount: pastCount + currentCount,
        hasFuture: futureCount > 0,
        isFutureOnly: pastCount + currentCount === 0 && futureCount > 0,
        label: "range",
      },
      edits: {},
    };
  }

  it("excludes the current partial month from closed-month cumulative figures", () => {
    const model = periodModel([
      {
        month: "2026-07",
        status: "past",
        state: monthState("2026-07", {
          incomeBudgeted: 500_000,
          incomeActuals: 520_000,
          expenseBudgeted: -300_000,
          expenseActuals: -280_000,
        }),
      },
      {
        month: "2026-08",
        status: "current-partial",
        state: monthState("2026-08", {
          incomeBudgeted: 130_000,
          incomeActuals: 71_000,
          expenseBudgeted: -60_000,
          expenseActuals: -48_000,
        }),
      },
    ]);

    const metrics = buildTrackingDetailsMetrics(model, NOW);

    // Cumulative figures see the closed month only — the partial month is out.
    expect(metrics.closedMonthCount).toBe(1);
    expect(metrics.periodActuals).toEqual({
      incomeReceived: 520_000,
      expensesSpent: -280_000,
      result: 240_000,
    });
    expect(metrics.periodBudgetToDate).toMatchObject({
      incomeBudgeted: 500_000,
      incomeActuals: 520_000,
      expensesBudgeted: -300_000,
      expenseVariance: 20_000,
      incomeVariance: 20_000,
    });
    expect(metrics.primary).toMatchObject({ label: "Result", value: 240_000 });

    // The in-progress month is reported on its own, with income progress.
    expect(metrics.thisMonth).toMatchObject({
      month: "2026-08",
      budgeted: 60_000,
      actuals: 48_000,
      // 80% used at ~43% elapsed → ~1.8× the linear rate.
      paceStatus: "well-over-pace",
      income: { budgeted: 130_000, actuals: 71_000 },
    });
    expect(metrics.thisMonth?.usedFraction).toBeCloseTo(0.8, 5);
  });

  it.each([
    [26_100, "on-pace"], // ~43.5% used vs ~43.5% elapsed
    [33_000, "slightly-over-pace"], // ~55% used vs ~43.5% elapsed, ratio < 1.6
    [48_000, "well-over-pace"], // 80% used, ~1.8× the linear rate
    [60_000, "over-budget"], // 100% of the month's budget already spent
  ] as const)(
    "classifies this-month spend of %d as %s",
    (expenseActuals, expected) => {
      const model = periodModel([
        {
          month: "2026-08",
          status: "current-partial",
          state: monthState("2026-08", {
            incomeBudgeted: 130_000,
            incomeActuals: 71_000,
            expenseBudgeted: -60_000,
            expenseActuals: -expenseActuals,
          }),
        },
      ]);

      const metrics = buildTrackingDetailsMetrics(model, NOW);

      // No closed months → cumulative figures are withheld, pacing still shown.
      expect(metrics.closedMonthCount).toBe(0);
      expect(metrics.periodActuals).toBeUndefined();
      expect(metrics.primary).toMatchObject({ label: "No closed months yet" });
      expect(metrics.thisMonth?.paceStatus).toBe(expected);
    }
  );

  it("summarises per-month coverage for the header strip", () => {
    const state = monthState("2026-07", {
      incomeBudgeted: 1,
      incomeActuals: 1,
      expenseBudgeted: -1,
      expenseActuals: -1,
    });
    const model = periodModel([
      { month: "2026-06", status: "past", state },
      { month: "2026-08", status: "current-partial", state },
      { month: "2026-09", status: "future", state },
    ]);

    const metrics = buildTrackingDetailsMetrics(model, NOW);

    expect(metrics.coverage).toEqual({
      segments: ["past", "current-partial", "future"],
      closedCount: 1,
      currentCount: 1,
      futureCount: 1,
      totalMonths: 3,
    });
  });

  it("projects the period result as closed actuals plus the plan for every open month", () => {
    const model = periodModel([
      {
        month: "2026-07",
        status: "past",
        state: monthState("2026-07", {
          incomeBudgeted: 500_000, // planned +200k
          incomeActuals: 520_000, // actual +240k
          expenseBudgeted: -300_000,
          expenseActuals: -280_000,
        }),
      },
      {
        month: "2026-08",
        status: "current-partial",
        state: monthState("2026-08", {
          incomeBudgeted: 130_000, // planned +70k
          incomeActuals: 71_000, // actual +23k
          expenseBudgeted: -60_000,
          expenseActuals: -48_000,
        }),
      },
      {
        month: "2026-09",
        status: "future",
        state: monthState("2026-09", {
          incomeBudgeted: 500_000, // planned +200k
          incomeActuals: 0,
          expenseBudgeted: -300_000,
          expenseActuals: 0,
        }),
      },
    ]);

    const metrics = buildTrackingDetailsMetrics(model, NOW);
    const traj = metrics.trajectory;

    // Closed actuals = 240k (Jul). Aug (current) + Sep (future) contribute plan
    // (70k + 200k), not Aug's income-starved partial actuals → 240k + 270k.
    expect(traj).toMatchObject({
      isSpend: false,
      todayIndex: 0, // actual line ends at the last closed month (Jul)
      projectedValue: 510_000,
      planValue: 470_000, // 200k + 70k + 200k
      variance: 40_000,
      varianceLabel: "above",
      chipLabel: "ahead of plan", // +8.5% vs plan, beyond the 2% tolerance
      lineTone: "positive",
      // 270k plan for the 2 open months (Aug 70k + Sep 200k).
      breakdown: { openPlan: 270_000, openMonthCount: 2 },
    });
    expect(traj?.points).toHaveLength(3);
    expect(traj?.points[1].actual).toBeNull(); // Aug is not banked
    expect(traj?.points[2].actual).toBeNull();
  });

  it("marks the projection below plan when it misses by more than the tolerance", () => {
    const model = periodModel([
      {
        month: "2026-07",
        status: "past",
        state: monthState("2026-07", {
          incomeBudgeted: 500_000, // plan +200k
          incomeActuals: 450_000, // actual +150k (closed month underperforms)
          expenseBudgeted: -300_000,
          expenseActuals: -300_000,
        }),
      },
      {
        month: "2026-08",
        status: "current-partial",
        state: monthState("2026-08", {
          incomeBudgeted: 130_000, // plan +70k
          incomeActuals: 0,
          expenseBudgeted: -60_000,
          expenseActuals: 0,
        }),
      },
      {
        month: "2026-09",
        status: "future",
        state: monthState("2026-09", {
          incomeBudgeted: 500_000, // plan +200k
          incomeActuals: 0,
          expenseBudgeted: -300_000,
          expenseActuals: 0,
        }),
      },
    ]);

    const traj = buildTrackingDetailsMetrics(model, NOW).trajectory;

    // Projected 150k (closed) + 270k (open plan) = 420k vs 470k plan → ~11% below.
    expect(traj).toMatchObject({
      projectedValue: 420_000,
      planValue: 470_000,
      chipLabel: "below plan",
      chipTone: "neutral",
      lineTone: "positive", // still a positive result, just under plan
    });
  });

  it("projects expense spend by run-rate (can exceed the plan)", () => {
    const model: BudgetDetailsModel = {
      ...periodModel([
        {
          month: "2026-07",
          status: "past",
          state: monthState("2026-07", {
            incomeBudgeted: 0,
            incomeActuals: 0,
            expenseBudgeted: -50_000,
            expenseActuals: -60_000,
          }),
        },
        {
          month: "2026-08",
          status: "current-partial",
          state: monthState("2026-08", {
            incomeBudgeted: 0,
            incomeActuals: 0,
            expenseBudgeted: -50_000,
            expenseActuals: -30_000,
          }),
        },
        {
          month: "2026-09",
          status: "future",
          state: monthState("2026-09", {
            incomeBudgeted: 0,
            incomeActuals: 0,
            expenseBudgeted: -50_000,
            expenseActuals: 0,
          }),
        },
      ]),
      selection: { scope: "period", entity: "category", categoryId: "expense-cat" },
    };

    const metrics = buildTrackingDetailsMetrics(model, NOW);
    const traj = metrics.trajectory;

    expect(traj?.isSpend).toBe(true);
    expect(traj?.planValue).toBe(150_000);
    // banked 90k over ~47.8% of the period → run-rate well above the 150k plan.
    expect(traj?.projectedValue).toBeGreaterThan(150_000);
    expect(traj).toMatchObject({
      variance: expect.any(Number),
      varianceLabel: "over",
      chipLabel: "at risk",
      planLabel: "Full-period budget",
    });
  });

  it("reports day-of-month progress for a single-month selection", () => {
    const model: BudgetDetailsModel = {
      budgetMode: "tracking",
      displayMonths: ["2026-08"],
      rangeLabel: "August 2026",
      selection: {
        scope: "month",
        entity: "category",
        month: "2026-08",
        categoryId: "expense-cat",
      },
      months: [
        {
          month: "2026-08",
          status: "current-partial",
          state: monthState("2026-08", {
            incomeBudgeted: 0,
            incomeActuals: 0,
            expenseBudgeted: -60_000,
            expenseActuals: -48_000,
          }),
        },
      ],
      coverage: {
        totalMonths: 1,
        pastCount: 0,
        currentCount: 1,
        futureCount: 0,
        actualLikeCount: 1,
        hasFuture: false,
        isFutureOnly: false,
        label: "1 current partial",
      },
      edits: {},
    };

    const metrics = buildTrackingDetailsMetrics(model, NOW);

    expect(metrics.dayProgress).toMatchObject({
      closed: false,
      dayLabel: "day 14 of 31",
    });
    expect(metrics.dayProgress?.elapsedFraction).toBeGreaterThan(0.4);
    expect(metrics.dayProgress?.elapsedFraction).toBeLessThan(0.5);
  });

  it("computes this-month pace for a current single-month tracking selection", () => {
    const model = modelForSelection({
      selection: {
        scope: "month",
        entity: "category",
        month: "2026-08",
        categoryId: "expense-cat",
      },
      month: "2026-08",
      status: "current-partial",
      state: monthState("2026-08", {
        incomeBudgeted: 0,
        incomeActuals: 0,
        expenseBudgeted: -580_000,
        expenseActuals: -77_196, // ~13% used at ~43% elapsed → under pace
      }),
    });

    const metrics = buildTrackingDetailsMetrics(model, NOW);

    expect(metrics.thisMonth).toMatchObject({
      month: "2026-08",
      budgeted: 580_000,
      actuals: 77_196,
      paceStatus: "under-pace",
    });
  });

  it("gives the envelope period summary the coverage strip (parity)", () => {
    const model = periodModel([
      {
        month: "2026-06",
        status: "past",
        state: monthState("2026-06", {
          incomeBudgeted: 1,
          incomeActuals: 1,
          expenseBudgeted: -1,
          expenseActuals: -1,
        }),
      },
      {
        month: "2026-08",
        status: "current-partial",
        state: monthState("2026-08", {
          incomeBudgeted: 1,
          incomeActuals: 1,
          expenseBudgeted: -1,
          expenseActuals: -1,
        }),
      },
    ]);

    const metrics = buildEnvelopeDetailsMetrics({ ...model, budgetMode: "envelope" });

    expect(metrics.coverage).toMatchObject({
      totalMonths: 2,
      closedCount: 1,
      currentCount: 1,
    });
  });

  it("uses visible child values for selected Tracking groups", () => {
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
      value: 40_000,
    });
    expect(metrics.selectionToDate).toMatchObject({
      budgeted: -300_000,
      actuals: -260_000,
      variance: 40_000,
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
      value: -300_000,
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
      variant: "envelope",
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
      budgeted: -60_000,
      spent: -45_000,
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
