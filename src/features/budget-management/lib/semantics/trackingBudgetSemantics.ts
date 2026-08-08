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

export function deriveTrackingMonth(month: ParsedBudgetMonth): TrackingMonthSemantics {
  const actualIncome = required(month.totalIncome);
  const signedExpenseActivity = required(month.totalSpent);
  const budgetedExpenseAllocation = required(month.totalBudgeted);
  const balance = required(month.totalBalance);

  const budgetedIncome = visibleGroups(month.groups, "income").reduce(
    (sum, group) => sum + required(group.budgeted),
    0
  );

  return {
    budgetedIncome,
    actualIncome,
    incomeVariance: actualIncome - budgetedIncome,
    budgetedExpenseAllocation,
    signedExpenseActivity,
    expenseVariance: budgetedExpenseAllocation + signedExpenseActivity,
    projectedSavings: budgetedIncome - budgetedExpenseAllocation,
    actualSavings: actualIncome + signedExpenseActivity,
    balance,
  };
}
