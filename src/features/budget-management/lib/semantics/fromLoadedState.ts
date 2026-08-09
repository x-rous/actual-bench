import type { LoadedMonthState } from "../../types";
import { trackingIncomeBudgeted } from "../monthAuthority";
import type { TrackingMonthInputs } from "./trackingBudgetSemantics";
import type { EnvelopeFundingInputs } from "./envelopeBudgetSemantics";

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
  return {
    // BM-14: budgeted income has no summary field — use the single canonical
    // selector so this adapter can never drift from the grid/summary totals.
    budgetedIncome: trackingIncomeBudgeted(state),
    actualIncome: state.summary.totalIncome,
    budgetedExpenseAllocation: Math.abs(state.summary.totalBudgeted),
    signedExpenseActivity: state.summary.totalSpent,
    balance: state.summary.totalBalance,
  };
}

/**
 * Adapt the live `LoadedMonthState` into Envelope funding inputs. Envelope
 * `totalBudgeted` is already negative (no sign coercion applies), so all summary
 * funding fields are used raw-signed; the funding bridge reconciles from them.
 */
export function envelopeInputsFromState(state: LoadedMonthState): EnvelopeFundingInputs {
  const s = state.summary;
  return {
    incomeReceived: s.totalIncome,
    fromLastMonth: s.fromLastMonth,
    availableFunds: s.incomeAvailable,
    lastMonthOverspent: s.lastMonthOverspent,
    budgetedAllocation: s.totalBudgeted,
    forNextMonthHold: s.forNextMonth,
    toBudget: s.toBudget,
    balance: s.totalBalance,
    signedSpent: s.totalSpent,
  };
}
