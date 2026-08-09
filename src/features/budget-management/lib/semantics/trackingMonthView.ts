import type { TrackingMonthSemantics } from "./trackingBudgetSemantics";

/**
 * Presentation-neutral view model for a Tracking whole-month details panel
 * (`BENCH` layout using `PARITY` values). Encodes the upstream Savings-first
 * hierarchy (Rule 9) and keeps Balance and Variance as separate rows (BM-06).
 */
export type MonthTimePhase = "past" | "current" | "future";

export type Tone = "positive" | "negative" | "neutral";

function toneOf(value: number): Tone {
  return value > 0 ? "positive" : value < 0 ? "negative" : "neutral";
}

/** A Budget / Actual / Variance line. `actual` and `variance` are null for future (plan-only). */
export type TrackingLine = {
  budgeted: number;
  actual: number | null;
  variance: number | null;
};

export type TrackingMonthView = {
  /** Primary KPI: Projected savings (current/future) or Saved/Overspent (past). */
  headline: { label: string; value: number; tone: Tone };
  /** Current month only: Actual savings to date (a `BENCH` supporting metric). */
  supporting: { label: string; value: number; tone: Tone } | null;
  /** Current month → actuals are "to date"; drives "so far" wording. */
  provisional: boolean;
  income: TrackingLine;
  expenses: TrackingLine;
  /** Spreadsheet leftover, shown as its own row; `distinctFromVariance` when carryover matters. */
  balance: { value: number; distinctFromVariance: boolean };
};

export function buildTrackingMonthView(
  s: TrackingMonthSemantics,
  phase: MonthTimePhase
): TrackingMonthView {
  const future = phase === "future";
  const provisional = phase === "current";

  const headline =
    phase === "past"
      ? {
          label: s.actualSavings >= 0 ? "Saved" : "Overspent",
          value: Math.abs(s.actualSavings),
          tone: (s.actualSavings >= 0 ? "positive" : "negative") as Tone,
        }
      : { label: "Projected savings", value: s.projectedSavings, tone: toneOf(s.projectedSavings) };

  return {
    headline,
    supporting: provisional
      ? { label: "Actual savings to date", value: s.actualSavings, tone: toneOf(s.actualSavings) }
      : null,
    provisional,
    income: future
      ? { budgeted: s.budgetedIncome, actual: null, variance: null }
      : { budgeted: s.budgetedIncome, actual: s.actualIncome, variance: s.incomeVariance },
    expenses: future
      ? { budgeted: s.budgetedExpenseAllocation, actual: null, variance: null }
      : {
          budgeted: s.budgetedExpenseAllocation,
          actual: s.signedExpenseActivity,
          variance: s.expenseVariance,
        },
    balance: { value: s.balance, distinctFromVariance: s.balance !== s.expenseVariance },
  };
}
