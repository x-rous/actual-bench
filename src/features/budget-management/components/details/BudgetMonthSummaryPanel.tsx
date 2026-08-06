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
  // For the in-progress month, add the pace verdict + elapsed marker (parity
  // across tracking and envelope, category/period views).
  const pace =
    status === "current-partial" && state
      ? computeThisMonthMetrics({
          month,
          budgeted: Math.abs(state.summary.totalBudgeted),
          actuals: Math.abs(state.summary.totalSpent),
          isIncome: false,
        })
      : null;
  const meter =
    state && !isFuture
      ? buildMonthSummaryMeter({
          isTracking,
          budgeted: Math.abs(state.summary.totalBudgeted),
          spent: Math.abs(state.summary.totalSpent),
          balance: state.summary.totalBalance,
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
            summary={state.summary}
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

function TrackingMonthBody({
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
  const income = summary.totalIncome;
  const spent = Math.abs(summary.totalSpent);
  const result = income - spent;

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
      </DetailsSection>
    </>
  );
}
