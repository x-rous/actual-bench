"use client";

import { useState } from "react";
import { formatDelta, formatSigned } from "../../lib/format";
import type { EnvelopeDetailsMetrics } from "../../lib/budgetDetailsMetrics";
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
  toneClass,
} from "./DetailsPrimitives";
import { BudgetTransactionsDialog } from "./BudgetTransactionsDialog";
import { useSpendingDetailsShortcut } from "./useSpendingDetailsShortcut";

function toneFromValue(value: number) {
  if (value > 0) return "positive" as const;
  if (value < 0) return "negative" as const;
  return "neutral" as const;
}

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
  note,
}: {
  metrics: EnvelopeDetailsMetrics;
  transactionBrowserOptions: BudgetTransactionBrowserOptions;
  statesByMonth: Map<string, LoadedMonthState>;
  note?: string;
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
        showPlus={isFullPeriod && isToBudgetLabel(metrics.primary.label)}
        valuePrefix={isFullyBudgeted(metrics.primary.label) ? "✓ " : undefined}
      />

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
          <p className="text-[10px] text-muted-foreground/70 text-right">
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
              label="Carryover"
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
              label="Carryover"
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

      {isMonth && note && (
        <DetailsSection title="Note">
          <p className="whitespace-pre-wrap text-[11px] text-foreground/80">
            {note}
          </p>
        </DetailsSection>
      )}

      {!isMonth && <MiniTrend label={metrics.trendLabel} points={metrics.trend} />}

      <StagedImpactBlock mode="envelope" impact={metrics.stagedImpact} />

      {!isFullPeriod && !isMonth && note && (
        <DetailsSection title="Note">
          <p className="whitespace-pre-wrap text-[11px] text-foreground/80">
            {note}
          </p>
        </DetailsSection>
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
