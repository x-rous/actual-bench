"use client";

import { useMemo, useState } from "react";
import { formatMonthLabel } from "@/lib/budget/monthMath";
import { formatSigned } from "../../lib/format";
import {
  buildDayProgress,
  buildMonthSummaryMeter,
  computeThisMonthMetrics,
  type ThisMonthMetrics,
} from "../../lib/budgetDetailsMetrics";
import {
  buildMonthCategoriesDrilldown,
  type BudgetTransactionBrowserOptions,
  type BudgetTransactionsDrilldown,
} from "../../lib/budgetTransactionBrowser";
import { classifyMonthActualStatus } from "../../lib/budgetDetailsModel";
import { buildVarianceTree, type VarianceSide } from "../../lib/varianceDrivers";
import { computeTrackingMonth } from "../../lib/semantics/trackingBudgetSemantics";
import { trackingInputsFromState } from "../../lib/semantics/fromLoadedState";
import {
  buildTrackingMonthView,
  type MonthTimePhase,
} from "../../lib/semantics/trackingMonthView";
import { TopVarianceDriversDialog } from "./TopVarianceDriversDialog";
import type { BudgetMonthSummary, LoadedMonthState } from "../../types";
import {
  DetailsHeader,
  DetailsSection,
  DetailsSkeleton,
  MetricLine,
  PrimaryMetric,
  toneFromValue,
} from "./DetailsPrimitives";
import { MeterSection } from "./BudgetMeter";
import { BudgetNoteSection } from "./BudgetNoteSection";
import { BudgetTransactionsDialog } from "./BudgetTransactionsDialog";
import { useSpendingDetailsShortcut } from "./useSpendingDetailsShortcut";

/**
 * Whole-month overview shown when a month column header is selected (no cell or
 * row picked). Mirrors the period-summary panels but for a single month, read
 * straight from {@link BudgetMonthSummary}, and hosts the editable month note.
 *
 * Rendered as a dedicated path (not through the Envelope/Tracking metric
 * builders), so the existing cell/row/period panels are untouched.
 */
export function BudgetMonthSummaryPanel({
  month,
  state,
  isTracking,
  transactionBrowserOptions,
  statesByMonth,
}: {
  month: string;
  state: LoadedMonthState | undefined;
  isTracking: boolean;
  transactionBrowserOptions: BudgetTransactionBrowserOptions;
  statesByMonth: Map<string, LoadedMonthState>;
}) {
  // Skip the meter on plan-only (future) months — nothing spent to fill it.
  const status = classifyMonthActualStatus(month);
  const isFuture = status === "future";
  const dayProgress = buildDayProgress(month, status);

  // Whole-month drill-through: the actual figures open that month's expense /
  // income transactions. Only single-month figures are drillable.
  const [transactionTarget, setTransactionTarget] =
    useState<BudgetTransactionsDrilldown | null>(null);
  const expenseDrill = useMemo(
    () =>
      state && !isFuture ? buildMonthCategoriesDrilldown(state, month, "expense") : null,
    [state, month, isFuture]
  );
  const incomeDrill = useMemo(
    () =>
      state && !isFuture ? buildMonthCategoriesDrilldown(state, month, "income") : null,
    [state, month, isFuture]
  );
  const openExpense = expenseDrill ? () => setTransactionTarget(expenseDrill) : undefined;
  const openIncome = incomeDrill ? () => setTransactionTarget(incomeDrill) : undefined;
  useSpendingDetailsShortcut({ target: expenseDrill, onOpen: setTransactionTarget });
  const monthLabel = formatMonthLabel(month, "long");
  const trackingExpenseTotals = useMemo(
    () => (state && isTracking ? buildVarianceTree([state], "expense").totals : null),
    [state, isTracking]
  );
  // For the in-progress month, add the pace verdict + elapsed marker (parity
  // across tracking and envelope, category/period views).
  const pace =
    status === "current-partial" && state
      ? computeThisMonthMetrics({
          month,
          budgeted:
            isTracking && trackingExpenseTotals
              ? Math.abs(trackingExpenseTotals.budgetedMinor)
              : Math.abs(state.summary.totalBudgeted),
          actuals:
            isTracking && trackingExpenseTotals
              ? Math.max(0, -trackingExpenseTotals.actualMinor)
              : Math.abs(state.summary.totalSpent),
          isIncome: false,
        })
      : null;
  const meter =
    state && !isFuture
      ? buildMonthSummaryMeter({
          isTracking,
          budgeted:
            isTracking && trackingExpenseTotals
              ? trackingExpenseTotals.budgetedMinor
              : Math.abs(state.summary.totalBudgeted),
          spent:
            isTracking && trackingExpenseTotals
              ? trackingExpenseTotals.actualMinor
              : Math.abs(state.summary.totalSpent),
          balance:
            isTracking && trackingExpenseTotals
              ? trackingExpenseTotals.varianceMinor
              : state.summary.totalBalance,
        })
      : undefined;

  return (
    <div className="px-3 py-2 space-y-3">
      <DetailsHeader
        title="MONTH SUMMARY"
        subtitle={`${isTracking ? "Tracking" : "Envelope"} - month overview`}
        rangeLabel={formatMonthLabel(month, "long")}
        coverageLabel="Whole-month totals across all categories"
        dayProgress={dayProgress}
      />

      {state ? (
        isTracking ? (
          <TrackingMonthBody
            state={state}
            month={month}
            meter={meter}
            pace={pace}
            monthLabel={monthLabel}
            onExpenseClick={openExpense}
            onIncomeClick={openIncome}
          />
        ) : (
          <EnvelopeMonthBody
            summary={state.summary}
            meter={meter}
            pace={pace}
            monthLabel={monthLabel}
            onExpenseClick={openExpense}
            onIncomeClick={openIncome}
          />
        )
      ) : (
        <DetailsSkeleton header={false} boxes={2} />
      )}

      <BudgetNoteSection target={{ kind: "budgetMonth", id: month }} />

      {transactionTarget && (
        <BudgetTransactionsDialog
          key={`${transactionTarget.entity}:${transactionTarget.id}:${transactionTarget.month}`}
          target={transactionTarget}
          browserOptions={transactionBrowserOptions}
          statesByMonth={statesByMonth}
          onClose={() => setTransactionTarget(null)}
        />
      )}
    </div>
  );
}

