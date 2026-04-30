import { formatMonthLabel, prevMonth } from "@/lib/budget/monthMath";
import type {
  BudgetCellKey,
  LoadedCategory,
  LoadedMonthState,
} from "../types";
import {
  isActualLikeStatus,
  type BudgetDetailsModel,
  type BudgetDetailsMonth,
  type BudgetDetailsSelection,
  type MonthActualStatus,
} from "./budgetDetailsModel";

export type DetailsTone = "positive" | "negative" | "neutral";

export type BudgetTrendPoint = {
  month: string;
  label: string;
  value: number | null;
  status: MonthActualStatus;
  planOnly: boolean;
};

export type RelevantStagedImpact = {
  count: number;
  budgetDelta: number;
  estimatedToBudgetImpact: number;
};

type TargetInfo = {
  id: string;
  title: string;
  subtitle: string;
  isIncome: boolean;
  groupId?: string;
  categoryIds: string[];
};

type DetailsEntity = BudgetDetailsSelection["entity"];
type DetailsScope = BudgetDetailsSelection["scope"];
type DetailsKind = "period" | "group" | "category";

type MonthEditDetails = {
  was: number;
  diff: number;
};

type TrackingSelectedMonthValues = {
  budgetLabel: string;
  actualLabel: string;
  budgeted: number;
  actuals: number | null;
  variance: number | null;
  rolloverBalance: RolloverBalanceLine | null;
  previousBudgeted: number | null;
  stagedEdit: MonthEditDetails | null;
};

type TrackingSelectionAverages = {
  budgetLabel: string;
  actualLabel: string;
  budgetPerMonth: number;
  actualPerMonth: number | null;
  variancePerMonth: number | null;
};

type RolloverBalanceLine = {
  label: string;
  value: number;
  helper: string;
  tone: DetailsTone;
};

type TrackingRolloverMetrics = {
  current: RolloverBalanceLine | null;
  endPlan: RolloverBalanceLine | null;
};

type EnvelopeSelectedMonthValues = {
  assignedBudgeted: number;
  spent: number;
  balance: number;
  previousBalance: number | null;
  previousLabel: string | null;
  carryover: boolean | null;
  stagedEdit: MonthEditDetails | null;
};

export type TrackingDetailsMetrics = {
  scope: DetailsScope;
  entity: DetailsEntity;
  kind: DetailsKind;
  title: string;
  subtitle: string;
  rangeLabel: string;
  coverageLabel: string;
  futureOnly: boolean;
  isIncome: boolean;
  primary: {
    label: string;
    value: number | null;
    helper: string;
    tone: DetailsTone;
  };
  periodActuals?: {
    incomeReceived: number;
    expensesSpent: number;
    result: number;
  };
  periodBudgetToDate?: {
    incomeBudgeted: number;
    expensesBudgeted: number;
    planVariance: number;
  };
  periodFullPlan?: {
    incomeBudgeted: number;
    expensesBudgeted: number;
    plannedResult: number;
  };
  selectionToDate?: {
    budgetLabel: string;
    actualLabel: string;
    budgeted: number;
    actuals: number;
    variance: number;
  };
  selectionFullBudget?: number;
  selectionAverages?: TrackingSelectionAverages;
  rollover?: TrackingRolloverMetrics | null;
  monthValues?: TrackingSelectedMonthValues;
  trendLabel: string;
  trend: BudgetTrendPoint[];
  stagedImpact: RelevantStagedImpact | null;
};

export type EnvelopeDetailsMetrics = {
  scope: DetailsScope;
  entity: DetailsEntity;
  kind: DetailsKind;
  title: string;
  subtitle: string;
  rangeLabel: string;
  coverageLabel: string;
  futureOnly: boolean;
  isIncome: boolean;
  primary: {
    label: string;
    value: number | null;
    helper: string;
    tone: DetailsTone;
  };
  endPlan: {
    label: string;
    value: number;
    helper: string;
    tone: DetailsTone;
  } | null;
  periodValues?: {
    assignedBudgeted: number;
    spentToDate: number;
    incomeReceivedToDate: number;
    forNextMonth: number | null;
  };
  selectionActivity?: {
    assignedBudgeted: number;
    spentToDate: number;
    netAssignedSpent: number;
    carryover: boolean | null;
    spentLabel: string;
  };
  monthValues?: EnvelopeSelectedMonthValues;
  trendLabel: string;
  trend: BudgetTrendPoint[];
  stagedImpact: RelevantStagedImpact | null;
};

