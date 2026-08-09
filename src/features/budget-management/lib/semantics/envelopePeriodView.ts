import { displayMagnitude } from "./amountRoles";
import {
  envelopeBridgeRows,
  type EnvelopeBridgeRow,
  type EnvelopeFundingSemantics,
} from "./envelopeBudgetSemantics";
import type { MonthTimePhase, Tone } from "./trackingMonthView";

/**
 * View model for the Envelope full twelve-month (no-entity) details (`BENCH`
 * period analysis over `PARITY` values). Funding is inherently monthly, so:
 *
 * - the headline + bridge come from a single **focus month** (current, else the
 *   latest month with actuals) — To Budget is **never summed** across months (BM-25);
 * - period Budgeted and signed Spent are summed with **explicit coverage**;
 * - Balance is a **single snapshot** (focus month), never a sum of balances.
 */
export type EnvelopePeriodMonth = {
  month: string;
  phase: MonthTimePhase;
  funding: EnvelopeFundingSemantics;
};

export type EnvelopePeriodView = {
  focusMonth: string;
  headline: { label: string; value: number; tone: Tone };
  bridge: EnvelopeBridgeRow[];
  /** Σ assigned/budgeted magnitude across all visible months (full-period coverage). */
  periodBudgeted: number;
  /** Σ signed spent across months with actuals (refund-safe). */
  periodSpent: number;
  /** Money still assigned as of the focus month — a snapshot, not a sum. */
  focusBalance: number;
  /** Coverage: how many of the visible months carry actual activity. */
  coverage: { actualMonths: number; totalMonths: number };
};

function toBudgetHeadline(toBudget: number): { label: string; value: number; tone: Tone } {
  if (toBudget === 0) return { label: "Fully budgeted", value: 0, tone: "positive" };
  if (toBudget > 0) return { label: "To Budget", value: toBudget, tone: "positive" };
  return { label: "Overbudgeted", value: Math.abs(toBudget), tone: "negative" };
}

export function buildEnvelopePeriodView(
  months: readonly EnvelopePeriodMonth[]
): EnvelopePeriodView | null {
  if (months.length === 0) return null;

  const withActuals = months.filter((m) => m.phase !== "future");
  const focus =
    months.find((m) => m.phase === "current") ??
    withActuals[withActuals.length - 1] ??
    months[months.length - 1];

  return {
    focusMonth: focus.month,
    headline: toBudgetHeadline(focus.funding.toBudget),
    bridge: envelopeBridgeRows(focus.funding),
    periodBudgeted: months.reduce(
      (sum, m) => sum + displayMagnitude(m.funding.budgetedAllocation),
      0
    ),
    periodSpent: withActuals.reduce((sum, m) => sum + m.funding.signedSpent, 0),
    focusBalance: focus.funding.balance,
    coverage: { actualMonths: withActuals.length, totalMonths: months.length },
  };
}
