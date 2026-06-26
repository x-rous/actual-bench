"use client";

import { formatMonthLabel } from "@/lib/budget/monthMath";
import { formatDelta, formatSigned } from "../../lib/format";
import type { DetailsTone } from "../../lib/budgetDetailsMetrics";
import type { BudgetMonthSummary, LoadedMonthState } from "../../types";
import {
  DetailsHeader,
  DetailsSection,
  MetricLine,
  PrimaryMetric,
} from "./DetailsPrimitives";
import { BudgetNoteSection } from "./BudgetNoteSection";

function toneFromValue(value: number): DetailsTone {
  if (value > 0) return "positive";
  if (value < 0) return "negative";
  return "neutral";
}

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
}: {
  month: string;
  state: LoadedMonthState | undefined;
  isTracking: boolean;
}) {
  return (
    <div className="px-3 py-2 space-y-3">
      <DetailsHeader
        title="MONTH SUMMARY"
        subtitle={`${isTracking ? "Tracking" : "Envelope"} - month overview`}
        rangeLabel={formatMonthLabel(month, "long")}
        coverageLabel="Whole-month totals across all categories"
      />

      {state ? (
        isTracking ? (
          <TrackingMonthBody summary={state.summary} />
        ) : (
          <EnvelopeMonthBody summary={state.summary} />
        )
      ) : (
        <DetailsSection>
          <p className="text-[11px] text-muted-foreground">
            Month data is still loading.
          </p>
        </DetailsSection>
      )}

      <BudgetNoteSection target={{ kind: "budgetMonth", id: month }} />
    </div>
  );
}

function EnvelopeMonthBody({ summary }: { summary: BudgetMonthSummary }) {
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
      />
      <DetailsSection title="Values">
        <MetricLine
          label="Assigned / Budgeted"
          value={formatSigned(Math.abs(summary.totalBudgeted))}
        />
        <MetricLine
          label="Spent"
          value={formatSigned(Math.abs(summary.totalSpent))}
        />
        <MetricLine
          label="Income received"
          value={formatSigned(summary.totalIncome)}
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

function TrackingMonthBody({ summary }: { summary: BudgetMonthSummary }) {
  const income = summary.totalIncome;
  const spent = Math.abs(summary.totalSpent);
  const budgeted = Math.abs(summary.totalBudgeted);
  const result = income - spent;
  // Matches the period panel: budgeted - spent, positive means under budget.
  const variance = summary.totalBalance;

  return (
    <>
      <PrimaryMetric
        label="Actual Result"
        value={result}
        helper={result >= 0 ? "saved" : "overspent"}
        tone={toneFromValue(result)}
        showPlus
      />
      <DetailsSection title="Actuals">
        <MetricLine label="Income received" value={formatSigned(income)} />
        <MetricLine label="Expenses spent" value={formatSigned(spent)} />
        <MetricLine
          label="Result"
          value={formatDelta(result)}
          tone={toneFromValue(result)}
        />
      </DetailsSection>
      <DetailsSection title="Budget">
        <MetricLine label="Expenses budgeted" value={formatSigned(budgeted)} />
        <MetricLine
          label="Spending vs budgeted"
          value={formatDelta(variance)}
          tone={toneFromValue(variance)}
        />
      </DetailsSection>
    </>
  );
}