type TrackingMonthValues = {
  incomeBudgeted: number;
  incomeActuals: number;
  expenseBudgeted: number;
  expenseActuals: number;
};

type SelectedMonthValues = {
  budgeted: number;
  actuals: number;
  balance: number;
  carryover: boolean | null;
};

function absAmount(value: number): number {
  return Math.abs(value);
}

function toneForSigned(value: number): DetailsTone {
  if (value > 0) return "positive";
  if (value < 0) return "negative";
  return "neutral";
}

function toneForEnvelopeToBudget(value: number): DetailsTone {
  if (value >= 0) return "positive";
  if (value < 0) return "negative";
  return "neutral";
}

function selectionKind(selection: BudgetDetailsSelection): DetailsKind {
  return selection.entity === "none" ? "period" : selection.entity;
}

function selectedEntityId(selection: BudgetDetailsSelection): string | null {
  if (selection.entity === "group") return selection.groupId;
  if (selection.entity === "category") return selection.categoryId;
  return null;
}

function monthStatusLabel(status: MonthActualStatus): string {
  if (status === "past") return "Actualized month";
  if (status === "current-partial") return "Current partial month";
  return "Plan-only month";
}

function findMonthEntry(
  model: BudgetDetailsModel,
  month: string
): BudgetDetailsMonth | null {
  return model.months.find((entry) => entry.month === month) ?? null;
}

function previousMonthEntry(
  model: BudgetDetailsModel,
  month: string
): BudgetDetailsMonth | null {
  return findMonthEntry(model, prevMonth(month));
}

function stateEntries(model: BudgetDetailsModel): BudgetDetailsMonth[] {
  return model.months.filter((entry) => entry.state);
}

function actualLikeEntries(model: BudgetDetailsModel): BudgetDetailsMonth[] {
  return model.months.filter(
    (entry) => entry.state && isActualLikeStatus(entry.status)
  );
}

function latestActualEntry(model: BudgetDetailsModel): BudgetDetailsMonth | null {
  const entries = actualLikeEntries(model);
  return entries[entries.length - 1] ?? null;
}

function lastVisibleEntry(model: BudgetDetailsModel): BudgetDetailsMonth | null {
  const entries = stateEntries(model);
  return entries[entries.length - 1] ?? null;
}

function visibleMonthSet(model: BudgetDetailsModel): Set<string> {
  return new Set(model.displayMonths);
}

function collectGroupCategoryIds(
  model: BudgetDetailsModel,
  groupId: string
): string[] {
  const ids = new Set<string>();
  for (const entry of stateEntries(model)) {
    const group = entry.state?.groupsById[groupId];
    if (!group) continue;
    for (const catId of group.categoryIds) ids.add(catId);
  }
  return [...ids];
}

function findTarget(model: BudgetDetailsModel): TargetInfo | null {
  const selection = model.selection;
  if (selection.entity === "none") return null;
  const entityId = selectedEntityId(selection);
  if (!entityId) return null;

  for (const entry of stateEntries(model)) {
    const state = entry.state;
    if (!state) continue;

    if (selection.entity === "group") {
      const group = state.groupsById[entityId];
      if (!group) continue;
      return {
        id: group.id,
        title: group.name,
        subtitle: `${group.isIncome ? "Income group" : "Expense group"}`,
        isIncome: group.isIncome,
        categoryIds: collectGroupCategoryIds(model, group.id),
      };
    }

    const category = state.categoriesById[entityId];
    if (!category) continue;
    return {
      id: category.id,
      title: category.name,
      subtitle: category.groupName,
      isIncome: category.isIncome,
      groupId: category.groupId,
      categoryIds: [category.id],
    };
  }

  return null;
}

function getVisibleTrackingCategories(state: LoadedMonthState): LoadedCategory[] {
  const result: LoadedCategory[] = [];
  for (const groupId of state.groupOrder) {
    const group = state.groupsById[groupId];
    if (!group || group.hidden) continue;
    for (const catId of group.categoryIds) {
      const category = state.categoriesById[catId];
      if (!category || category.hidden) continue;
      result.push(category);
    }
  }
  return result;
}

