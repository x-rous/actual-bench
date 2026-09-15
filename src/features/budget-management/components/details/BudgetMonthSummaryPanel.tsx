"use client";

import { useMemo, useState } from "react";
import { formatMonthLabel, nextMonth } from "@/lib/budget/monthMath";
import { formatSignedWhole, roundsToZeroWhole } from "../../lib/format";
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
import { computeEnvelopeFunding } from "../../lib/semantics/envelopeBudgetSemantics";
import {
  trackingInputsFromState,
  envelopeInputsFromState,
} from "../../lib/semantics/fromLoadedState";
import {
  buildTrackingMonthView,
  type MonthTimePhase,
} from "../../lib/semantics/trackingMonthView";
import { buildEnvelopeMonthView } from "../../lib/semantics/envelopeMonthView";
import { TopVarianceDriversDialog } from "./TopVarianceDriversDialog";
import type { LoadedMonthState } from "../../types";
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
            state={state}
            month={month}
            meter={meter}
            pace={pace}
            monthLabel={monthLabel}
            nextMonthLastOverspent={
              statesByMonth.get(nextMonth(month))?.summary.lastMonthOverspent ?? null
            }
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
          key={`${transactionTarget.entity}:${transactionTarget.id}:${transactionTarget.monthStart}:${transactionTarget.monthEnd}`}
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
  state,
  month,
  meter,
  pace,
  monthLabel,
  nextMonthLastOverspent,
  onExpenseClick,
  onIncomeClick,
}: {
  state: LoadedMonthState;
  month: string;
  meter?: ReturnType<typeof buildMonthSummaryMeter>;
  pace?: ThisMonthMetrics | null;
  monthLabel: string;
  nextMonthLastOverspent: number | null;
  onExpenseClick?: () => void;
  onIncomeClick?: () => void;
}) {
  const status = classifyMonthActualStatus(month);
  const phase: MonthTimePhase =
    status === "past" ? "past" : status === "future" ? "future" : "current";

  // Funding-first Envelope view: To Budget / Overbudgeted headline + the funding
  // bridge, reconciled from raw signs (PR-033 / F-088, BM-19/BM-24).
  const view = useMemo(
    () =>
      buildEnvelopeMonthView(
        computeEnvelopeFunding(envelopeInputsFromState(state)),
        phase,
        nextMonthLastOverspent
      ),
    [state, phase, nextMonthLastOverspent]
  );

  return (
    <>
      <PrimaryMetric
        label={view.headline.label}
        value={view.headline.value}
        tone={view.headline.tone}
        helper={
          view.headline.label === "Overbudgeted"
            ? "Assigned more than available"
            : view.headline.label === "Fully budgeted"
              ? "Every dollar assigned"
              : "Left to assign this month"
        }
        hero
      />

      {/* Funding bridge — operator rows carry direction; magnitudes are positive. */}
      <DetailsSection title="Funding">
        {view.bridge.map((row) => (
          <MetricLine
            key={row.label}
            label={`${row.operator} ${row.label}`}
            value={formatSignedWhole(row.display)}
          />
        ))}
        <div className="border-t border-border/50 pt-1.5">
          <MetricLine
            label={`= ${view.headline.label}`}
            value={formatSignedWhole(view.toBudget)}
            tone={view.headline.tone}
          />
        </div>
      </DetailsSection>

      {/* Actual activity — never fabricated on a future month. */}
      {view.showActivity && (
        <>
          {meter && (
            <MeterSection
              model={meter}
              helper="Spending against this month's assigned budget."
              elapsedFraction={pace?.elapsedFraction}
              chip={pace ? { label: pace.statusLabel, tone: pace.tone } : undefined}
            />
          )}
          <DetailsSection title="Activity">
            <MetricLine label="Assigned" value={formatSignedWhole(view.budgeted)} />
            <MetricLine
              label="Spent"
              value={formatSignedWhole(view.signedSpent)}
              onValueClick={onExpenseClick}
              valueAriaLabel={`View expense transactions for ${monthLabel}`}
            />
            <MetricLine
              label="Income received"
              value={formatSignedWhole(view.incomeReceived)}
              onValueClick={onIncomeClick}
              valueAriaLabel={`View income transactions for ${monthLabel}`}
            />
            <MetricLine
              label="Balance"
              value={formatSignedWhole(view.balance)}
              tone={toneFromValue(view.balance)}
              tooltip="Money still assigned to envelopes (carryover-inclusive) - not a plan variance."
            />
            {view.thisMonthOverspent != null && (
              <MetricLine
                label={phase === "current" ? "Overspent this month so far" : "Overspent this month"}
                value={formatSignedWhole(view.thisMonthOverspent)}
                tone="negative"
                tooltip="Overspending not carried over - it reduces next month's available funds as “Overspent last month”."
              />
            )}
          </DetailsSection>
        </>
      )}
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
  // Under half a unit prints as "0", and "0 over budget" is a direction the
  // number no longer shows. At that size the honest statement is that the
  // figure landed on plan.
  if (roundsToZeroWhole(minor)) {
    return `${side === "expense" ? "On budget" : "On target"}${soFar}`;
  }
  const favourable = minor >= 0;
  const word =
    side === "expense"
      ? favourable
        ? "under budget"
        : "over budget"
      : favourable
        ? "above budget"
        : "below budget";
  return `${formatSignedWhole(Math.abs(minor))} ${word}${soFar}`;
}

function varianceTone(minor: number): "positive" | "negative" | "neutral" {
  // Neutral for anything that rounds away, so the colour agrees with the "0"
  // on screen rather than with the sign behind it.
  if (roundsToZeroWhole(minor)) return "neutral";
  return minor > 0 ? "positive" : "negative";
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
          value={formatSignedWhole(view.supporting.value)}
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
          value={formatSignedWhole(view.income.budgeted)}
        />
        {view.income.actual != null && (
          <MetricLine
            label={`Received${toDate}`}
            value={formatSignedWhole(view.income.actual)}
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
          // Signed negative to match Spent below and every other view — expenses
          // read negative across the panel (the allocation is a positive
          // magnitude, negated for display only).
          value={formatSignedWhole(-view.expenses.budgeted)}
        />
        {view.expenses.actual != null && (
          <MetricLine
            label={`Spent${toDate}`}
            value={formatSignedWhole(view.expenses.actual)}
            onValueClick={onExpenseClick}
            valueAriaLabel={`View expense transactions for ${monthLabel}`}
          />
        )}
        {view.expenses.variance != null && (
          <MetricLine
            label={`Expense variance${toDate}`}
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
              value={formatSignedWhole(view.balance.value)}
              tone={toneFromValue(view.balance.value)}
              tooltip="Spreadsheet leftover - includes prior carryover, so it can differ from this month's budget variance."
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
