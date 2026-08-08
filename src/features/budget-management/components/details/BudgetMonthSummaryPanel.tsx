"use client";

import { useMemo, useState } from "react";
import { formatMonthLabel } from "@/lib/budget/monthMath";
import { formatDelta, formatSigned } from "../../lib/format";
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
  const summary = state.summary;
  const income = summary.totalIncome;
  const spent = summary.totalSpent;
  const result = income + spent;

  // RD-070: single-month variance drivers. Provisional for the open month.
  const status = classifyMonthActualStatus(month);
  const isFuture = status === "future";
  const provisional = status === "current-partial";
  // Take the entry-line totals from the same tree the dialog uses, so the
  // clickable number always equals the dialog's total.
  const expenseVariance = useMemo(
    () => buildVarianceTree([state], "expense").totals.varianceMinor,
    [state]
  );
  const incomeVariance = useMemo(
    () => buildVarianceTree([state], "income").totals.varianceMinor,
    [state]
  );
  const [driversSide, setDriversSide] = useState<VarianceSide | null>(null);
  const scopeLabel = provisional ? `${monthLabel} · Current month` : monthLabel;

  return (
    <>
      {/* Lead with spending-vs-budget (the meter states over/under budget); the
          net result lives once, below, so nothing is shown twice. */}
      {meter && (
        <MeterSection
          model={meter}
          helper="Spending against budgeted expenses this month."
          elapsedFraction={pace?.elapsedFraction}
          chip={pace ? { label: pace.statusLabel, tone: pace.tone } : undefined}
          hero
        />
      )}
      <DetailsSection title="Actuals">
        <MetricLine
          label="Income received"
          value={formatSigned(income)}
          onValueClick={onIncomeClick}
          valueAriaLabel={`View income transactions for ${monthLabel}`}
        />
        <MetricLine
          label="Expenses spent"
          value={formatSigned(spent)}
          onValueClick={onExpenseClick}
          valueAriaLabel={`View expense transactions for ${monthLabel}`}
        />
        <MetricLine
          label="Result"
          value={`${formatDelta(result)}${
            result > 0 ? " saved" : result < 0 ? " overspent" : ""
          }`}
          tone={toneFromValue(result)}
        />
        {!isFuture && (
          <div className="border-t border-border/50 pt-1.5">
            <MetricLine
              label="Budget variance"
              value={monthVarianceText(expenseVariance, "expense", provisional)}
              tone={varianceTone(expenseVariance)}
              onValueClick={() => setDriversSide("expense")}
              valueAriaLabel="View variance drivers"
            />
            <MetricLine
              label="Income variance"
              value={monthVarianceText(incomeVariance, "income", provisional)}
              tone={varianceTone(incomeVariance)}
              onValueClick={() => setDriversSide("income")}
              valueAriaLabel="View variance drivers"
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