function EnvelopeMonthBody({
  summary,
  meter,
  pace,
  monthLabel,
  onExpenseClick,
  onIncomeClick,
}: {
  summary: BudgetMonthSummary;
  meter?: ReturnType<typeof buildMonthSummaryMeter>;
  pace?: ThisMonthMetrics | null;
  monthLabel: string;
  onExpenseClick?: () => void;
  onIncomeClick?: () => void;
}) {
  const toBudget = summary.toBudget;
  const fullyBudgeted = toBudget === 0;
  const primaryLabel = fullyBudgeted
    ? "Fully budgeted"
    : toBudget < 0
    ? "Overbudget"
    : "To Budget";
  const helper = fullyBudgeted
    ? "Every dollar assigned"
    : toBudget < 0
    ? "Over-assigned this month"
    : "Left to assign this month";

  return (
    <>
      <PrimaryMetric
        label={primaryLabel}
        value={toBudget}
        helper={helper}
        tone={toBudget >= 0 ? "positive" : "negative"}
        showPlus={!fullyBudgeted}
        valuePrefix={fullyBudgeted ? "✓ " : undefined}
        hero
      />
      {meter && (
        <MeterSection
          model={meter}
          helper="Spending against this month's assigned budget."
          elapsedFraction={pace?.elapsedFraction}
          chip={pace ? { label: pace.statusLabel, tone: pace.tone } : undefined}
        />
      )}
      <DetailsSection title="Values">
        <MetricLine
          label="Assigned / Budgeted"
          value={formatSigned(Math.abs(summary.totalBudgeted))}
        />
        <MetricLine
          label="Spent"
          value={formatSigned(Math.abs(summary.totalSpent))}
          onValueClick={onExpenseClick}
          valueAriaLabel={`View expense transactions for ${monthLabel}`}
        />
        <MetricLine
          label="Income received"
          value={formatSigned(summary.totalIncome)}
          onValueClick={onIncomeClick}
          valueAriaLabel={`View income transactions for ${monthLabel}`}
        />
        {summary.forNextMonth > 0 && (
          <MetricLine
            label="Hold for next month"
            value={formatSigned(summary.forNextMonth)}
          />
        )}
      </DetailsSection>
    </>
  );
}

/** Plain-language variance text, e.g. "1,200.00 over budget" (RD-070). */
function monthVarianceText(
  minor: number,
  side: VarianceSide,
  provisional: boolean
): string {
  const soFar = provisional ? " so far" : "";
  const favourable = minor >= 0;
  const word =
    side === "expense"
      ? favourable
        ? "under budget"
        : "over budget"
      : favourable
        ? "above budget"
        : "below budget";
  return `${formatSigned(Math.abs(minor))} ${word}${soFar}`;
}