function getTrackingPeriodValues(state: LoadedMonthState): TrackingMonthValues {
  const values: TrackingMonthValues = {
    incomeBudgeted: 0,
    incomeActuals: 0,
    expenseBudgeted: 0,
    expenseActuals: 0,
  };

  for (const category of getVisibleTrackingCategories(state)) {
    if (category.isIncome) {
      values.incomeBudgeted += category.budgeted;
      values.incomeActuals += category.actuals;
    } else {
      values.expenseBudgeted += absAmount(category.budgeted);
      values.expenseActuals += absAmount(category.actuals);
    }
  }

  return values;
}

function getTrackingTargetValues(
  state: LoadedMonthState,
  target: TargetInfo
): SelectedMonthValues | null {
  let budgeted = 0;
  let actuals = 0;
  let balance = 0;
  let hasCarryover = false;
  let found = false;

  if (target.categoryIds.length === 1 && target.groupId) {
    const category = state.categoriesById[target.id];
    if (!category) return null;
    return {
      budgeted: target.isIncome ? category.budgeted : absAmount(category.budgeted),
      actuals: target.isIncome ? category.actuals : absAmount(category.actuals),
      balance: category.balance,
      carryover: category.carryover,
    };
  }

  for (const catId of target.categoryIds) {
    const category = state.categoriesById[catId];
    if (!category || category.hidden) continue;
    found = true;
    budgeted += target.isIncome ? category.budgeted : absAmount(category.budgeted);
    actuals += target.isIncome ? category.actuals : absAmount(category.actuals);
    balance += category.balance;
    hasCarryover ||= category.carryover;
  }

  return found
    ? { budgeted, actuals, balance, carryover: hasCarryover ? true : null }
    : null;
}

function getEnvelopeTargetValues(
  state: LoadedMonthState,
  target: TargetInfo
): SelectedMonthValues | null {
  if (target.categoryIds.length === 1 && target.groupId) {
    const category = state.categoriesById[target.id];
    if (!category) return null;
    return {
      budgeted: absAmount(category.budgeted),
      actuals: absAmount(category.actuals),
      balance: category.balance,
      carryover: category.carryover,
    };
  }

  const group = state.groupsById[target.id];
  if (!group) return null;
  return {
    budgeted: absAmount(group.budgeted),
    actuals: absAmount(group.actuals),
    balance: group.balance,
    carryover: null,
  };
}

function relevantStagedImpact(
  model: BudgetDetailsModel,
  target: TargetInfo | null
): RelevantStagedImpact | null {
  const months =
    model.selection.scope === "month"
      ? new Set([model.selection.month])
      : visibleMonthSet(model);
  const categorySet =
    target == null ? null : new Set(target.categoryIds.length > 0 ? target.categoryIds : [target.id]);
  let count = 0;
  let budgetDelta = 0;

  for (const edit of Object.values(model.edits)) {
    if (!months.has(edit.month)) continue;
    if (categorySet && !categorySet.has(edit.categoryId)) continue;
    count++;
    budgetDelta += edit.nextBudgeted - edit.previousBudgeted;
  }

  if (count === 0) return null;
  return {
    count,
    budgetDelta,
    estimatedToBudgetImpact: -budgetDelta,
  };
}

function exactCategoryMonthEdit(
  model: BudgetDetailsModel,
  month: string,
  categoryId: string
): MonthEditDetails | null {
  const key: BudgetCellKey = `${month}:${categoryId}`;
  const edit = model.edits[key];
  if (!edit) return null;
  return {
    was: edit.previousBudgeted,
    diff: edit.nextBudgeted - edit.previousBudgeted,
  };
}

function trackingVarianceLabel(isIncome: boolean, variance: number): string {
  if (variance === 0) return "On plan";
  if (isIncome) return variance > 0 ? "Ahead of plan by" : "Under plan by";
  return variance > 0 ? "Under plan by" : "Over plan by";
}

function simpleTrackingCategoryVariance(category: LoadedCategory): number {
  if (category.isIncome) return category.actuals - category.budgeted;
  return absAmount(category.budgeted) - absAmount(category.actuals);
}

function hasMeaningfulTrackingCategoryRollover(
  category: LoadedCategory
): boolean {
  if (category.carryover) return true;
  if (category.isIncome) return false;
  return category.balance !== simpleTrackingCategoryVariance(category);
}

