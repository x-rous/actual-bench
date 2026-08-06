import {
  formatMonthLabel,
  monthElapsedFraction,
  prevMonth,
} from "@/lib/budget/monthMath";
import type {
  BudgetCellKey,
  LoadedCategory,
  LoadedMonthState,
} from "../types";
import {
  isActualLikeStatus,
  isClosedMonthStatus,
  type BudgetDetailsModel,
  type BudgetDetailsMonth,
  type BudgetDetailsSelection,
  type MonthActualStatus,
} from "./budgetDetailsModel";
import {
  TRACKING_INCOME_AHEAD_RATIO,
  TRACKING_INCOME_ON_TARGET_RATIO,
} from "./trackingSummary";
import type { BudgetTransactionsDrilldown } from "./budgetTransactionBrowser";

export type DetailsTone = "positive" | "negative" | "neutral";

/**
 * Progress-meter model for the details panel (F-086). The meter visualises the
 * panel's existing hero number, so `filled`/`total`/`remaining` are already
 * computed here alongside every other metric; the panel just renders it.
 *
 * - Envelope expense: `total` = money available (spent + balance, carryover-aware),
 *   `filled` = spent, `remaining` = balance.
 * - Tracking expense: `total` = budgeted (to-date), `filled` = actual (to-date),
 *   `remaining` = variance.
 * - Tracking income: `total` = planned, `filled` = received, `remaining` = to-go.
 */
export type BudgetMeterModel = {
  /** Track denominator, **integer minor units** (>= 0). Zero → nothing to fill. */
  total: number;
  /** Filled amount: spent / actual / received, **integer minor units** (>= 0). */
  filled: number;
  /** Signed leftover: balance / variance / to-go, **integer minor units**. Negative reads as over/ahead. */
  remaining: number;
  /** e.g. "Spent" / "Received". */
  filledLabel: string;
  /** e.g. "Available" / "Budgeted to date" / "Planned". */
  totalLabel: string;
  /** Word after the remaining amount: "left" / "over" / "under" / "to go" / "ahead". */
  remainingLabel: string;
  /** Which mental model this meter follows — drives the standalone status headline. */
  variant: "envelope" | "expense" | "income";
};

/** Envelope-fill meter: track = available (spent + balance), carryover-aware. */
function envelopeAvailableMeter(
  spent: number,
  balance: number,
  totalLabel = "Available"
): BudgetMeterModel | undefined {
  const available = spent + balance;
  if (available <= 0 && spent <= 0) return undefined;
  return {
    total: Math.max(available, 0),
    filled: Math.max(spent, 0),
    remaining: balance,
    filledLabel: "Spent",
    totalLabel,
    remainingLabel: balance < 0 ? "over" : "left",
    variant: "envelope",
  };
}

/** Whole-budget envelope meter: assigned-vs-spent (no single balance at that level). */
function envelopeAssignedMeter(
  assigned: number,
  spent: number,
  totalLabel = "Assigned"
): BudgetMeterModel | undefined {
  if (assigned <= 0) return undefined;
  const remaining = assigned - spent;
  return {
    total: assigned,
    filled: Math.max(spent, 0),
    remaining,
    filledLabel: "Spent",
    totalLabel,
    remainingLabel: remaining < 0 ? "over" : "left",
    variant: "envelope",
  };
}

/** Tracking plan-progress meter: budgeted-vs-actual (pass to-date values only). */
function trackingExpenseMeter(
  budgeted: number,
  actuals: number,
  totalLabel = "Budgeted"
): BudgetMeterModel | undefined {
  if (budgeted <= 0) return undefined;
  const remaining = budgeted - actuals; // variance
  return {
    total: budgeted,
    filled: Math.max(actuals, 0),
    remaining,
    filledLabel: "Spent",
    totalLabel,
    remainingLabel: remaining < 0 ? "over" : remaining > 0 ? "under" : "on budget",
    variant: "expense",
  };
}

/**
 * Meter for the whole-month summary panel (which bypasses the metric builders).
 * Envelope: envelope-fill from the month's totals; Tracking: plan-progress.
 */
export function buildMonthSummaryMeter(input: {
  isTracking: boolean;
  budgeted: number;
  spent: number;
  balance: number;
}): BudgetMeterModel | undefined {
  return input.isTracking
    ? trackingExpenseMeter(input.budgeted, input.spent, "Budgeted")
    : envelopeAvailableMeter(input.spent, input.balance, "Available");
}

