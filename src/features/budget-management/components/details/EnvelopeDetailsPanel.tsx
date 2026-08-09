"use client";

import { useMemo, useState } from "react";
import { formatDelta, formatSigned } from "../../lib/format";
import type { EnvelopeDetailsMetrics } from "../../lib/budgetDetailsMetrics";
import { classifyMonthActualStatus } from "../../lib/budgetDetailsModel";
import { computeEnvelopeFunding } from "../../lib/semantics/envelopeBudgetSemantics";
import { envelopeInputsFromState } from "../../lib/semantics/fromLoadedState";
import {
  buildEnvelopePeriodView,
  type EnvelopePeriodMonth,
} from "../../lib/semantics/envelopePeriodView";
import type { MonthTimePhase } from "../../lib/semantics/trackingMonthView";
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
  monthPaceProps,
  toneClass,
  toneFromValue,
} from "./DetailsPrimitives";
import { BudgetTransactionsDialog } from "./BudgetTransactionsDialog";
import { BudgetMeter, MeterSection } from "./BudgetMeter";
import { BudgetNoteSection, type BudgetNoteTarget } from "./BudgetNoteSection";
import { useSpendingDetailsShortcut } from "./useSpendingDetailsShortcut";

function isToBudgetLabel(label: string): boolean {
  return label.includes("To Budget") || label.includes("Overbudget");
}

function isFullyBudgeted(label: string): boolean {
  return label === "Fully budgeted";
}

function formatEnvelopeStatusValue(label: string, value: number): string {
  if ((isToBudgetLabel(label) || isFullyBudgeted(label)) && value === 0) {
    return `✓ ${formatSigned(value)}`;
  }
  return isToBudgetLabel(label) ? formatDelta(value) : formatSigned(value);
}

