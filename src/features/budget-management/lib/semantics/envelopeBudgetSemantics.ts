import type { ParsedBudgetMonth } from "./parseBudgetMonth";
import { displayMagnitude, required } from "./amountRoles";

/**
 * Envelope month semantics (allocation of real money). The funding result comes
 * from **authoritative summary fields**, which already **include hidden** entities
 * (proven in `PR-033-phase0-contract-findings.md §5`). Raw signs are preserved for
 * calculation; positive display magnitudes are exposed separately for the bridge.
 *
 * To Budget is a funding reconciliation, never `Income − Budgeted` (BM-19/Rule 11):
 *   toBudget = incomeAvailable + lastMonthOverspent + totalBudgeted − forNextMonth
 */
export type EnvelopeFundingSemantics = {
  /** Received income (`totalIncome`) — Envelope income is Received-only. */
  incomeReceived: number;
  /** Funds carried from the prior month. */
  fromLastMonth: number;
  /** Available funds (`incomeAvailable` = income received + from last month). */
  availableFunds: number;
  /** Signed prior-overspend adjustment (negative). */
  lastMonthOverspent: number;
  /** Signed expense allocation total (`totalBudgeted`; negative per the contract). */
  budgetedAllocation: number;
  /** Positive held/reserved amount. */
  forNextMonthHold: number;
  /** Authoritative funding result (`toBudget`). */
  toBudget: number;
  /** Same result recomputed from raw signs — must equal `toBudget` (reconciliation). */
  toBudgetComputed: number;
  /** Envelope leftover (`totalBalance`) — money still assigned, not variance. */
  balance: number;
  /** Signed expense activity (`totalSpent`; refunds positive). */
  signedSpent: number;
};

/**
 * Mode-neutral inputs for the Envelope funding math. Both the parser path and the
 * live `LoadedMonthState` path build these (all raw-signed; Envelope needs no sign
 * recovery since `totalBudgeted` is already negative).
 */
export type EnvelopeFundingInputs = {
  incomeReceived: number;
  fromLastMonth: number;
  availableFunds: number;
  lastMonthOverspent: number;
  budgetedAllocation: number;
  forNextMonthHold: number;
  toBudget: number;
  balance: number;
  signedSpent: number;
};

export function computeEnvelopeFunding(i: EnvelopeFundingInputs): EnvelopeFundingSemantics {
  return {
    incomeReceived: i.incomeReceived,
    fromLastMonth: i.fromLastMonth,
    availableFunds: i.availableFunds,
    lastMonthOverspent: i.lastMonthOverspent,
    budgetedAllocation: i.budgetedAllocation,
    forNextMonthHold: i.forNextMonthHold,
    toBudget: i.toBudget,
    toBudgetComputed:
      i.availableFunds + i.lastMonthOverspent + i.budgetedAllocation - i.forNextMonthHold,
    balance: i.balance,
    signedSpent: i.signedSpent,
  };
}

export function deriveEnvelopeFunding(month: ParsedBudgetMonth): EnvelopeFundingSemantics {
  return computeEnvelopeFunding({
    incomeReceived: required(month.totalIncome),
    fromLastMonth: required(month.fromLastMonth),
    availableFunds: required(month.incomeAvailable),
    lastMonthOverspent: required(month.lastMonthOverspent),
    budgetedAllocation: required(month.totalBudgeted),
    forNextMonthHold: required(month.forNextMonth),
    toBudget: required(month.toBudget),
    balance: required(month.totalBalance),
    signedSpent: required(month.totalSpent),
  });
}

export type EnvelopeBridgeRow = {
  label: string;
  operator: "+" | "-";
  /** Positive display magnitude — presentation only, never feeds the formula. */
  display: number;
};

/**
 * The operator-based funding bridge with **positive display magnitudes** (BM-19).
 * The operators already carry direction, so overspend/budgeted/hold are shown as
 * magnitudes; the result row is `To Budget / Overbudget` with value `toBudget`.
 */
export function envelopeBridgeRows(s: EnvelopeFundingSemantics): EnvelopeBridgeRow[] {
  return [
    { label: "Available funds", operator: "+", display: s.availableFunds },
    { label: "Overspent last month", operator: "-", display: displayMagnitude(s.lastMonthOverspent) },
    { label: "Budgeted", operator: "-", display: displayMagnitude(s.budgetedAllocation) },
    { label: "Hold for next month", operator: "-", display: s.forNextMonthHold },
  ];
}