function varianceTone(minor: number): "positive" | "negative" | "neutral" {
  return minor > 0 ? "positive" : minor < 0 ? "negative" : "neutral";
}

function TrackingMonthBody({
  state,
  month,
  meter,
  pace,
  monthLabel,
  onExpenseClick,
  onIncomeClick,
}: {
  state: LoadedMonthState;
  month: string;
  meter?: ReturnType<typeof buildMonthSummaryMeter>;
  pace?: ThisMonthMetrics | null;
  monthLabel: string;
  onExpenseClick?: () => void;
  onIncomeClick?: () => void;
}) {
  const status = classifyMonthActualStatus(month);
  const phase: MonthTimePhase =
    status === "past" ? "past" : status === "future" ? "future" : "current";
  const isFuture = phase === "future";
  const provisional = phase === "current";
  const toDate = provisional ? " to date" : "";

  // Savings-first Tracking view derived from authoritative summary values, with
  // Variance and Balance kept independent (PR-033 / F-088).
  const view = useMemo(
    () => buildTrackingMonthView(computeTrackingMonth(trackingInputsFromState(state)), phase),
    [state, phase]
  );

  const [driversSide, setDriversSide] = useState<VarianceSide | null>(null);
  const scopeLabel = provisional ? `${monthLabel} · Current month` : monthLabel;

  return (
    <>
      {/* Primary KPI: Projected savings (current/future) or Saved/Overspent (past). */}
      <PrimaryMetric
        label={view.headline.label}
        value={view.headline.value}
        tone={view.headline.tone}
        helper={
          provisional
            ? "Projected for the full month"
            : isFuture
              ? "Planned"
              : "Income received minus expenses this month"
        }
        hero
      />
      {view.supporting && (
        <MetricLine
          label={view.supporting.label}
          value={formatSigned(view.supporting.value)}
          tone={view.supporting.tone}
        />
      )}

      {/* Expense spending progress — actuals only (never on a future month). */}
      {meter && !isFuture && (
        <MeterSection
          model={meter}
          helper="Spending against budgeted expenses this month."
          elapsedFraction={pace?.elapsedFraction}
          chip={pace ? { label: pace.statusLabel, tone: pace.tone } : undefined}
        />
      )}

      <DetailsSection title="Income">
        <MetricLine
          label={isFuture ? "Planned income" : "Budgeted income"}
          value={formatSigned(view.income.budgeted)}
        />
        {view.income.actual != null && (
          <MetricLine
            label={`Received${toDate}`}
            value={formatSigned(view.income.actual)}
            onValueClick={onIncomeClick}
            valueAriaLabel={`View income transactions for ${monthLabel}`}
          />
        )}
        {view.income.variance != null && (
          <MetricLine
            label={`Income variance${toDate}`}
            value={monthVarianceText(view.income.variance, "income", provisional)}
            tone={varianceTone(view.income.variance)}
            onValueClick={() => setDriversSide("income")}
            valueAriaLabel="View variance drivers"
          />
        )}
      </DetailsSection>

      <DetailsSection title="Expenses">
        <MetricLine
          label={isFuture ? "Planned expenses" : "Budgeted expenses"}
          value={formatSigned(view.expenses.budgeted)}
        />
        {view.expenses.actual != null && (
          <MetricLine
            label={`Spent${toDate}`}
            value={formatSigned(view.expenses.actual)}
            onValueClick={onExpenseClick}
            valueAriaLabel={`View expense transactions for ${monthLabel}`}
          />
        )}
        {view.expenses.variance != null && (
          <MetricLine
            label={`Budget variance${toDate}`}
            value={monthVarianceText(view.expenses.variance, "expense", provisional)}
            tone={varianceTone(view.expenses.variance)}
            onValueClick={() => setDriversSide("expense")}
            valueAriaLabel="View variance drivers"
          />
        )}
        {!isFuture && view.balance.distinctFromVariance && (
          <div className="border-t border-border/50 pt-1.5">
            <MetricLine
              label="Balance"
              value={formatSigned(view.balance.value)}
              tone={toneFromValue(view.balance.value)}
              tooltip="Spreadsheet leftover — includes prior carryover, so it can differ from this month's budget variance."
            />
          </div>
        )}
      </DetailsSection>

      {driversSide && !isFuture && (
        <TopVarianceDriversDialog
          open
          onClose={() => setDriversSide(null)}
          scopeLabel={scopeLabel}
          provisional={provisional}
          initialSide={driversSide}
          monthStates={[state]}
        />
      )}
    </>
  );
}
