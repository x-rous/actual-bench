"use client";

import { useState } from "react";
import { formatDelta, formatSigned } from "../../lib/format";
import type { TrackingDetailsMetrics } from "../../lib/budgetDetailsMetrics";
import type {
  BudgetTransactionBrowserOptions,
  BudgetTransactionsDrilldown,
} from "../../lib/budgetTransactionBrowser";
import type { LoadedMonthState } from "../../types";
import {
  DetailsHeader,
  DetailsSection,
  MetricLine,
  MiniTrend,
  PrimaryMetric,
  StagedImpactBlock,
} from "./DetailsPrimitives";
import { BudgetTransactionsDialog } from "./BudgetTransactionsDialog";
import { useSpendingDetailsShortcut } from "./useSpendingDetailsShortcut";

function toneFromValue(value: number) {
  if (value > 0) return "positive" as const;
  if (value < 0) return "negative" as const;
  return "neutral" as const;
}

const PERIOD_TOOLTIP = {
  incomeReceived:
    "Sum of income received in actualized months and the current partial month.",
  expensesSpent:
    "Sum of expenses spent in actualized months and the current partial month.",
  actualResult: "Income received minus expenses spent.",
  incomeBudgetedToDate:
    "Sum of income budgeted in actualized months and the current partial month.",
  expensesBudgetedToDate:
    "Sum of expenses budgeted in actualized months and the current partial month.",
  expenseVariance:
    "Expenses budgeted to date minus expenses spent to date. Positive means under budget.",
  netPlanVariance:
    "Actual result so far compared with budgeted result to date: (income received - expenses spent) - (income budgeted - expenses budgeted).",
  fullIncomeBudget: "Sum of income budgeted across the visible 12 months.",
  fullExpenseBudget: "Sum of expenses budgeted across the visible 12 months.",
  plannedResult: "Full-period income budgeted minus expenses budgeted.",
} as const;

