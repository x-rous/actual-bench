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

export type TrackingSummaryTone =
  | "positive"
  | "negative"
  | "warning"
  | "future"
  | "muted"
  | "neutral";

export type TrackingSummaryValueKind = "amount" | "percent";

export type TrackingSummaryCell = {
  label: string;
  value: number | null;
  valueKind: TrackingSummaryValueKind;
  signed?: boolean;
  tone: TrackingSummaryTone;
  tooltip: string;
};

export const TRACKING_INCOME_ON_TARGET_RATIO = 0.995;
export const TRACKING_INCOME_AHEAD_RATIO = 1.005;

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
    incomeActuals: state.summary.totalIncome,
    expenseBudgeted: Math.abs(state.summary.totalBudgeted),
    expenseActuals: Math.abs(state.summary.totalSpent),
  };

  for (const category of visibleTrackingCategories(state)) {
    if (category.isIncome) {
      totals.incomeBudgeted += category.budgeted;
    }
  }

  return totals;
}

function toneFromSignedValue(
  value: number,
  status: MonthActualStatus,
  futurePositiveTone: TrackingSummaryTone = "muted"
): TrackingSummaryTone {
  if (value < 0) return "negative";
  if (value > 0) return status === "future" ? futurePositiveTone : "positive";
  return status === "future" ? "muted" : "neutral";
}

export function getTrackingResultCell(
  state: LoadedMonthState,
  month: string,
  now: Date = new Date()
): TrackingSummaryCell {
  const status = classifyMonthActualStatus(month, now);
  const totals = getTrackingSummaryTotals(state);
  const value =
    status === "past"
      ? totals.incomeActuals - totals.expenseActuals
      : totals.incomeBudgeted - totals.expenseBudgeted;

  if (status === "past") {
    return {
      label: value > 0 ? "Saved" : value < 0 ? "Overspent" : "Even",
      value,
      valueKind: "amount",
      signed: true,
      tone: toneFromSignedValue(value, status),
      tooltip: `Actual income ${formatSummary(totals.incomeActuals)} - actual expenses ${formatSummary(totals.expenseActuals)}.`,
    };
  }

  if (status === "current-partial") {
    return {
      label:
        value > 0
          ? "Projected saved"
          : value < 0
            ? "Projected overspent"
            : "Projected even",
      value,
      valueKind: "amount",
      signed: true,
      tone: "future",
      tooltip: `Current partial month. Showing planned result: budgeted income ${formatSummary(totals.incomeBudgeted)} - budgeted expenses ${formatSummary(totals.expenseBudgeted)}.`,
    };
  }

  return {
    label:
      value > 0
        ? "Projected saved"
        : value < 0
          ? "Projected overspent"
          : "Projected even",
    value,
    valueKind: "amount",
    signed: true,
    tone: "future",
    tooltip: `Future month. Budgeted income ${formatSummary(totals.incomeBudgeted)} - budgeted expenses ${formatSummary(totals.expenseBudgeted)}.`,
  };
}

export function getTrackingSpendingCell(
  state: LoadedMonthState,
  month: string,
  now: Date = new Date()
): TrackingSummaryCell {
  const status = classifyMonthActualStatus(month, now);
  const totals = getTrackingSummaryTotals(state);

  if (status === "future") {
    return {
      label: "Budgeted",
      value: totals.expenseBudgeted,
      valueKind: "amount",
      tone: "future",
      tooltip: `Future month. Budgeted expenses are ${formatSummary(totals.expenseBudgeted)}.`,
    };
  }

  const variance = state.summary.totalBalance;
  const statusLabel =
    variance > 0
      ? status === "current-partial"
        ? "Under so far"
        : "Under budget"
      : variance < 0
        ? status === "current-partial"
          ? "Over so far"
          : "Over budget"
        : status === "current-partial"
          ? "On track"
          : "On budget";

  return {
    label: statusLabel,
    value: variance,
    valueKind: "amount",
    signed: true,
    tone:
      status === "current-partial"
        ? variance < 0
          ? "warning"
          : "muted"
        : toneFromSignedValue(variance, status),
    tooltip: `${status === "current-partial" ? "Current partial month. " : ""}Budgeted expenses ${formatSummary(totals.expenseBudgeted)} - actual expenses ${formatSummary(totals.expenseActuals)}.`,
  };
}