function hasMeaningfulTrackingRollover(
  model: BudgetDetailsModel,
  target: TargetInfo
): boolean {
  if (target.isIncome) return false;

  for (const entry of stateEntries(model)) {
    const state = entry.state;
    if (!state) continue;

    for (const catId of target.categoryIds) {
      const category = state.categoriesById[catId];
      if (!category || category.hidden) continue;
      if (hasMeaningfulTrackingCategoryRollover(category)) return true;
    }
  }

  return false;
}

function rolloverBalanceLine(
  entry: BudgetDetailsMonth,
  target: TargetInfo,
  label: string
): RolloverBalanceLine | null {
  const values = entry.state ? getTrackingTargetValues(entry.state, target) : null;
  if (!values) return null;
  return {
    label,
    value: values.balance,
    helper: formatMonthLabel(entry.month, "long"),
    tone: toneForSigned(values.balance),
  };
}

function buildTrackingRolloverMetrics(
  model: BudgetDetailsModel,
  target: TargetInfo
): TrackingRolloverMetrics | null {
  if (!hasMeaningfulTrackingRollover(model, target)) return null;

  const latestActual = latestActualEntry(model);
  const lastVisible = lastVisibleEntry(model);
  if (model.coverage.isFutureOnly) {
    const planned = lastVisible
      ? rolloverBalanceLine(lastVisible, target, "Planned Rollover Balance")
      : null;
    return planned ? { current: planned, endPlan: null } : null;
  }

  const currentLabel = model.coverage.hasFuture
    ? "Current Rollover Balance"
    : "Ending Rollover Balance";
  const current = latestActual
    ? rolloverBalanceLine(latestActual, target, currentLabel)
    : null;
  const endPlan =
    model.coverage.hasFuture && lastVisible
      ? rolloverBalanceLine(lastVisible, target, "Planned Rollover Balance")
      : null;

  return current || endPlan ? { current, endPlan } : null;
}

function trackingMonthRolloverLine(
  model: BudgetDetailsModel,
  target: TargetInfo,
  entry: BudgetDetailsMonth,
  values: SelectedMonthValues
): RolloverBalanceLine | null {
  if (!hasMeaningfulTrackingRollover(model, target)) return null;
  const futureOnly = entry.status === "future";
  return {
    label: futureOnly ? "Planned Rollover Balance" : "Rollover Balance",
    value: values.balance,
    helper: formatMonthLabel(entry.month, "long"),
    tone: toneForSigned(values.balance),
  };
}

function buildTrackingMonthMetrics(
  model: BudgetDetailsModel
): TrackingDetailsMetrics {
  const target = findTarget(model);
  const selection = model.selection;
  const selectedMonth = selection.scope === "month" ? selection.month : null;
  const entry = selectedMonth ? findMonthEntry(model, selectedMonth) : null;

  if (!target || !selectedMonth || !entry?.state) {
    return missingSelectionMetrics(model);
  }

  const values = getTrackingTargetValues(entry.state, target);
  if (!values) return missingSelectionMetrics(model);

  const previousEntry = previousMonthEntry(model, selectedMonth);
  const previousValues = previousEntry?.state
    ? getTrackingTargetValues(previousEntry.state, target)
    : null;
  const futureOnly = entry.status === "future";
  const variance = target.isIncome
    ? values.actuals - values.budgeted
    : values.budgeted - values.actuals;
  const exactEdit =
    selection.entity === "category"
      ? exactCategoryMonthEdit(model, selectedMonth, selection.categoryId)
      : null;

  return {
    scope: "month",
    entity: selection.entity,
    kind: selectionKind(selection),
    title: target.title,
    subtitle: `${target.subtitle} - Tracking`,
    rangeLabel: formatMonthLabel(selectedMonth, "long"),
    coverageLabel: monthStatusLabel(entry.status),
    futureOnly,
    isIncome: target.isIncome,
    primary: futureOnly
      ? {
          label: "Planned month budget",
          value: values.budgeted,
          helper: "Plan-only month.",
          tone: "neutral",
        }
      : {
          label: trackingVarianceLabel(target.isIncome, variance),
          value: Math.abs(variance),
          helper: "Selected month actuals compared with budget.",
          tone: toneForSigned(variance),
        },
    monthValues: {
      budgetLabel: target.isIncome ? "Budgeted income" : "Budgeted",
      actualLabel: target.isIncome ? "Received income" : "Actuals",
      budgeted: values.budgeted,
      actuals: futureOnly ? null : values.actuals,
      variance: futureOnly ? null : variance,
      rolloverBalance: trackingMonthRolloverLine(model, target, entry, values),
      previousBudgeted: previousValues?.budgeted ?? null,
      stagedEdit: exactEdit,
    },
    trendLabel: "Monthly Variance",
    trend: [],
    stagedImpact: relevantStagedImpact(model, target),
  };
}

