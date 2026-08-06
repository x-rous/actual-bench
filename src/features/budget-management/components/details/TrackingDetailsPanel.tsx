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
  ThisMonthSection,
  monthPaceProps,
  toneFromValue,
} from "./DetailsPrimitives";
import { TrajectorySection } from "./DetailsVisuals";
import dynamic from "next/dynamic";
import { BudgetMeter, MeterSection } from "./BudgetMeter";
import { BudgetNoteSection, type BudgetNoteTarget } from "./BudgetNoteSection";
import { useSpendingDetailsShortcut } from "./useSpendingDetailsShortcut";

/**
 * Renders a variance as plain language — "1,200.00 under budget" — instead of a
 * bare signed number, so direction reads without decoding the sign. `positive`
 * is the good direction (under budget / above plan).
 */
function describeVariance(
  value: number,
  kind: "budget" | "plan",
  short = false
): { text: string; tone: "positive" | "negative" | "neutral" } {
  if (value === 0) {
    return { text: kind === "budget" ? "on budget" : "on plan", tone: "neutral" };
  }
  // Positive is the good direction (under budget / above plan). Short form drops
  // the trailing noun when the row label already carries it ("Budget variance"
  // → "… over"), so the line doesn't overflow the panel.
  const up =
    kind === "budget" ? (short ? "under" : "under budget") : short ? "above" : "above plan";
  const down =
    kind === "budget" ? (short ? "over" : "over budget") : short ? "below" : "below plan";
  return {
    text: `${formatSigned(Math.abs(value))} ${value > 0 ? up : down}`,
    tone: value > 0 ? "positive" : "negative",
  };
}

function VarianceLine({
  label,
  value,
  kind,
  short,
  tooltip,
}: {
  label: string;
  value: number;
  kind: "budget" | "plan";
  short?: boolean;
  tooltip?: string;
}) {
  const v = describeVariance(value, kind, short);
  return <MetricLine label={label} value={v.text} tone={v.tone} tooltip={tooltip} />;
}

const PERIOD_TOOLTIP = {
  incomeReceived:
    "Sum of income received across closed (fully-elapsed) months. The current month is shown separately.",
  expensesSpent:
    "Sum of expenses spent across closed (fully-elapsed) months. The current month is shown separately.",
  actualResult: "Income received minus expenses spent, over closed months.",
  incomeBudgetedToDate:
    "Sum of income budgeted across closed (fully-elapsed) months.",
  expensesBudgetedToDate:
    "Sum of expenses budgeted across closed (fully-elapsed) months.",
  expenseVariance:
    "Budget variance — expenses only: budgeted expenses minus expenses spent, over closed months. Positive means spending came in under budget.",
  netPlanVariance:
    "Result vs plan — the whole picture: actual net result (income − expenses) minus the planned net result, over closed months. Positive means ahead of plan.",
  fullIncomeBudget: "Sum of income budgeted across the visible 12 months.",
  fullExpenseBudget: "Sum of expenses budgeted across the visible 12 months.",
  plannedResult: "Full-period income budgeted minus expenses budgeted.",
} as const;

// Lazy-loaded: the transactions dialog (large) is only shown when a user drills
// into a cell, so keep it out of the initial budget workspace bundle.
const BudgetTransactionsDialog = dynamic(
  () => import("./BudgetTransactionsDialog").then((m) => m.BudgetTransactionsDialog),
  { ssr: false },
);