export function getTrackingIncomeCell(
  state: LoadedMonthState,
  month: string,
  now: Date = new Date()
): TrackingSummaryCell {
  const status = classifyMonthActualStatus(month, now);
  const totals = getTrackingSummaryTotals(state);

  if (status === "future") {
    return {
      label: "Budgeted",
      value: totals.incomeBudgeted,
      valueKind: "amount",
      tone: "future",
      tooltip: `Future month. Budgeted income is ${formatSummary(totals.incomeBudgeted)}.`,
    };
  }

  if (totals.incomeBudgeted <= 0) {
    return {
      label:
        status === "current-partial" && totals.incomeActuals > 0
          ? "Received so far"
          : totals.incomeActuals > 0
            ? "Received"
            : "No budget",
      value: totals.incomeActuals > 0 ? totals.incomeActuals : null,
      valueKind: "amount",
      tone:
        status === "current-partial"
          ? "muted"
          : totals.incomeActuals > 0
            ? "neutral"
            : "muted",
      tooltip:
        totals.incomeActuals > 0
          ? `${status === "current-partial" ? "Current partial month. " : ""}No income budget is set; received income is ${formatSummary(totals.incomeActuals)}.`
          : `${status === "current-partial" ? "Current partial month. " : ""}No income budget is set.`,
    };
  }

  const ratio = totals.incomeActuals / totals.incomeBudgeted;
  const percent = Math.round(ratio * 100);
  const isShort = ratio < TRACKING_INCOME_ON_TARGET_RATIO;
  const isAhead = ratio >= TRACKING_INCOME_AHEAD_RATIO;
  const statusLabel =
    status === "current-partial" && isShort
      ? "Received so far"
      : status === "current-partial" && isAhead
        ? "Ahead so far"
        : status === "current-partial"
          ? "On target so far"
          : isShort
            ? "Short"
            : isAhead
              ? "Ahead"
              : "On target";

  return {
    label: statusLabel,
    value: percent,
    valueKind: "percent",
    tone:
      status === "current-partial"
        ? "muted"
        : isShort
          ? "warning"
          : isAhead
            ? "positive"
            : "neutral",
    tooltip: `${status === "current-partial" ? "Current partial month. " : ""}Received income ${formatSummary(totals.incomeActuals)} / budgeted income ${formatSummary(totals.incomeBudgeted)}. 99.5% or higher is treated as on target.`,
  };
}

export function getTrackingExpenseVariance(
  state: LoadedMonthState,
  month: string,
  now: Date = new Date()
): number | null {
  const cell = getTrackingSpendingCell(state, month, now);
  return classifyMonthActualStatus(month, now) === "future" ? null : cell.value;
}

export function getTrackingExpenseVarianceLabel(
  state: LoadedMonthState,
  month: string,
  now: Date = new Date()
): string {
  if (classifyMonthActualStatus(month, now) === "future") return "Budgeted";
  return getTrackingSpendingCell(state, month, now).label;
}

export function getTrackingResultValue(
  state: LoadedMonthState,
  month: string,
  now: Date = new Date()
): number {
  return getTrackingResultCell(state, month, now).value ?? 0;
}

export function getTrackingResultLabel(
  state: LoadedMonthState,
  month: string,
  now: Date = new Date()
): string {
  return getTrackingResultCell(state, month, now).label;
}

export function getTrackingResultTooltip(
  state: LoadedMonthState,
  month: string,
  now: Date = new Date()
): string {
  return getTrackingResultCell(state, month, now).tooltip;
}

export function getTrackingExpenseVarianceTooltip(
  state: LoadedMonthState,
  month: string,
  now: Date = new Date()
): string {
  return getTrackingSpendingCell(state, month, now).tooltip;
}