export function EnvelopeDetailsPanel({
  metrics,
  transactionBrowserOptions,
  statesByMonth,
  noteTarget,
}: {
  metrics: EnvelopeDetailsMetrics;
  transactionBrowserOptions: BudgetTransactionBrowserOptions;
  statesByMonth: Map<string, LoadedMonthState>;
  noteTarget?: BudgetNoteTarget | null;
}) {
  const isFullPeriod = metrics.entity === "none";
  const isMonth = metrics.scope === "month";
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

  // Full-period funding view (PR-033 / F-088): the focus month's bridge and a
  // Balance snapshot, computed from the authoritative summary values. To Budget
  // and Balance are never summed across months.
  const periodView = useMemo(() => {
    if (!isFullPeriod) return null;
    const months: EnvelopePeriodMonth[] = [...statesByMonth.keys()]
      .sort()
      .map((m) => {
        const state = statesByMonth.get(m)!;
        const status = classifyMonthActualStatus(m);
        const phase: MonthTimePhase =
          status === "past" ? "past" : status === "future" ? "future" : "current";
        return { month: m, phase, funding: computeEnvelopeFunding(envelopeInputsFromState(state)) };
      });
    return buildEnvelopePeriodView(months);
  }, [isFullPeriod, statesByMonth]);

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

      <PrimaryMetric
        label={metrics.primary.label}
        value={metrics.primary.value}
        helper={metrics.primary.helper}
        tone={metrics.primary.tone}
        showPlus={isFullPeriod && isToBudgetLabel(metrics.primary.label)}
        valuePrefix={isFullyBudgeted(metrics.primary.label) ? "✓ " : undefined}
        chip={monthChip}
        hero
      >
        {/* Selections mirror the primary (Balance) → embed. The period summary
            leads with "To Budget" (a different number), so its spending meter
            gets its own status box below instead. */}
        {!isFullPeriod && metrics.meter && (
          <BudgetMeter model={metrics.meter} embedded elapsedFraction={monthElapsed} />
        )}
      </PrimaryMetric>

      {isFullPeriod && metrics.meter && (
        <MeterSection model={metrics.meter} helper="Spending against the assigned budget this period." />
      )}

      {isFullPeriod && periodView && (
        <DetailsSection title="How To Budget is derived">
          {periodView.bridge.map((row) => (
            <MetricLine
              key={row.label}
              label={`${row.operator} ${row.label}`}
              value={formatSigned(row.display)}
            />
          ))}
          <p className="text-[10.5px] text-muted-foreground text-right">
            Focus month {periodView.focusMonth} · To Budget is not summed across months
          </p>
        </DetailsSection>
      )}

      {!isMonth && metrics.endPlan && (
        <DetailsSection title="End of visible plan">
          <div className="flex justify-between items-baseline gap-2">
            <span className="text-muted-foreground shrink-0 text-[11px]">
              {metrics.endPlan.label}
            </span>
            <span
              className={`font-sans tabular-nums text-right text-[11px] ${toneClass(metrics.endPlan.tone)}`}
            >
              {formatEnvelopeStatusValue(metrics.endPlan.label, metrics.endPlan.value)}
            </span>
          </div>
          <p className="text-[10.5px] text-muted-foreground text-right">
            {metrics.endPlan.helper}
          </p>
        </DetailsSection>
      )}

      {isFullPeriod && metrics.periodValues && (
        <DetailsSection title="Period values">
          <MetricLine
            label="Assigned / Budgeted"
            value={formatSigned(metrics.periodValues.assignedBudgeted)}
          />
          <MetricLine
            label="Spent to date"
            value={formatSigned(metrics.periodValues.spentToDate)}
          />
          {periodView && (
            <MetricLine
              label="Balance"
              value={formatSigned(periodView.focusBalance)}
              tone={toneFromValue(periodView.focusBalance)}
              tooltip="Money still assigned to envelopes as of the focus month — a snapshot, not a sum of monthly balances."
            />
          )}
          <MetricLine
            label="Income received to date"
            value={formatSigned(metrics.periodValues.incomeReceivedToDate)}
          />
          {metrics.periodValues.forNextMonth != null && (
            <MetricLine
              label="Hold for next month"
              value={formatSigned(metrics.periodValues.forNextMonth)}
            />
          )}
        </DetailsSection>
      )}

      {!isFullPeriod && !isMonth && metrics.selectionActivity && (
        <DetailsSection title="Period activity">
          <MetricLine
            label="Assigned / Budgeted"
            value={formatSigned(metrics.selectionActivity.assignedBudgeted)}
          />
          <MetricLine
            label={metrics.selectionActivity.spentLabel}
            value={formatSigned(metrics.selectionActivity.spentToDate)}
          />
          <MetricLine
            label="Net assigned/spent"
            value={formatDelta(metrics.selectionActivity.netAssignedSpent)}
            tone={toneFromValue(metrics.selectionActivity.netAssignedSpent)}
          />
          {metrics.selectionActivity.carryover != null && (
            <MetricLine
              label="Rollover"
              value={metrics.selectionActivity.carryover ? "On" : "Off"}
            />
          )}
        </DetailsSection>
      )}

      {isMonth && metrics.monthValues && (
        <DetailsSection title="Values">
          <MetricLine
            label="Assigned / Budgeted"
            value={formatSigned(metrics.monthValues.assignedBudgeted)}
          />
          <MetricLine
            label="Spent"
            value={formatSigned(metrics.monthValues.spent)}
            onValueClick={
              metrics.monthValues.transactionDrilldown
                ? () => setTransactionTarget(metrics.monthValues!.transactionDrilldown)
                : undefined
            }
            valueAriaLabel={`View transactions for ${metrics.title}`}
          />
          <MetricLine
            label="Balance"
            value={formatSigned(metrics.monthValues.balance)}
            tone={toneFromValue(metrics.monthValues.balance)}
          />
          {metrics.monthValues.previousLabel &&
            metrics.monthValues.previousBalance != null && (
              <MetricLine
                label={metrics.monthValues.previousLabel}
                value={formatSigned(metrics.monthValues.previousBalance)}
              />
            )}
          {metrics.monthValues.carryover != null && (
            <MetricLine
              label="Rollover"
              value={metrics.monthValues.carryover ? "On" : "Off"}
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

      {isMonth && noteTarget && (
        <BudgetNoteSection key={noteTarget.id} target={noteTarget} />
      )}

      {!isMonth && <MiniTrend label={metrics.trendLabel} points={metrics.trend} />}

      <StagedImpactBlock mode="envelope" impact={metrics.stagedImpact} />

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