function missingSelectionMetrics(
  model: BudgetDetailsModel
): TrackingDetailsMetrics {
  return {
    scope: model.selection.scope,
    entity: model.selection.entity,
    kind: selectionKind(model.selection),
    title: "Selection not found",
    subtitle: "No data in the visible period",
    rangeLabel: model.rangeLabel,
    coverageLabel: model.coverage.label,
    futureOnly: model.coverage.isFutureOnly,
    isIncome: false,
    primary: {
      label: "No data available",
      value: null,
      helper: "Use the month navigator to find a period with this row.",
      tone: "neutral",
    },
    trendLabel: "Monthly Variance",
    trend: [],
    stagedImpact: null,
  };
}

export function buildTrackingDetailsMetrics(
  model: BudgetDetailsModel
): TrackingDetailsMetrics {
  if (model.selection.scope === "month") {
    return buildTrackingMonthMetrics(model);
  }

  if (model.selection.entity !== "none") {
    const target = findTarget(model);
    if (!target) return missingSelectionMetrics(model);

    let budgetToDate = 0;
    let actualToDate = 0;
    let fullBudget = 0;
    let actualLikeMonthCount = 0;
    let fullBudgetMonthCount = 0;
    const trend: BudgetTrendPoint[] = [];

    for (const entry of model.months) {
      const state = entry.state;
      const values = state ? getTrackingTargetValues(state, target) : null;
      if (values) {
        fullBudget += values.budgeted;
        fullBudgetMonthCount++;
        if (isActualLikeStatus(entry.status)) {
          budgetToDate += values.budgeted;
          actualToDate += values.actuals;
          actualLikeMonthCount++;
        }
      }

      const variance =
        values == null
          ? null
          : target.isIncome
          ? values.actuals - values.budgeted
          : values.budgeted - values.actuals;
      trend.push({
        month: entry.month,
        label: formatMonthLabel(entry.month),
        value: entry.status === "future" ? values?.budgeted ?? null : variance,
        status: entry.status,
        planOnly: entry.status === "future",
      });
    }

    const variance = target.isIncome
      ? actualToDate - budgetToDate
      : budgetToDate - actualToDate;
    const hasActualLikeMonths = actualLikeMonthCount > 0;
    const budgetAverageDivisor = hasActualLikeMonths
      ? actualLikeMonthCount
      : fullBudgetMonthCount;
    const futureOnly = model.coverage.isFutureOnly;
    const label = target.isIncome
      ? variance >= 0
        ? "Ahead of plan by"
        : "Under plan by"
      : variance >= 0
      ? "Under plan by"
      : "Over plan by";

    return {
      scope: model.selection.scope,
      entity: model.selection.entity,
      kind: selectionKind(model.selection),
      title: target.title,
      subtitle: `${target.subtitle} - Tracking`,
      rangeLabel: model.rangeLabel,
      coverageLabel: model.coverage.label,
      futureOnly,
      isIncome: target.isIncome,
      primary: futureOnly
        ? {
            label: "No actualized months in this view",
            value: null,
            helper: "Future months are shown as plan-only.",
            tone: "neutral",
          }
        : {
            label,
            value: Math.abs(variance),
            helper: "Actuals to date compared with budget to date.",
            tone: target.isIncome ? toneForSigned(variance) : toneForSigned(variance),
          },
      selectionToDate: {
        budgetLabel: target.isIncome ? "Budgeted income to date" : "Budget to date",
        actualLabel: target.isIncome ? "Received income to date" : "Actuals to date",
        budgeted: budgetToDate,
        actuals: actualToDate,
        variance,
      },
      selectionFullBudget: fullBudget,
      selectionAverages:
        budgetAverageDivisor > 0
          ? {
              budgetLabel: target.isIncome
                ? "Budgeted income / month"
                : "Budget / month",
              actualLabel: target.isIncome
                ? "Received income / month"
                : "Actual / month",
              budgetPerMonth: Math.round(
                (hasActualLikeMonths ? budgetToDate : fullBudget) /
                  budgetAverageDivisor
              ),
              actualPerMonth: hasActualLikeMonths
                ? Math.round(actualToDate / actualLikeMonthCount)
                : null,
              variancePerMonth: hasActualLikeMonths
                ? Math.round(variance / actualLikeMonthCount)
                : null,
            }
          : undefined,
      rollover: buildTrackingRolloverMetrics(model, target),
      trendLabel: "Monthly Variance",
      trend,
      stagedImpact: relevantStagedImpact(model, target),
    };
  }

  let incomeActuals = 0;
  let expenseActuals = 0;
  let incomeBudgetToDate = 0;
  let expenseBudgetToDate = 0;
  let fullIncomeBudget = 0;
  let fullExpenseBudget = 0;
  const trend: BudgetTrendPoint[] = [];

  for (const entry of model.months) {
    const state = entry.state;
    const values = state ? getTrackingPeriodValues(state) : null;
    if (values) {
      fullIncomeBudget += values.incomeBudgeted;
      fullExpenseBudget += values.expenseBudgeted;
      if (isActualLikeStatus(entry.status)) {
        incomeActuals += values.incomeActuals;
        expenseActuals += values.expenseActuals;
        incomeBudgetToDate += values.incomeBudgeted;
        expenseBudgetToDate += values.expenseBudgeted;
      }
    }

    const actualResult =
      values == null ? null : values.incomeActuals - values.expenseActuals;
    const plannedResult =
      values == null ? null : values.incomeBudgeted - values.expenseBudgeted;
    trend.push({
      month: entry.month,
      label: formatMonthLabel(entry.month),
      value: entry.status === "future" ? plannedResult : actualResult,
      status: entry.status,
      planOnly: entry.status === "future",
    });
  }

  const actualResult = incomeActuals - expenseActuals;
  const plannedToDate = incomeBudgetToDate - expenseBudgetToDate;
  const planVariance = actualResult - plannedToDate;
  const plannedResult = fullIncomeBudget - fullExpenseBudget;

  return {
    scope: "period",
    entity: "none",
    kind: "period",
    title: "PERIOD SUMMARY",
    subtitle: `Tracking - ${model.displayMonths.length} months`,
    rangeLabel: model.rangeLabel,
    coverageLabel: model.coverage.label,
    futureOnly: model.coverage.isFutureOnly,
    isIncome: false,
    primary: model.coverage.isFutureOnly
      ? {
          label: "No actualized months in this view",
          value: null,
          helper: "Future months are shown as plan-only.",
          tone: "neutral",
        }
      : {
          label: "Actual Result So Far",
          value: actualResult,
          helper: actualResult >= 0 ? "saved" : "overspent",
          tone: toneForSigned(actualResult),
        },
    periodActuals: {
      incomeReceived: incomeActuals,
      expensesSpent: expenseActuals,
      result: actualResult,
    },
    periodBudgetToDate: {
      incomeBudgeted: incomeBudgetToDate,
      expensesBudgeted: expenseBudgetToDate,
      planVariance,
    },
    periodFullPlan: {
      incomeBudgeted: fullIncomeBudget,
      expensesBudgeted: fullExpenseBudget,
      plannedResult,
    },
    trendLabel: "Monthly Result",
    trend,
    stagedImpact: relevantStagedImpact(model, null),
  };
}