export function TrackingDetailsPanel({
  metrics,
  transactionBrowserOptions,
  statesByMonth,
  noteTarget,
}: {
  metrics: TrackingDetailsMetrics;
  transactionBrowserOptions: BudgetTransactionBrowserOptions;
  statesByMonth: Map<string, LoadedMonthState>;
  noteTarget?: BudgetNoteTarget | null;
}) {
  const isFullPeriod = metrics.entity === "none";
  const isMonth = metrics.scope === "month";
  const closedMonthsTitle =
    metrics.closedMonthCount != null && metrics.coverage
      ? `Closed months · ${metrics.closedMonthCount} of ${metrics.coverage.totalMonths}`
      : "Closed months";
  // Single in-progress month: surface the pace verdict as a chip and mark how
  // much of the month has elapsed on the meter (parity with the period view).
  const { chip: monthChip, elapsedFraction: monthElapsed } = monthPaceProps(
    metrics.thisMonth,
    isMonth
  );
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
        coverage={metrics.coverage}
        dayProgress={metrics.dayProgress}
      />

      {/* Period views lead with where the selection is heading (trajectory).
          Single months and the no-closed-months fallback lead with the primary
          metric; the closed-months breakdown and this month follow below. */}
      {!isMonth && metrics.trajectory ? (
        <TrajectorySection trajectory={metrics.trajectory} />
      ) : (
        <PrimaryMetric
          label={metrics.primary.label}
          value={metrics.primary.value}
          helper={metrics.primary.helper}
          tone={metrics.primary.tone}
          showPlus={isFullPeriod}
          chip={monthChip}
          hero
        >
          {!isFullPeriod && metrics.meter && (
            <BudgetMeter
              model={metrics.meter}
              embedded
              elapsedFraction={monthElapsed}
            />
          )}
        </PrimaryMetric>
      )}

      {isFullPeriod && metrics.meter && !metrics.trajectory && (
        <MeterSection
          model={metrics.meter}
          helper="Closed-month spending against budgeted expenses."
        />
      )}

      {!isMonth && metrics.thisMonth && (
        <ThisMonthSection metrics={metrics.thisMonth} />
      )}

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

      {isFullPeriod &&
        !metrics.futureOnly &&
        metrics.periodActuals &&
        metrics.periodBudgetToDate && (
          <DetailsSection title={closedMonthsTitle}>
            {/* Actuals build to the Result, then compare it to plan… */}
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
            <div className="border-t border-border/50 pt-1.5">
              <MetricLine
                label="Result"
                value={`${formatDelta(metrics.periodActuals.result)}${
                  metrics.periodActuals.result > 0
                    ? " saved"
                    : metrics.periodActuals.result < 0
                    ? " overspent"
                    : ""
                }`}
                tone={toneFromValue(metrics.periodActuals.result)}
                tooltip={PERIOD_TOOLTIP.actualResult}
              />
            </div>
            <VarianceLine
              label="Result vs plan"
              value={metrics.periodBudgetToDate.netPlanVariance}
              kind="plan"
              short
              tooltip={PERIOD_TOOLTIP.netPlanVariance}
            />

            {/* …then the budget side, ending in the spending variance. */}
            <p className="pt-1 text-[10.5px] font-medium uppercase tracking-wide text-muted-foreground">
              Budget
            </p>
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
            <VarianceLine
              label="Budget variance"
              value={metrics.periodBudgetToDate.expenseVariance}
              kind="budget"
              short
              tooltip={PERIOD_TOOLTIP.expenseVariance}
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
        <DetailsSection title={closedMonthsTitle}>
          <MetricLine
            label={metrics.selectionToDate.budgetLabel}
            value={formatSigned(metrics.selectionToDate.budgeted)}
          />
          <MetricLine
            label={metrics.selectionToDate.actualLabel}
            value={formatSigned(metrics.selectionToDate.actuals)}
          />
          {metrics.isIncome ? (
            <MetricLine
              label="Variance"
              value={formatDelta(metrics.selectionToDate.variance)}
              tone={toneFromValue(metrics.selectionToDate.variance)}
            />
          ) : (
            <VarianceLine
              label="Variance"
              value={metrics.selectionToDate.variance}
              kind="budget"
            />
          )}

          {metrics.selectionAverages && (
            <>
              <p className="pt-1 text-[10.5px] font-medium uppercase tracking-wide text-muted-foreground">
                Averages · per month
              </p>
              <MetricLine
                label={metrics.selectionToDate.budgetLabel}
                value={formatSigned(metrics.selectionAverages.budgetPerMonth)}
              />
              {metrics.selectionAverages.actualPerMonth != null && (
                <MetricLine
                  label={metrics.selectionToDate.actualLabel}
                  value={formatSigned(metrics.selectionAverages.actualPerMonth)}
                />
              )}
              {metrics.selectionAverages.variancePerMonth != null &&
                (metrics.isIncome ? (
                  <MetricLine
                    label="Variance"
                    value={formatDelta(metrics.selectionAverages.variancePerMonth)}
                    tone={toneFromValue(metrics.selectionAverages.variancePerMonth)}
                  />
                ) : (
                  <VarianceLine
                    label="Variance"
                    value={metrics.selectionAverages.variancePerMonth}
                    kind="budget"
                  />
                ))}
            </>
          )}
        </DetailsSection>
      )}

      {!isFullPeriod && !isMonth && metrics.selectionFullBudget != null && (
        <DetailsSection title="Full 12-month budget">
          <MetricLine
            label="Full-period budgeted"
            value={formatSigned(metrics.selectionFullBudget)}
          />
          <MetricLine
            label="Monthly average"
            value={formatSigned(Math.round(metrics.selectionFullBudget / 12))}
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
          <p className="text-[10.5px] text-muted-foreground text-right">
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
          <p className="text-[10.5px] text-muted-foreground text-right">
            {metrics.rollover.endPlan.helper}
          </p>
        </DetailsSection>
      )}

      {isMonth && noteTarget && (
        <BudgetNoteSection key={noteTarget.id} target={noteTarget} />
      )}

      {/* Period summary's cumulative story is the trajectory chart; the per-month
          trend stays for category/group selections. */}
      {!isFullPeriod && !isMonth && (
        <MiniTrend label={metrics.trendLabel} points={metrics.trend} />
      )}

      <StagedImpactBlock mode="tracking" impact={metrics.stagedImpact} />

      {!isFullPeriod && !isMonth && noteTarget && (
        <BudgetNoteSection key={noteTarget.id} target={noteTarget} />
      )}

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
