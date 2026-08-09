import {
  computeTrackingMonth,
  type TrackingMonthInputs,
  type TrackingMonthSemantics,
} from "./trackingBudgetSemantics";
import type { MonthTimePhase, Tone } from "./trackingMonthView";

/**
 * View model for the Tracking full twelve-month (no-entity) details — a `BENCH`
 * period analysis over `PARITY` values. Splits Closed / Current / Future:
 *
 * - Closed: summed Budgeted/Actual income + expense flows → income/expense
 *   variance and refund-safe Actual Savings, with an **Ending Balance snapshot**
 *   (last closed month) — monthly Balances are never summed (BM-27/§11.1).
 * - Current: Projected Savings + Actual Savings to date.
 * - Future: planned income/expense + Projected Savings only (no actuals).
 */
export type TrackingPeriodMonth = {
  month: string;
  phase: MonthTimePhase;
  inputs: TrackingMonthInputs;
};

export type TrackingPeriodView = {
  headline: { label: string; value: number; tone: Tone };
  closed: {
    monthCount: number;
    budgetedIncome: number;
    actualIncome: number;
    incomeVariance: number;
    budgetedExpenseAllocation: number;
    signedExpenseActivity: number;
    expenseVariance: number;
    actualSavings: number;
    /** Last closed month's Balance — a snapshot, never a sum. */
    endingBalance: number;
  } | null;
  current: { projectedSavings: number; actualSavingsToDate: number } | null;
  future: {
    monthCount: number;
    budgetedIncome: number;
    budgetedExpenseAllocation: number;
    projectedSavings: number;
  } | null;
};

const ZERO: TrackingMonthInputs = {
  budgetedIncome: 0,
  actualIncome: 0,
  budgetedExpenseAllocation: 0,
  signedExpenseActivity: 0,
  balance: 0,
};

/** Sum the flow fields; Balance is the *last* month's snapshot, not a sum. */
function sumFlows(months: readonly TrackingPeriodMonth[]): TrackingMonthInputs {
  return months.reduce<TrackingMonthInputs>(
    (acc, m) => ({
      budgetedIncome: acc.budgetedIncome + m.inputs.budgetedIncome,
      actualIncome: acc.actualIncome + m.inputs.actualIncome,
      budgetedExpenseAllocation: acc.budgetedExpenseAllocation + m.inputs.budgetedExpenseAllocation,
      signedExpenseActivity: acc.signedExpenseActivity + m.inputs.signedExpenseActivity,
      balance: m.inputs.balance,
    }),
    ZERO
  );
}

function toneOf(value: number): Tone {
  return value > 0 ? "positive" : value < 0 ? "negative" : "neutral";
}

export function buildTrackingPeriodView(
  months: readonly TrackingPeriodMonth[]
): TrackingPeriodView | null {
  if (months.length === 0) return null;

  const closedMonths = months.filter((m) => m.phase === "past");
  const currentMonth = months.find((m) => m.phase === "current");
  const futureMonths = months.filter((m) => m.phase === "future");

  const closedSem: TrackingMonthSemantics | null = closedMonths.length
    ? computeTrackingMonth(sumFlows(closedMonths))
    : null;

  const closed = closedSem
    ? {
        monthCount: closedMonths.length,
        budgetedIncome: closedSem.budgetedIncome,
        actualIncome: closedSem.actualIncome,
        incomeVariance: closedSem.incomeVariance,
        budgetedExpenseAllocation: closedSem.budgetedExpenseAllocation,
        signedExpenseActivity: closedSem.signedExpenseActivity,
        expenseVariance: closedSem.expenseVariance,
        actualSavings: closedSem.actualSavings,
        endingBalance: closedSem.balance, // last closed month's balance snapshot
      }
    : null;

  const currentSem = currentMonth ? computeTrackingMonth(currentMonth.inputs) : null;
  const current = currentSem
    ? {
        projectedSavings: currentSem.projectedSavings,
        actualSavingsToDate: currentSem.actualSavings,
      }
    : null;

  const future = futureMonths.length
    ? (() => {
        const sem = computeTrackingMonth(sumFlows(futureMonths));
        return {
          monthCount: futureMonths.length,
          budgetedIncome: sem.budgetedIncome,
          budgetedExpenseAllocation: sem.budgetedExpenseAllocation,
          projectedSavings: sem.projectedSavings,
        };
      })()
    : null;

  // Headline leads with realized savings over closed months; if none are closed
  // yet, fall back to the current month's projection.
  const headline = closed
    ? {
        label: closed.actualSavings >= 0 ? "Saved" : "Overspent",
        value: Math.abs(closed.actualSavings),
        tone: (closed.actualSavings >= 0 ? "positive" : "negative") as Tone,
      }
    : {
        label: "Projected savings",
        value: current?.projectedSavings ?? future?.projectedSavings ?? 0,
        tone: toneOf(current?.projectedSavings ?? future?.projectedSavings ?? 0),
      };

  return { headline, closed, current, future };
}