function envelopePrimaryLabel(model: BudgetDetailsModel, balanceLabel: string): string {
  if (model.coverage.hasFuture || model.coverage.currentCount > 0) {
    return `Current ${balanceLabel}`;
  }
  return `Ending ${balanceLabel}`;
}

function envelopeToBudgetHelper(value: number, month: string): string {
  const suffix = value < 0 ? "overbudgeted" : value === 0 ? "fully budgeted" : "to budget";
  return `${formatMonthLabel(month, "long")} - ${suffix}`;
}

function balanceHelper(month: string): string {
  return formatMonthLabel(month, "long");
}

function envelopeBalanceHelper(value: number, month: string): string {
  if (value < 0) return `${formatMonthLabel(month, "long")} - overbudgeted`;
  return formatMonthLabel(month, "long");
}

function buildEnvelopeMonthMetrics(
  model: BudgetDetailsModel
): EnvelopeDetailsMetrics {
  const target = findTarget(model);
  const selection = model.selection;
  const selectedMonth = selection.scope === "month" ? selection.month : null;
  const entry = selectedMonth ? findMonthEntry(model, selectedMonth) : null;

  if (!target || !selectedMonth || !entry?.state) {
    return missingEnvelopeMetrics(model);
  }

  const values = getEnvelopeTargetValues(entry.state, target);
  if (!values) return missingEnvelopeMetrics(model);

  const previousEntry = previousMonthEntry(model, selectedMonth);
  const previousValues = previousEntry?.state
    ? getEnvelopeTargetValues(previousEntry.state, target)
    : null;
  const exactEdit =
    selection.entity === "category"
      ? exactCategoryMonthEdit(model, selectedMonth, selection.categoryId)
      : null;

  return {
    scope: "month",
    entity: selection.entity,
    kind: selectionKind(selection),
    title: target.title,
    subtitle: `${target.subtitle} - Envelope`,
    rangeLabel: formatMonthLabel(selectedMonth, "long"),
    coverageLabel: monthStatusLabel(entry.status),
    futureOnly: entry.status === "future",
    isIncome: target.isIncome,
    primary: {
      label: entry.status === "future" ? "Planned Balance" : "Current Balance",
      value: values.balance,
      helper: envelopeBalanceHelper(values.balance, selectedMonth),
      tone: toneForSigned(values.balance),
    },
    endPlan: null,
    monthValues: {
      assignedBudgeted: values.budgeted,
      spent: values.actuals,
      balance: values.balance,
      previousBalance: previousValues?.balance ?? null,
      previousLabel: previousValues ? "Previous month balance" : null,
      carryover: selection.entity === "category" ? values.carryover : null,
      stagedEdit: exactEdit,
    },
    trendLabel: "Balance Trend",
    trend: [],
    stagedImpact: relevantStagedImpact(model, target),
  };
}