/** Tracking income meter: received-vs-planned. */
function trackingIncomeMeter(
  budgeted: number,
  actuals: number,
  totalLabel = "Planned"
): BudgetMeterModel | undefined {
  if (budgeted <= 0) return undefined;
  const remaining = budgeted - actuals; // to go (negative = ahead)
  return {
    total: budgeted,
    filled: Math.max(actuals, 0),
    remaining,
    filledLabel: "Received",
    totalLabel,
    remainingLabel: remaining < 0 ? "ahead" : remaining > 0 ? "to go" : "on plan",
    variant: "income",
  };
}

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
  transactionDrilldown: BudgetTransactionsDrilldown | null;
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

/**
 * The in-progress month, reported on its own so it never contaminates the
 * closed-months cumulative/averaged figures. "Pace" compares the fraction of
 * the budget used against the fraction of the month elapsed.
 */
export type ThisMonthPaceStatus =
  | "on-pace"
  | "slightly-over-pace"
  | "well-over-pace"
  | "over-budget"
  | "under-pace"
  | "no-budget";

export type ThisMonthMetrics = {
  month: string;
  monthLabel: string;
  dayLabel: string;
  actualLabel: string;
  budgeted: number;
  actuals: number;
  elapsedFraction: number;
  usedFraction: number | null;
  paceStatus: ThisMonthPaceStatus;
  statusLabel: string;
  tone: DetailsTone;
  /** Period-summary "this month" also carries income progress alongside the
   *  expense-spending pace, so the panel can show a secondary income line. */
  income: { budgeted: number; actuals: number } | null;
};

/** One segment per displayed month for the header coverage strip. */
export type DetailsCoverage = {
  segments: MonthActualStatus[];
  closedCount: number;
  currentCount: number;
  futureCount: number;
  totalMonths: number;
};

/** Single-month header progress: a day-of-month bar instead of the strip. */
export type DayProgress = {
  elapsedFraction: number;
  dayLabel: string;
  closed: boolean;
};

export type TrajectoryPoint = {
  month: string;
  /** Cumulative plan up to and including this month. */
  plan: number;
  /** Cumulative actual up to and including this month; null once past today. */
  actual: number | null;
};

/**
 * Where the selection is heading by the end of the visible period. Actuals are
 * banked up to today; the remainder is projected (net result: banked +
 * remaining plan; spend: run-rate from the elapsed fraction of the period).
 */
