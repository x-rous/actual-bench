"use client";

import { formatDelta, formatSigned } from "../../lib/format";
import type { TrackingDetailsMetrics } from "../../lib/budgetDetailsMetrics";
import {
  DetailsHeader,
  DetailsSection,
  MetricLine,
  MiniTrend,
  PrimaryMetric,
  StagedImpactBlock,
} from "./DetailsPrimitives";

function toneFromValue(value: number) {
  if (value > 0) return "positive" as const;
  if (value < 0) return "negative" as const;
  return "neutral" as const;
}

export function TrackingDetailsPanel({
  metrics,
}: {
  metrics: TrackingDetailsMetrics;
}) {
  const isFullPeriod = metrics.entity === "none";
  const isMonth = metrics.scope === "month";

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
          />
          <MetricLine
            label="Expenses spent"
            value={formatSigned(metrics.periodActuals.expensesSpent)}
          />
          <MetricLine
            label="Result"
            value={formatDelta(metrics.periodActuals.result)}
            tone={toneFromValue(metrics.periodActuals.result)}
          />
        </DetailsSection>
      )}

      {isFullPeriod && !metrics.futureOnly && metrics.periodBudgetToDate && (
        <DetailsSection title="Budget to date">
          <MetricLine
            label="Income budgeted"
            value={formatSigned(metrics.periodBudgetToDate.incomeBudgeted)}
          />
          <MetricLine
            label="Expenses budgeted"
            value={formatSigned(metrics.periodBudgetToDate.expensesBudgeted)}
          />
          <MetricLine
            label="Plan variance"
            value={formatDelta(metrics.periodBudgetToDate.planVariance)}
            tone={toneFromValue(metrics.periodBudgetToDate.planVariance)}
          />
        </DetailsSection>
      )}

      {isFullPeriod && metrics.periodFullPlan && (
        <DetailsSection title="Full 12-month plan">
          <MetricLine
            label="Income budgeted"
            value={formatSigned(metrics.periodFullPlan.incomeBudgeted)}
          />
          <MetricLine
            label="Expenses budgeted"
            value={formatSigned(metrics.periodFullPlan.expensesBudgeted)}
          />
          <MetricLine
            label="Planned result"
            value={formatDelta(metrics.periodFullPlan.plannedResult)}
            tone={toneFromValue(metrics.periodFullPlan.plannedResult)}
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

      <StagedImpactBlock mode="tracking" impact={metrics.stagedImpact} />
    </div>
  );
}