export function TrackingDetailsPanel({
  metrics,
  transactionBrowserOptions,
  statesByMonth,
}: {
  metrics: TrackingDetailsMetrics;
  transactionBrowserOptions: BudgetTransactionBrowserOptions;
  statesByMonth: Map<string, LoadedMonthState>;
}) {
  const isFullPeriod = metrics.entity === "none";
  const isMonth = metrics.scope === "month";
  const [transactionTarget, setTransactionTarget] =
    useState<BudgetTransactionsDrilldown | null>(null);
  useSpendingDetailsShortcut({
    target: metrics.monthValues?.transactionDrilldown,
    onOpen: setTransactionTarget,
  });

  return (
    <div className="px-3 py-2 space-y-3">
      <DetailsHeader
        title={metrics.title}
        subtitle={metrics.subtitle}
        rangeLabel={metrics.rangeLabel}
        coverageLabel={metrics.coverageLabel}
      />

      <PrimaryMetric
        label={metrics.primary.label}
        value={metrics.primary.value}
        helper={metrics.primary.helper}
        tone={metrics.primary.tone}
        showPlus={isFullPeriod}
      />

      {isMonth && metrics.monthValues && (
        <DetailsSection title="Values">
          <MetricLine
            label={metrics.monthValues.budgetLabel}
            value={formatSigned(metrics.monthValues.budgeted)}
          />
          {metrics.monthValues.actuals != null && (
            <MetricLine
              label={metrics.monthValues.actualLabel}
              value={formatSigned(metrics.monthValues.actuals)}
              onValueClick={
                metrics.monthValues.transactionDrilldown
                  ? () => setTransactionTarget(metrics.monthValues!.transactionDrilldown)
                  : undefined
              }
              valueAriaLabel={`View transactions for ${metrics.title}`}
            />
          )}
          {metrics.monthValues.variance != null && (
            <MetricLine
              label="Variance"
              value={formatDelta(metrics.monthValues.variance)}
              tone={toneFromValue(metrics.monthValues.variance)}
            />
          )}
          {metrics.monthValues.rolloverBalance && (
            <MetricLine
              label={metrics.monthValues.rolloverBalance.label}
              value={formatDelta(metrics.monthValues.rolloverBalance.value)}
              tone={metrics.monthValues.rolloverBalance.tone}
            />
          )}
          {metrics.monthValues.previousBudgeted != null && (
            <MetricLine
              label="Previous month budgeted"
              value={formatSigned(metrics.monthValues.previousBudgeted)}
            />
          )}
          {metrics.monthValues.stagedEdit && (
            <>
              <MetricLine
                label="Was"
                value={formatSigned(metrics.monthValues.stagedEdit.was)}
              />
              <MetricLine
                label="Diff"
                value={formatDelta(metrics.monthValues.stagedEdit.diff)}
                tone={toneFromValue(metrics.monthValues.stagedEdit.diff)}
              />
            </>
          )}
        </DetailsSection>
      )}

      {isFullPeriod && !metrics.futureOnly && metrics.periodActuals && (
        <DetailsSection title="Actuals to date">
          <MetricLine
            label="Income received"
            value={formatSigned(metrics.periodActuals.incomeReceived)}
            tooltip={PERIOD_TOOLTIP.incomeReceived}
          />
          <MetricLine
            label="Expenses spent"
            value={formatSigned(metrics.periodActuals.expensesSpent)}
            tooltip={PERIOD_TOOLTIP.expensesSpent}
          />
          <MetricLine
            label="Result"
            value={formatDelta(metrics.periodActuals.result)}
            tone={toneFromValue(metrics.periodActuals.result)}
            tooltip={PERIOD_TOOLTIP.actualResult}
          />
        </DetailsSection>
      )}

      {isFullPeriod && !metrics.futureOnly && metrics.periodBudgetToDate && (
        <DetailsSection title="Budget to date">
          <MetricLine
            label="Income budgeted"
            value={formatSigned(metrics.periodBudgetToDate.incomeBudgeted)}
            tooltip={PERIOD_TOOLTIP.incomeBudgetedToDate}
          />
          <MetricLine
            label="Expenses budgeted"
            value={formatSigned(metrics.periodBudgetToDate.expensesBudgeted)}
            tooltip={PERIOD_TOOLTIP.expensesBudgetedToDate}
          />
          <MetricLine
            label="Spending vs budgeted"
            value={formatDelta(metrics.periodBudgetToDate.expenseVariance)}
            tone={toneFromValue(metrics.periodBudgetToDate.expenseVariance)}
            tooltip={PERIOD_TOOLTIP.expenseVariance}
          />
          <MetricLine
            label="Result vs budgeted"
            value={formatDelta(metrics.periodBudgetToDate.netPlanVariance)}
            tone={toneFromValue(metrics.periodBudgetToDate.netPlanVariance)}
            tooltip={PERIOD_TOOLTIP.netPlanVariance}
          />
        </DetailsSection>
      )}

      {isFullPeriod && metrics.periodFullPlan && (
        <DetailsSection title="Full 12-month plan">
          <MetricLine
            label="Income budgeted"
            value={formatSigned(metrics.periodFullPlan.incomeBudgeted)}
            tooltip={PERIOD_TOOLTIP.fullIncomeBudget}
          />
          <MetricLine
            label="Expenses budgeted"
            value={formatSigned(metrics.periodFullPlan.expensesBudgeted)}
            tooltip={PERIOD_TOOLTIP.fullExpenseBudget}
          />
          <MetricLine
            label="Planned result"
            value={formatDelta(metrics.periodFullPlan.plannedResult)}
            tone={toneFromValue(metrics.periodFullPlan.plannedResult)}
            tooltip={PERIOD_TOOLTIP.plannedResult}
          />
        </DetailsSection>
      )}

      {!isFullPeriod && !isMonth && !metrics.futureOnly && metrics.selectionToDate && (
        <DetailsSection title="Actual vs budget to date">
          <MetricLine
            label={metrics.selectionToDate.budgetLabel}
            value={formatSigned(metrics.selectionToDate.budgeted)}
          />
          <MetricLine
            label={metrics.selectionToDate.actualLabel}
            value={formatSigned(metrics.selectionToDate.actuals)}
          />
          <MetricLine
            label="Variance"
            value={formatDelta(metrics.selectionToDate.variance)}
            tone={toneFromValue(metrics.selectionToDate.variance)}
          />
        </DetailsSection>
      )}

      {!isFullPeriod && !isMonth && metrics.selectionAverages && (
        <DetailsSection title="Averages to date">
          <MetricLine
            label={metrics.selectionAverages.budgetLabel}
            value={formatSigned(metrics.selectionAverages.budgetPerMonth)}
          />
          {metrics.selectionAverages.actualPerMonth != null && (
            <MetricLine
              label={metrics.selectionAverages.actualLabel}
              value={formatSigned(metrics.selectionAverages.actualPerMonth)}
            />
          )}
          {metrics.selectionAverages.variancePerMonth != null && (
            <MetricLine
              label="Variance / month"
              value={formatDelta(metrics.selectionAverages.variancePerMonth)}
              tone={toneFromValue(metrics.selectionAverages.variancePerMonth)}
            />
          )}
        </DetailsSection>
      )}

      {!isFullPeriod && !isMonth && metrics.selectionFullBudget != null && (
        <DetailsSection title="Full 12-month budget">
          <MetricLine
            label="Full-period budgeted"
            value={formatSigned(metrics.selectionFullBudget)}
          />
        </DetailsSection>
      )}

      {!isFullPeriod && !isMonth && metrics.rollover?.current && (
        <DetailsSection title="Rollover Balance">
          <MetricLine
            label={metrics.rollover.current.label}
            value={formatDelta(metrics.rollover.current.value)}
            tone={metrics.rollover.current.tone}
          />
          <p className="text-[10px] text-muted-foreground/70 text-right">
            {metrics.rollover.current.helper}
          </p>
        </DetailsSection>
      )}

      {!isFullPeriod && !isMonth && metrics.rollover?.endPlan && (
        <DetailsSection title="End of visible plan">
          <MetricLine
            label={metrics.rollover.endPlan.label}
            value={formatDelta(metrics.rollover.endPlan.value)}
            tone={metrics.rollover.endPlan.tone}
          />
          <p className="text-[10px] text-muted-foreground/70 text-right">
            {metrics.rollover.endPlan.helper}
          </p>
        </DetailsSection>
      )}

      {!isMonth && <MiniTrend label={metrics.trendLabel} points={metrics.trend} />}
      {isFullPeriod && metrics.spendingVsBudgetedTrend && (
        <MiniTrend label="Monthly Spending vs. Budgeted" points={metrics.spendingVsBudgetedTrend} />
      )}

      <StagedImpactBlock mode="tracking" impact={metrics.stagedImpact} />
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
