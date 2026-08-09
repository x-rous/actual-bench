import { displayMagnitude } from "./amountRoles";
import {
  envelopeBridgeRows,
  type EnvelopeBridgeRow,
  type EnvelopeFundingSemantics,
} from "./envelopeBudgetSemantics";
import type { MonthTimePhase, Tone } from "./trackingMonthView";

/**
 * View model for an Envelope whole-month details panel (`BENCH` layout using
 * `PARITY` values). Funding-first: To Budget / Overbudgeted headline (by sign,
 * BM-18) and the operator-based funding bridge (BM-19/BM-24). Balance is money
 * still assigned, never a variance. Future months omit fabricated actuals (BM-26).
 */
export type EnvelopeMonthView = {
  /** Primary KPI by sign: To Budget (≥0) or Overbudgeted (<0). */
  headline: { label: string; value: number; tone: Tone };
  /** Operator rows with positive display magnitudes; result is `toBudget`. */
  bridge: EnvelopeBridgeRow[];
  toBudget: number;
  /** Bridge reconciles to the authoritative `toBudget`. */
  reconciles: boolean;
  /** Optional Available Funds explanation. */
  availableFundsBreakdown: { incomeReceived: number; fromLastMonth: number };
  /** Assigned/budgeted this month, positive display magnitude (the envelope triad's first term). */
  budgeted: number;
  /** Money still assigned (`totalBalance`) — not a variance. */
  balance: number;
  /** Signed expense activity (refund-safe). */
  signedSpent: number;
  incomeReceived: number;
  /**
   * This month's own overspending (positive magnitude), i.e. the amount that
   * rolls into next month as "Overspent last month". Sourced authoritatively from
   * the next month's `lastMonthOverspent` (carryover/hidden-correct). `null` when
   * not applicable (future month, no overspend, or the next month isn't loaded).
   */
  thisMonthOverspent: number | null;
  /** Future months omit fabricated actual spending/balance rows. */
  showActivity: boolean;
};

export function buildEnvelopeMonthView(
  s: EnvelopeFundingSemantics,
  phase: MonthTimePhase,
  /** Next month's `lastMonthOverspent` (negative), or null when it isn't loaded. */
  nextMonthLastOverspent: number | null = null
): EnvelopeMonthView {
  const toBudget = s.toBudget;
  const headline =
    toBudget === 0
      ? { label: "Fully budgeted", value: 0, tone: "positive" as Tone }
      : toBudget > 0
        ? { label: "To Budget", value: toBudget, tone: "positive" as Tone }
        : { label: "Overbudgeted", value: Math.abs(toBudget), tone: "negative" as Tone };

  return {
    headline,
    bridge: envelopeBridgeRows(s),
    toBudget,
    reconciles: s.toBudgetComputed === s.toBudget,
    availableFundsBreakdown: {
      incomeReceived: s.incomeReceived,
      fromLastMonth: s.fromLastMonth,
    },
    budgeted: displayMagnitude(s.budgetedAllocation),
    balance: s.balance,
    signedSpent: s.signedSpent,
    incomeReceived: s.incomeReceived,
    thisMonthOverspent:
      phase !== "future" && nextMonthLastOverspent != null && nextMonthLastOverspent < 0
        ? Math.abs(nextMonthLastOverspent)
        : null,
    showActivity: phase !== "future",
  };
}
