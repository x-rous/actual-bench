import type { LoadedMonthState } from "../../types";
import type { TrackingMonthInputs } from "./trackingBudgetSemantics";

/**
 * Adapt the live `LoadedMonthState` (post-transport, post-staging) into
 * mode-neutral Tracking inputs, until the whole path is migrated onto the parser.
 *
 * `summary.totalBudgeted` is coerced negative for Tracking at the transport
 * boundary (BM-07); the expense allocation is a positive magnitude, so recover it
 * with `abs` now that the mode/role is known — the sanctioned post-mode conversion,
 * not blind sign inference. `totalSpent`/`totalIncome`/`totalBalance` are already
 * signed and used as-is. Budgeted income has no summary field, so sum the visible
 * income GROUP budgets (authoritative aggregate; hidden excluded per Tracking).
 */
export function trackingInputsFromState(state: LoadedMonthState): TrackingMonthInputs {
  let budgetedIncome = 0;
  for (const id of state.groupOrder) {
    const group = state.groupsById[id];
    if (group && group.isIncome && !group.hidden) budgetedIncome += group.budgeted;
  }

  return {
    budgetedIncome,
    actualIncome: state.summary.totalIncome,
    budgetedExpenseAllocation: Math.abs(state.summary.totalBudgeted),
    signedExpenseActivity: state.summary.totalSpent,
    balance: state.summary.totalBalance,
  };
}