function missingEnvelopeMetrics(
  model: BudgetDetailsModel
): EnvelopeDetailsMetrics {
  return {
    scope: model.selection.scope,
    entity: model.selection.entity,
    kind: selectionKind(model.selection),
    title: "Selection not found",
    subtitle: "No data in the visible period",
    rangeLabel: model.rangeLabel,
    coverageLabel: model.coverage.label,
    futureOnly: model.coverage.isFutureOnly,
    isIncome: false,
    primary: {
      label: "No data available",
      value: null,
      helper: "Use the month navigator to find a period with this row.",
      tone: "neutral",
    },
    endPlan: null,
    trendLabel: "Balance Trend",
    trend: [],
    stagedImpact: null,
  };
}

export function buildEnvelopeDetailsMetrics(
  model: BudgetDetailsModel
): EnvelopeDetailsMetrics {
  if (model.selection.scope === "month") {
    return buildEnvelopeMonthMetrics(model);
  }

  if (model.selection.entity !== "none") {
    const target = findTarget(model);
    if (!target) return missingEnvelopeMetrics(model);

    let assignedBudgeted = 0;
    let spentToDate = 0;
    const trend: BudgetTrendPoint[] = [];
    let currentValues: SelectedMonthValues | null = null;
    let currentMonth: string | null = null;
    let plannedValues: SelectedMonthValues | null = null;
    let plannedMonth: string | null = null;

    for (const entry of model.months) {
      const state = entry.state;
      const values = state ? getEnvelopeTargetValues(state, target) : null;
      if (values) {
        assignedBudgeted += values.budgeted;
        if (isActualLikeStatus(entry.status)) {
          spentToDate += values.actuals;
          currentValues = values;
          currentMonth = entry.month;
        }
        plannedValues = values;
        plannedMonth = entry.month;
      }
      trend.push({
        month: entry.month,
        label: formatMonthLabel(entry.month),
        value: values?.balance ?? null,
        status: entry.status,
        planOnly: entry.status === "future",
      });
    }

    const futureOnly = model.coverage.isFutureOnly;
    const latest = futureOnly ? plannedValues : currentValues;
    const latestMonth = futureOnly ? plannedMonth : currentMonth;
    const primaryLabel = futureOnly
      ? "Planned Balance"
      : envelopePrimaryLabel(model, "Balance");

    return {
      scope: model.selection.scope,
      entity: model.selection.entity,
      kind: selectionKind(model.selection),
      title: target.title,
      subtitle: `${target.subtitle} - Envelope`,
      rangeLabel: model.rangeLabel,
      coverageLabel: model.coverage.label,
      futureOnly,
      isIncome: target.isIncome,
      primary:
        latest && latestMonth
          ? {
              label: primaryLabel,
              value: latest.balance,
              helper: balanceHelper(latestMonth),
              tone: toneForSigned(latest.balance),
            }
          : {
              label: "No actualized months in this view",
              value: null,
              helper: "Future months are shown as plan-only.",
              tone: "neutral",
            },
      endPlan:
        model.coverage.hasFuture && plannedValues && plannedMonth
          ? {
              label: "Planned Balance",
              value: plannedValues.balance,
              helper: balanceHelper(plannedMonth),
              tone: toneForSigned(plannedValues.balance),
            }
          : null,
      selectionActivity: {
        assignedBudgeted,
        spentToDate,
        netAssignedSpent: assignedBudgeted - spentToDate,
        carryover: target.categoryIds.length === 1 ? latest?.carryover ?? null : null,
        spentLabel: target.isIncome ? "Income received to date" : "Spent to date",
      },
      trendLabel: "Balance Trend",
      trend,
      stagedImpact: relevantStagedImpact(model, target),
    };
  }

  const latestActual = latestActualEntry(model);
  const lastVisible = lastVisibleEntry(model);
  let assignedBudgeted = 0;
  let spentToDate = 0;
  let incomeReceivedToDate = 0;
  const trend: BudgetTrendPoint[] = [];

  for (const entry of model.months) {
    const state = entry.state;
    if (state) {
      assignedBudgeted += absAmount(state.summary.totalBudgeted);
      if (isActualLikeStatus(entry.status)) {
        spentToDate += absAmount(state.summary.totalSpent);
        incomeReceivedToDate += state.summary.totalIncome;
      }
    }
    trend.push({
      month: entry.month,
      label: formatMonthLabel(entry.month),
      value: state?.summary.toBudget ?? null,
      status: entry.status,
      planOnly: entry.status === "future",
    });
  }

  const latestToBudget = latestActual?.state?.summary.toBudget;
  const primaryLabel = latestToBudget === 0
    ? "Fully budgeted"
    : model.coverage.isFutureOnly
    ? "No actualized months in this view"
    : model.coverage.hasFuture || model.coverage.currentCount > 0
    ? "Current To Budget / Overbudget"
    : "Ending To Budget / Overbudget";

  return {
    scope: "period",
    entity: "none",
    kind: "period",
    title: "PERIOD SUMMARY",
    subtitle: `Envelope - ${model.displayMonths.length} months`,
    rangeLabel: model.rangeLabel,
    coverageLabel: model.coverage.label,
    futureOnly: model.coverage.isFutureOnly,
    isIncome: false,
    primary:
      latestActual?.state && !model.coverage.isFutureOnly
        ? {
            label: primaryLabel,
            value: latestActual.state.summary.toBudget,
            helper: envelopeToBudgetHelper(
              latestActual.state.summary.toBudget,
              latestActual.month
            ),
            tone: toneForEnvelopeToBudget(latestActual.state.summary.toBudget),
          }
        : {
            label: primaryLabel,
            value: null,
            helper: "Future months are shown as plan-only.",
            tone: "neutral",
          },
    endPlan:
      model.coverage.hasFuture && lastVisible?.state
        ? {
            label: "Planned To Budget",
            value: lastVisible.state.summary.toBudget,
            helper: envelopeToBudgetHelper(
              lastVisible.state.summary.toBudget,
              lastVisible.month
            ),
            tone: toneForEnvelopeToBudget(lastVisible.state.summary.toBudget),
          }
        : null,
    periodValues: {
      assignedBudgeted,
      spentToDate,
      incomeReceivedToDate,
      forNextMonth: latestActual?.state?.summary.forNextMonth ?? null,
    },
    trendLabel: "To Budget Trend",
    trend,
    stagedImpact: relevantStagedImpact(model, null),
  };
}