export type TrajectoryMetrics = {
  label: string;
  projectedValue: number;
  planLabel: string;
  planValue: number;
  variance: number;
  varianceLabel: string;
  /** Tone of the projected headline number. */
  tone: DetailsTone;
  /** Tone that colours the Actual + Projection chart lines. Kept separate from
   *  the verdict chip so the lines never collapse into the muted plan line. */
  lineTone: DetailsTone;
  /** Short verdict chip beside the headline (e.g. "on track" / "below plan"). */
  chipLabel: string;
  chipTone: DetailsTone;
  isSpend: boolean;
  todayIndex: number;
  points: TrajectoryPoint[];
  /** The projected contribution of every not-yet-closed month (this month +
   *  upcoming) at plan. Only set for the result trajectory. */
  breakdown: { openPlan: number; openMonthCount: number } | null;
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

type TrackingPrimaryMetric = {
  label: string;
  value: number | null;
  helper: string;
  tone: DetailsTone;
};

type EnvelopeSelectedMonthValues = {
  assignedBudgeted: number;
  spent: number;
  balance: number;
  transactionDrilldown: BudgetTransactionsDrilldown | null;
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
    expenseVariance: number;
    netPlanVariance: number;
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
  /** The current in-progress month, kept separate from closed-months figures. */
  thisMonth?: ThisMonthMetrics | null;
  /** Count of fully-closed months backing the cumulative/averaged figures. */
  closedMonthCount?: number;
  /** Per-month coverage for the header strip (period views). */
  coverage?: DetailsCoverage;
  /** Day-of-month progress for single-month views. */
  dayProgress?: DayProgress | null;
  /** End-of-period projection for period views. */
  trajectory?: TrajectoryMetrics | null;
  rollover?: TrackingRolloverMetrics | null;
  monthValues?: TrackingSelectedMonthValues;
  meter?: BudgetMeterModel;
  trendLabel: string;
  trend: BudgetTrendPoint[];
  spendingVsBudgetedTrend?: BudgetTrendPoint[];
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
  /** Per-month coverage strip (period views) — parity with tracking. */
  coverage?: DetailsCoverage;
  /** Day-of-month progress (single-month views). */
  dayProgress?: DayProgress | null;
  /** In-progress month pace verdict, for the current-month meter chip. */
  thisMonth?: ThisMonthMetrics | null;
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
  meter?: BudgetMeterModel;
  trendLabel: string;
  trend: BudgetTrendPoint[];
  stagedImpact: RelevantStagedImpact | null;
};

type TrackingMonthValues = {
  incomeBudgeted: number;
  incomeActuals: number;
  expenseBudgeted: number;
  expenseActuals: number;
  expenseVariance: number;
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

function getVisibleTrackingIncomeBudgeted(state: LoadedMonthState): number {
  let total = 0;
  for (const groupId of state.groupOrder) {
    const group = state.groupsById[groupId];
    if (!group || group.hidden || !group.isIncome) continue;
    total += group.budgeted;
  }
  return total;
}

function getTrackingPeriodValues(state: LoadedMonthState): TrackingMonthValues {
  return {
    incomeBudgeted: getVisibleTrackingIncomeBudgeted(state),
    incomeActuals: state.summary.totalIncome,
    expenseBudgeted: absAmount(state.summary.totalBudgeted),
    expenseActuals: absAmount(state.summary.totalSpent),
    expenseVariance: state.summary.totalBalance,
  };
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

  if (!target.groupId) {
    const group = state.groupsById[target.id];
    if (!group) return null;
    return {
      budgeted: target.isIncome ? group.budgeted : absAmount(group.budgeted),
      actuals: target.isIncome ? group.actuals : absAmount(group.actuals),
      balance: group.balance,
      carryover: null,
    };
  }

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

function visibleGroupCategoryIds(
  state: LoadedMonthState,
  groupId: string
): string[] {
  const group = state.groupsById[groupId];
  if (!group) return [];
  return group.categoryIds.filter((categoryId) => {
    const category = state.categoriesById[categoryId];
    return !!category && !category.hidden;
  });
}

function budgetTransactionsDrilldown(
  entry: BudgetDetailsMonth,
  target: TargetInfo,
): BudgetTransactionsDrilldown | null {
  if (target.isIncome || !entry.state) return null;

  const categoryIds = target.groupId
    ? [target.id]
    : visibleGroupCategoryIds(entry.state, target.id);
  if (categoryIds.length === 0) return null;

  return {
    id: target.id,
    month: entry.month,
    title: target.title,
    entity: target.groupId ? "category" : "group",
    categoryIds,
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

function expenseBudgetStatusLabel(
  variance: number,
  status: MonthActualStatus | null
): string {
  if (status === "current-partial") {
    if (variance > 0) return "Under so far by";
    if (variance < 0) return "Over so far by";
    return "On track";
  }
  if (status === "past") {
    if (variance > 0) return "Under budget by";
    if (variance < 0) return "Over budget by";
    return "On budget";
  }
  if (variance > 0) return "Under budget to date by";
  if (variance < 0) return "Over budget to date by";
  return "On budget to date";
}

function expenseBudgetStatusTone(
  variance: number,
  status: MonthActualStatus | null
): DetailsTone {
  if (variance < 0) return "negative";
  if (status === "current-partial") return "neutral";
  return variance > 0 ? "positive" : "neutral";
}

function trackingExpensePrimaryMetric({
  variance,
  status,
}: {
  variance: number;
  status: MonthActualStatus | null;
}): TrackingPrimaryMetric {
  return {
    label: expenseBudgetStatusLabel(variance, status),
    value: Math.abs(variance),
    helper:
      status === null
        ? "Spending to date compared with budgeted expenses to date."
        : "Selected month spending compared with budgeted expenses.",
    tone: expenseBudgetStatusTone(variance, status),
  };
}

function incomeTargetStatusLabel(
  variant: "short" | "ahead" | "target",
  status: MonthActualStatus | null
): string {
  if (status === "current-partial") {
    if (variant === "short") return "Short so far by";
    if (variant === "ahead") return "Ahead so far by";
    return "On target so far";
  }
  if (status === "past") {
    if (variant === "short") return "Short by";
    if (variant === "ahead") return "Ahead by";
    return "On target";
  }
  if (variant === "short") return "Short to date by";
  if (variant === "ahead") return "Ahead to date by";
  return "On target to date";
}

function incomeNoBudgetMetric({
  actuals,
  status,
}: {
  actuals: number;
  status: MonthActualStatus | null;
}): TrackingPrimaryMetric {
  if (actuals <= 0) {
    return {
      label: "No income budget",
      value: null,
      helper: "No income budget is set for this selection.",
      tone: "neutral",
    };
  }

  const label =
    status === "current-partial"
      ? "Received so far"
      : status === "past"
        ? "Received"
        : "Received to date";
  return {
    label,
    value: actuals,
    helper: "No income budget is set for this selection.",
    tone: "neutral",
  };
}

function trackingIncomePrimaryMetric({
  budgeted,
  actuals,
  variance,
  status,
}: {
  budgeted: number;
  actuals: number;
  variance: number;
  status: MonthActualStatus | null;
}): TrackingPrimaryMetric {
  if (budgeted <= 0) return incomeNoBudgetMetric({ actuals, status });

  const ratio = actuals / budgeted;
  const isShort = ratio < TRACKING_INCOME_ON_TARGET_RATIO;
  const isAhead = ratio >= TRACKING_INCOME_AHEAD_RATIO;

  if (!isShort && !isAhead) {
    return {
      label: incomeTargetStatusLabel("target", status),
      value: null,
      helper: "Received income is within the on-target range.",
      tone: "neutral",
    };
  }

  return {
    label: incomeTargetStatusLabel(isAhead ? "ahead" : "short", status),
    value: Math.abs(variance),
    helper:
      status === null
        ? "Income received to date compared with budgeted income to date."
        : "Selected month income received compared with budgeted income.",
    tone: status === "current-partial" ? "neutral" : toneForSigned(variance),
  };
}

function hasMeaningfulTrackingCategoryRollover(
  category: LoadedCategory
): boolean {
  return category.carryover === true;
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
  model: BudgetDetailsModel,
  now: Date = new Date()
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
  const thisMonth =
    entry.status === "current-partial"
      ? computeThisMonthMetrics({
          month: selectedMonth,
          budgeted: values.budgeted,
          actuals: values.actuals,
          isIncome: target.isIncome,
          now,
        })
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
    subtitle: `${target.subtitle} - Tracking`,
    rangeLabel: formatMonthLabel(selectedMonth, "long"),
    coverageLabel: monthStatusLabel(entry.status),
    dayProgress: buildDayProgress(selectedMonth, entry.status, now),
    thisMonth,
    futureOnly,
    isIncome: target.isIncome,
    primary: futureOnly
      ? {
          label: "Budgeted",
          value: values.budgeted,
          helper: "Plan-only month.",
          tone: "neutral",
        }
      : target.isIncome
        ? trackingIncomePrimaryMetric({
            budgeted: values.budgeted,
            actuals: values.actuals,
            variance,
            status: entry.status,
          })
        : trackingExpensePrimaryMetric({ variance, status: entry.status }),
    monthValues: {
      budgetLabel: target.isIncome ? "Budgeted income" : "Budgeted",
      actualLabel: target.isIncome ? "Received income" : "Spent",
      budgeted: values.budgeted,
      actuals: futureOnly ? null : values.actuals,
      variance: futureOnly ? null : variance,
      transactionDrilldown:
        futureOnly ? null : budgetTransactionsDrilldown(entry, target),
      rolloverBalance: trackingMonthRolloverLine(model, target, entry, values),
      previousBudgeted: previousValues?.budgeted ?? null,
      stagedEdit: exactEdit,
    },
    meter: futureOnly
      ? undefined
      : target.isIncome
      ? trackingIncomeMeter(values.budgeted, values.actuals)
      : trackingExpenseMeter(values.budgeted, values.actuals),
    trendLabel: "Monthly Spending vs. Budgeted",
    trend: [],
    stagedImpact: relevantStagedImpact(model, target),
  };
}

/** Spending/receipts may run this far from the elapsed fraction and still
 *  count as "on pace" — avoids flapping around the exact linear line. */
const PACE_TOLERANCE = 0.1;

/** A projection within this fraction of the plan reads as "on track"; beyond
 *  it, "below plan" / "ahead of plan". A sensible default until/unless a
 *  per-budget tolerance is configured. */
const TRAJECTORY_PLAN_TOLERANCE = 0.02;

function dayOfMonthLabel(month: string, now: Date): string {
  const [year, mo] = month.split("-").map((n) => Number.parseInt(n, 10));
  const daysInMonth = new Date(year, mo, 0).getDate();
  const isCurrent = now.getFullYear() === year && now.getMonth() + 1 === mo;
  const day = isCurrent ? Math.min(now.getDate(), daysInMonth) : daysInMonth;
  return `day ${day} of ${daysInMonth}`;
}

export function computeThisMonthMetrics(input: {
  month: string;
  budgeted: number;
  actuals: number;
  isIncome: boolean;
  now?: Date;
  income?: { budgeted: number; actuals: number } | null;
}): ThisMonthMetrics {
  const { month, budgeted, actuals, isIncome } = input;
  const now = input.now ?? new Date();
  const elapsedFraction = monthElapsedFraction(month, now);
  const usedFraction = budgeted > 0 ? actuals / budgeted : null;

  let paceStatus: ThisMonthPaceStatus;
  let statusLabel: string;
  let tone: DetailsTone;

  if (usedFraction == null) {
    paceStatus = "no-budget";
    statusLabel = "no budget set";
    tone = "neutral";
  } else if (isIncome) {
    // Income arrives lumpily (often end of month), so we report progress
    // without penalising a slow start.
    if (usedFraction >= 1) {
      paceStatus = "on-pace";
      statusLabel = "fully received";
      tone = "positive";
    } else if (usedFraction - elapsedFraction >= PACE_TOLERANCE) {
      paceStatus = "under-pace";
      statusLabel = "ahead of pace";
      tone = "positive";
    } else {
      paceStatus = "on-pace";
      statusLabel = "arriving";
      tone = "neutral";
    }
  } else if (usedFraction >= 1) {
    paceStatus = "over-budget";
    statusLabel = "over budget";
    tone = "negative";
  } else {
    const delta = usedFraction - elapsedFraction;
    // Ratio distinguishes "a bit ahead" from "burning far too fast"; the 5%
    // floor stops early-month noise (tiny elapsed) from exploding the ratio.
    const ratio = elapsedFraction > 0.05 ? usedFraction / elapsedFraction : 1;
    if (delta > PACE_TOLERANCE && ratio >= 1.6) {
      paceStatus = "well-over-pace";
      statusLabel = "well over pace";
      tone = "negative";
    } else if (delta > PACE_TOLERANCE) {
      paceStatus = "slightly-over-pace";
      statusLabel = "slightly over pace";
      tone = "negative";
    } else if (delta < -PACE_TOLERANCE) {
      paceStatus = "under-pace";
      statusLabel = "under pace";
      tone = "positive";
    } else {
      paceStatus = "on-pace";
      statusLabel = "on pace";
      tone = "positive";
    }
  }

  return {
    month,
    monthLabel: formatMonthLabel(month, "long"),
    dayLabel: dayOfMonthLabel(month, now),
    actualLabel: isIncome ? "Received income" : "Spent",
    budgeted,
    actuals,
    elapsedFraction,
    usedFraction,
    paceStatus,
    statusLabel,
    tone,
    income: input.income ?? null,
  };
}

function buildDetailsCoverage(model: BudgetDetailsModel): DetailsCoverage {
  const segments = model.months.map((entry) => entry.status);
  return {
    segments,
    closedCount: segments.filter((s) => s === "past").length,
    currentCount: segments.filter((s) => s === "current-partial").length,
    futureCount: segments.filter((s) => s === "future").length,
    totalMonths: segments.length,
  };
}

export function buildDayProgress(
  month: string,
  status: MonthActualStatus,
  now: Date = new Date()
): DayProgress {
  return {
    elapsedFraction:
      status === "future" ? 0 : status === "past" ? 1 : monthElapsedFraction(month, now),
    dayLabel:
      status === "past"
        ? "closed"
        : status === "future"
        ? "planned"
        : dayOfMonthLabel(month, now),
    closed: status === "past",
  };
}

/**
 * Net-result trajectory for the period summary: actuals are banked up to today,
 * and every month after today contributes its planned result. So the projection
 * answers "if the rest of the year goes to plan, where do we land?".
 */
function buildResultTrajectory(
  model: BudgetDetailsModel
): TrajectoryMetrics | null {
  if (model.months.length === 0 || model.coverage.isFutureOnly) return null;

  const points: TrajectoryPoint[] = [];
  let cumPlan = 0;
  let cumClosedActual = 0;
  let closedPlan = 0;
  let closedCount = 0;
  let lastClosedIndex = -1;

  model.months.forEach((entry, i) => {
    const values = entry.state ? getTrackingPeriodValues(entry.state) : null;
    const planned = values ? values.incomeBudgeted - values.expenseBudgeted : 0;
    const actual = values ? values.incomeActuals - values.expenseActuals : 0;
    cumPlan += planned;
    // Only closed months are banked. The current partial month is projected at
    // plan (not its income-starved partial actuals), so a late paycheck can't
    // drag the year-end projection down.
    if (entry.status === "past") {
      cumClosedActual += actual;
      closedPlan += planned;
      closedCount++;
      lastClosedIndex = i;
    }
    points.push({
      month: entry.month,
      plan: cumPlan,
      actual: entry.status === "past" ? cumClosedActual : null,
    });
  });

  if (lastClosedIndex === -1) return null;

  const openPlan = cumPlan - closedPlan;
  const projectedValue = cumClosedActual + openPlan;
  const planValue = cumPlan;
  const variance = projectedValue - planValue;
  const rel = planValue !== 0 ? variance / Math.abs(planValue) : 0;

  let chipLabel: string;
  let chipTone: DetailsTone;
  if (projectedValue < 0) {
    chipLabel = "shortfall";
    chipTone = "negative";
  } else if (rel < -TRAJECTORY_PLAN_TOLERANCE) {
    chipLabel = "below plan";
    chipTone = "neutral";
  } else if (rel > TRAJECTORY_PLAN_TOLERANCE) {
    chipLabel = "ahead of plan";
    chipTone = "positive";
  } else {
    chipLabel = "on track";
    chipTone = "positive";
  }

  return {
    label: "Projected result",
    projectedValue,
    planLabel: "Full-period plan",
    planValue,
    variance,
    varianceLabel: variance >= 0 ? "above" : "below",
    tone: toneForSigned(projectedValue),
    lineTone: toneForSigned(projectedValue),
    chipLabel,
    chipTone,
    isSpend: false,
    todayIndex: lastClosedIndex,
    points,
    breakdown: {
      openPlan,
      openMonthCount: model.months.length - closedCount,
    },
  };
}

/**
 * Spend trajectory for an expense selection: project the run-rate from the
 * fraction of the whole period that has elapsed, so spending faster than the
 * calendar projects over budget. Income targets have no meaningful run-rate
 * projection (receipts are lumpy), so this returns null for them.
 */
function buildSelectionTrajectory(
  model: BudgetDetailsModel,
  target: TargetInfo,
  now: Date
): TrajectoryMetrics | null {
  if (target.isIncome || model.coverage.isFutureOnly) return null;

  const points: TrajectoryPoint[] = [];
  let cumPlan = 0;
  let cumActual = 0;
  let todayIndex = -1;
  let banked = 0;
  let elapsedMonths = 0;
  let closedCount = 0;

  model.months.forEach((entry, i) => {
    const values = entry.state ? getTrackingTargetValues(entry.state, target) : null;
    const plan = values ? Math.abs(values.budgeted) : 0;
    const actual = values ? Math.abs(values.actuals) : 0;
    cumPlan += plan;
    if (isActualLikeStatus(entry.status)) {
      cumActual += actual;
      todayIndex = i;
      banked = cumActual;
      if (entry.status === "past") {
        elapsedMonths += 1;
        closedCount++;
      } else {
        elapsedMonths += monthElapsedFraction(entry.month, now);
      }
    }
    points.push({
      month: entry.month,
      plan: cumPlan,
      actual: isActualLikeStatus(entry.status) ? cumActual : null,
    });
  });

  // Run-rate needs a closed month to be stable — projecting from a sliver of
  // the current month alone produces wild numbers.
  if (todayIndex === -1 || closedCount === 0) return null;

  const periodElapsed =
    model.months.length > 0 ? elapsedMonths / model.months.length : 0;
  const projectedValue =
    periodElapsed > 0 ? Math.round(banked / periodElapsed) : banked;
  const planValue = cumPlan;
  const variance = projectedValue - planValue;
  const rel = planValue !== 0 ? variance / Math.abs(planValue) : 0;
  const atRisk = rel > TRAJECTORY_PLAN_TOLERANCE;
  const chipTone: DetailsTone = atRisk ? "negative" : "positive";

  return {
    label: "Projected spend",
    projectedValue,
    planLabel: "Full-period budget",
    planValue,
    variance,
    varianceLabel: variance > 0 ? "over" : "under",
    tone: "neutral",
    lineTone: chipTone,
    chipLabel: atRisk ? "at risk" : "on track",
    chipTone,
    isSpend: true,
    todayIndex,
    points,
    breakdown: null,
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
    trendLabel: "Monthly Spending vs. Budgeted",
    trend: [],
    stagedImpact: null,
  };
}

export function buildTrackingDetailsMetrics(
  model: BudgetDetailsModel,
  now: Date = new Date()
): TrackingDetailsMetrics {
  if (model.selection.scope === "month") {
    return buildTrackingMonthMetrics(model, now);
  }

  const coverage = buildDetailsCoverage(model);

  if (model.selection.entity !== "none") {
    const target = findTarget(model);
    if (!target) return missingSelectionMetrics(model);

    let budgetToDate = 0;
    let actualToDate = 0;
    let fullBudget = 0;
    let closedMonthCount = 0;
    let currentValues: SelectedMonthValues | null = null;
    let currentMonth: string | null = null;
    const trend: BudgetTrendPoint[] = [];

    for (const entry of model.months) {
      const state = entry.state;
      const values = state ? getTrackingTargetValues(state, target) : null;
      if (values) {
        fullBudget += values.budgeted;
        if (isClosedMonthStatus(entry.status)) {
          budgetToDate += values.budgeted;
          actualToDate += values.actuals;
          closedMonthCount++;
        } else if (entry.status === "current-partial") {
          currentValues = values;
          currentMonth = entry.month;
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
    const hasClosedMonths = closedMonthCount > 0;
    const futureOnly = model.coverage.isFutureOnly;
    const thisMonth =
      currentValues && currentMonth
        ? computeThisMonthMetrics({
            month: currentMonth,
            budgeted: currentValues.budgeted,
            actuals: currentValues.actuals,
            isIncome: target.isIncome,
            now,
          })
        : null;
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
        : !hasClosedMonths
        ? {
            label: "No closed months yet",
            value: null,
            helper: "This month is still in progress — see below.",
            tone: "neutral",
          }
        : {
            ...(target.isIncome
              ? trackingIncomePrimaryMetric({
                  budgeted: budgetToDate,
                  actuals: actualToDate,
                  variance,
                  status: null,
                })
              : trackingExpensePrimaryMetric({ variance, status: null })),
          },
      selectionToDate: hasClosedMonths
        ? {
            budgetLabel: target.isIncome
              ? "Budgeted income"
              : "Budgeted",
            actualLabel: target.isIncome ? "Received income" : "Spent",
            budgeted: budgetToDate,
            actuals: actualToDate,
            variance,
          }
        : undefined,
      selectionFullBudget: fullBudget,
      selectionAverages: hasClosedMonths
        ? {
            budgetLabel: target.isIncome
              ? "Budgeted income / month"
              : "Budgeted / month",
            actualLabel: target.isIncome
              ? "Received income / month"
              : "Spent / month",
            budgetPerMonth: Math.round(budgetToDate / closedMonthCount),
            actualPerMonth: Math.round(actualToDate / closedMonthCount),
            variancePerMonth: Math.round(variance / closedMonthCount),
          }
        : undefined,
      thisMonth,
      closedMonthCount,
      coverage,
      trajectory: buildSelectionTrajectory(model, target, now),
      rollover: buildTrackingRolloverMetrics(model, target),
      meter:
        futureOnly || !hasClosedMonths
          ? undefined
          : target.isIncome
          ? trackingIncomeMeter(budgetToDate, actualToDate, "Planned")
          : trackingExpenseMeter(budgetToDate, actualToDate, "Budgeted"),
      trendLabel: "Monthly Spending vs. Budgeted",
      trend,
      stagedImpact: relevantStagedImpact(model, target),
    };
  }

  let incomeActuals = 0;
  let expenseActuals = 0;
  let incomeBudgetToDate = 0;
  let expenseBudgetToDate = 0;
  let expenseVarianceToDate = 0;
  let fullIncomeBudget = 0;
  let fullExpenseBudget = 0;
  let closedMonthCount = 0;
  let currentPeriodValues: TrackingMonthValues | null = null;
  let currentPeriodMonth: string | null = null;
  const trend: BudgetTrendPoint[] = [];
  const spendingVsBudgetedTrend: BudgetTrendPoint[] = [];

  for (const entry of model.months) {
    const state = entry.state;
    const values = state ? getTrackingPeriodValues(state) : null;
    if (values) {
      fullIncomeBudget += values.incomeBudgeted;
      fullExpenseBudget += values.expenseBudgeted;
      if (isClosedMonthStatus(entry.status)) {
        incomeActuals += values.incomeActuals;
        expenseActuals += values.expenseActuals;
        incomeBudgetToDate += values.incomeBudgeted;
        expenseBudgetToDate += values.expenseBudgeted;
        expenseVarianceToDate += values.expenseVariance;
        closedMonthCount++;
      } else if (entry.status === "current-partial") {
        currentPeriodValues = values;
        currentPeriodMonth = entry.month;
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
    spendingVsBudgetedTrend.push({
      month: entry.month,
      label: formatMonthLabel(entry.month),
      value: entry.status === "future" ? null : (values?.expenseVariance ?? null),
      status: entry.status,
      planOnly: entry.status === "future",
    });
  }

  const actualResult = incomeActuals - expenseActuals;
  const plannedToDate = incomeBudgetToDate - expenseBudgetToDate;
  const expenseVariance = expenseVarianceToDate;
  const netPlanVariance = actualResult - plannedToDate;
  const plannedResult = fullIncomeBudget - fullExpenseBudget;
  const hasClosedMonths = closedMonthCount > 0;
  const periodThisMonth =
    currentPeriodValues && currentPeriodMonth
      ? computeThisMonthMetrics({
          month: currentPeriodMonth,
          budgeted: currentPeriodValues.expenseBudgeted,
          actuals: currentPeriodValues.expenseActuals,
          isIncome: false,
          now,
          income: {
            budgeted: currentPeriodValues.incomeBudgeted,
            actuals: currentPeriodValues.incomeActuals,
          },
        })
      : null;

  return {
    scope: "period",
    entity: "none",
    kind: "period",
    title: "PERIOD SUMMARY",
    subtitle: "Tracking",
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
      : !hasClosedMonths
      ? {
          label: "No closed months yet",
          value: null,
          helper: "This month is still in progress — see below.",
          tone: "neutral",
        }
      : {
          label: "Result",
          value: actualResult,
          helper: actualResult >= 0 ? "saved" : "overspent",
          tone: toneForSigned(actualResult),
        },
    periodActuals: hasClosedMonths
      ? {
          incomeReceived: incomeActuals,
          expensesSpent: expenseActuals,
          result: actualResult,
        }
      : undefined,
    periodBudgetToDate: hasClosedMonths
      ? {
          incomeBudgeted: incomeBudgetToDate,
          expensesBudgeted: expenseBudgetToDate,
          expenseVariance,
          netPlanVariance,
        }
      : undefined,
    periodFullPlan: {
      incomeBudgeted: fullIncomeBudget,
      expensesBudgeted: fullExpenseBudget,
      plannedResult,
    },
    thisMonth: periodThisMonth,
    closedMonthCount,
    coverage,
    trajectory: buildResultTrajectory(model),
    meter:
      model.coverage.isFutureOnly || !hasClosedMonths
        ? undefined
        : trackingExpenseMeter(expenseBudgetToDate, expenseActuals, "Budgeted"),
    trendLabel: "Monthly Result",
    trend,
    spendingVsBudgetedTrend: model.coverage.isFutureOnly ? undefined : spendingVsBudgetedTrend,
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
  model: BudgetDetailsModel,
  now: Date = new Date()
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
    dayProgress: buildDayProgress(selectedMonth, entry.status, now),
    thisMonth:
      entry.status === "current-partial" && !target.isIncome
        ? computeThisMonthMetrics({
            month: selectedMonth,
            budgeted: values.budgeted,
            actuals: values.actuals,
            isIncome: false,
            now,
          })
        : null,
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
      transactionDrilldown: budgetTransactionsDrilldown(entry, target),
      previousBalance: previousValues?.balance ?? null,
      previousLabel: previousValues ? "Previous month balance" : null,
      carryover: selection.entity === "category" ? values.carryover : null,
      stagedEdit: exactEdit,
    },
    meter:
      entry.status === "future" || target.isIncome
        ? undefined
        : envelopeAvailableMeter(values.actuals, values.balance, "Available"),
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
  model: BudgetDetailsModel,
  now: Date = new Date()
): EnvelopeDetailsMetrics {
  if (model.selection.scope === "month") {
    return buildEnvelopeMonthMetrics(model, now);
  }

  const coverage = buildDetailsCoverage(model);

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
      coverage,
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
      meter:
        futureOnly || target.isIncome || !latest
          ? undefined
          : envelopeAvailableMeter(spentToDate, latest.balance, "Available"),
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
    subtitle: "Envelope",
    rangeLabel: model.rangeLabel,
    coverageLabel: model.coverage.label,
    coverage,
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
    meter: model.coverage.isFutureOnly
      ? undefined
      : envelopeAssignedMeter(assignedBudgeted, spentToDate, "Assigned"),
    trendLabel: "To Budget Trend",
    trend,
    stagedImpact: relevantStagedImpact(model, null),
  };
}
