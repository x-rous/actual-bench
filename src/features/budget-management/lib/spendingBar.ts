/**
 * Pure model for the in-grid spending bar (RD-065).
 *
 * Given a category's budgeted amount and its spending for a month, derive a
 * compact bar: how full it is (`fill`), how far past budget it went
 * (`overflow`), and a `tier` that drives colour. Everything is in integer minor
 * units; the caller is responsible for sign-normalising `spent` to a magnitude.
 *
 * Rendering (in BudgetCell): a 3px track pinned to the cell's bottom edge. The
 * green/amber portion is `fill` of the track width; when over budget a red
 * segment covering `overflow` of the width is drawn from the right. The exact
 * numbers stay in the cell tooltip and details panel — the bar is a glanceable
 * signal, never the source of truth.
 */

export type SpendingTier =
  | "none" // nothing budgeted and nothing spent — no bar
  | "under" // spent < ~90% of budget
  | "near" // spent within ~90–100% of budget
  | "over" // spent > budget
  | "unbudgeted"; // spent against a zero/absent budget

export type SpendingBar = {
  tier: SpendingTier;
  /** Filled fraction of the track, 0..1 (green/amber portion). */
  fill: number;
  /** Over-budget fraction drawn in red from the right, 0..1 (0 unless `over`). */
  overflow: number;
};

/** Ratio at/after which the fill turns amber (approaching the limit). */
export const NEAR_THRESHOLD = 0.9;

const NONE: SpendingBar = { tier: "none", fill: 0, overflow: 0 };

function clamp01(n: number): number {
  if (n <= 0) return 0;
  if (n >= 1) return 1;
  return n;
}

/**
 * Build the bar model.
 *
 * @param budgetedMinor Assigned amount (minor units). Expected >= 0; <= 0 is
 *   treated as "no budget".
 * @param spentMinor    Spending magnitude (minor units, >= 0). Callers pass
 *   `Math.max(0, -actuals)` so a net inflow (refund) reads as zero spent.
 */
export function computeSpendingBar(budgetedMinor: number, spentMinor: number): SpendingBar {
  const budgeted = Number.isFinite(budgetedMinor) ? budgetedMinor : 0;
  const spent = Number.isFinite(spentMinor) && spentMinor > 0 ? spentMinor : 0;

  if (budgeted <= 0) {
    // No funded envelope. Spending against it is the notable case.
    return spent > 0 ? { tier: "unbudgeted", fill: 1, overflow: 0 } : NONE;
  }

  if (spent <= 0) {
    // Budgeted but nothing spent yet — an empty (all-remaining) bar.
    return { tier: "under", fill: 0, overflow: 0 };
  }

  const ratio = spent / budgeted;

  if (ratio > 1) {
    return { tier: "over", fill: 1, overflow: clamp01(ratio - 1) };
  }

  return {
    tier: ratio >= NEAR_THRESHOLD ? "near" : "under",
    fill: clamp01(ratio),
    overflow: 0,
  };
}
