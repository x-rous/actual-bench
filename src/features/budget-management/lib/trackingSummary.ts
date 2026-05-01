import {
  classifyMonthActualStatus,
  type MonthActualStatus,
} from "./budgetDetailsModel";
import { formatSummary } from "./format";
import type { LoadedCategory, LoadedMonthState } from "../types";

export type TrackingSummaryTotals = {
  incomeBudgeted: number;
  incomeActuals: number;
  expenseBudgeted: number;
  expenseActuals: number;
};

function visibleTrackingCategories(state: LoadedMonthState): LoadedCategory[] {
  const result: LoadedCategory[] = [];
  for (const groupId of state.groupOrder) {
    const group = state.groupsById[groupId];
    if (!group || group.hidden) continue;
    for (const categoryId of group.categoryIds) {
      const category = state.categoriesById[categoryId];
      if (!category || category.hidden) continue;
      result.push(category);
    }
  }
  return result;
}

export function getTrackingSummaryTotals(
  state: LoadedMonthState
): TrackingSummaryTotals {
  const totals: TrackingSummaryTotals = {
    incomeBudgeted: 0,
    incomeActuals: 0,
    expenseBudgeted: 0,
    expenseActuals: 0,
  };

  for (const category of visibleTrackingCategories(state)) {
    if (category.isIncome) {
      totals.incomeBudgeted += category.budgeted;
      totals.incomeActuals += category.actuals;
    } else {
      totals.expenseBudgeted += Math.abs(category.budgeted);
      totals.expenseActuals += Math.abs(category.actuals);
    }
  }

  return totals;
}

export function getTrackingExpenseVariance(
  state: LoadedMonthState,
  month: string,
  now: Date = new Date()
): number | null {
  if (classifyMonthActualStatus(month, now) === "future") return null;
  const totals = getTrackingSummaryTotals(state);
  return totals.expenseBudgeted - totals.expenseActuals;
}

export function getTrackingExpenseVarianceLabel(
  state: LoadedMonthState,
  month: string,
  now: Date = new Date()
): string {
  const variance = getTrackingExpenseVariance(state, month, now);
  if (variance == null) return "Plan-only";
  if (variance > 0) return "Under plan";
  if (variance < 0) return "Over plan";
  return "On plan";
}

export function getTrackingResultValue(
  state: LoadedMonthState,
  month: string,
  now: Date = new Date()
): number {
  const status = classifyMonthActualStatus(month, now);
  const totals = getTrackingSummaryTotals(state);
  if (status === "past") {
    return totals.incomeActuals - totals.expenseActuals;
  }
  return totals.incomeBudgeted - totals.expenseBudgeted;
}

export function getTrackingResultLabel(
  state: LoadedMonthState,
  month: string,
  now: Date = new Date()
): string {
  const status = classifyMonthActualStatus(month, now);
  const value = getTrackingResultValue(state, month, now);
  if (status === "past") return value >= 0 ? "Saved" : "Overspent";
  return value >= 0 ? "Projected saved" : "Projected overspent";
}

export function getTrackingResultTooltip(
  state: LoadedMonthState,
  month: string,
  now: Date = new Date()
): string {
  const status: MonthActualStatus = classifyMonthActualStatus(month, now);
  const totals = getTrackingSummaryTotals(state);
  if (status === "past") {
    return `Actual income ${formatSummary(totals.incomeActuals)} - actual expenses ${formatSummary(totals.expenseActuals)}`;
  }
  return `Budgeted income ${formatSummary(totals.incomeBudgeted)} - budgeted expenses ${formatSummary(totals.expenseBudgeted)}`;
}

export function getTrackingExpenseVarianceTooltip(
  state: LoadedMonthState,
  month: string,
  now: Date = new Date()
): string {
  if (classifyMonthActualStatus(month, now) === "future") {
    return "Plan-only month. Expense variance appears once the month is current or actualized.";
  }
  const totals = getTrackingSummaryTotals(state);
  return `Budgeted expenses ${formatSummary(totals.expenseBudgeted)} - actual expenses ${formatSummary(totals.expenseActuals)}`;
}
