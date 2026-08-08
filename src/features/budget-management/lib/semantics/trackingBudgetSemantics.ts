import type { ParsedBudgetMonth } from "./parseBudgetMonth";
import { required, visibleGroups } from "./amountRoles";

/**
 * Tracking month semantics (plan vs actual). Derived from **authoritative summary
 * fields** — never by summing rendered rows — with hidden already excluded by the
 * server totals (proven in `PR-033-phase0-contract-findings.md §5`).
 *
 * Balance and Variance are kept **independent** (BM-06): `balance` is the
 * spreadsheet leftover (may include prior carryover); `expenseVariance` is the
 * current-period result and never aliases it.
 */
export type TrackingMonthSemantics = {
  /** Planned income — no summary field; Σ visible income GROUP budgets (authoritative aggregate). */
  budgetedIncome: number;
  /** Signed actual income (`totalIncome`). */
  actualIncome: number;
  /** Favourable-positive: actual − budgeted. */
  incomeVariance: number;
  /** Planned expense allocation (`totalBudgeted`; positive per the Tracking contract). */
  budgetedExpenseAllocation: number;
  /** Signed expense activity (`totalSpent`; refunds positive). */
  signedExpenseActivity: number;
  /** Favourable-positive, current-period, excludes carryover: allocation + signed activity. */
  expenseVariance: number;
  /** Budgeted income − budgeted expense allocation. */
  projectedSavings: number;
  /** Refund-safe: actual income + signed expense activity. */
  actualSavings: number;
  /** Spreadsheet leftover (`totalBalance`) — NOT variance. */
  balance: number;
};

/**
 * Mode-neutral inputs for the Tracking month math. Both the parser path
 * ({@link deriveTrackingMonth}) and the live `LoadedMonthState` path
 * (`semantics/fromLoadedState`) build these, so the arithmetic lives in one place.
 */
export type TrackingMonthInputs = {
  budgetedIncome: number;
  actualIncome: number;
  /** Positive planned expense allocation (never a coerced negative). */
  budgetedExpenseAllocation: number;
  /** Signed expense activity (refunds positive). */
  signedExpenseActivity: number;
  /** Spreadsheet leftover — kept independent from variance. */
  balance: number;
};

export function computeTrackingMonth(i: TrackingMonthInputs): TrackingMonthSemantics {
  return {
    budgetedIncome: i.budgetedIncome,
    actualIncome: i.actualIncome,
    incomeVariance: i.actualIncome - i.budgetedIncome,
    budgetedExpenseAllocation: i.budgetedExpenseAllocation,
    signedExpenseActivity: i.signedExpenseActivity,
    expenseVariance: i.budgetedExpenseAllocation + i.signedExpenseActivity,
    projectedSavings: i.budgetedIncome - i.budgetedExpenseAllocation,
    actualSavings: i.actualIncome + i.signedExpenseActivity,
    balance: i.balance,
  };
}

export function deriveTrackingMonth(month: ParsedBudgetMonth): TrackingMonthSemantics {
  return computeTrackingMonth({
    budgetedIncome: visibleGroups(month.groups, "income").reduce(
      (sum, group) => sum + required(group.budgeted),
      0
    ),
    actualIncome: required(month.totalIncome),
    budgetedExpenseAllocation: required(month.totalBudgeted),
    signedExpenseActivity: required(month.totalSpent),
    balance: required(month.totalBalance),
  });
}
