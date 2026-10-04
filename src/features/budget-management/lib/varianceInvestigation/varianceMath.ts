import type { LoadedCategory } from "../../types";

/**
 * Variance Drivers — sign handling, gross splits and vocabulary.
 *
 * Actual's own sign convention stops at this file. Everything it returns is a
 * display magnitude (spend and budget are positive, a refund is a negative
 * spend), and one signed number, the *unfavourable amount*, carries direction:
 * positive is unfavourable, negative is favourable, for both sides.
 *
 * All amounts are integer minor units. Nothing here rounds.
 */

export type VarianceMode = "tracking" | "envelope";
export type VarianceSide = "expense" | "income";

/** A category's cell for one month, as display magnitudes (minor units). */
export type CategoryCell = {
  /** The month had a loaded state; a missing month is a gap, not a zero. */
  present: boolean;
  /** Planned amount, positive. Allocation in Envelope, budget in Tracking. */
  budget: number;
  /** Spent (positive; a refund-heavy month can be negative) or received. */
  actual: number;
  /** Envelope: signed category balance at month end, positive = available. */
  balance: number;
  /** Envelope: money brought into the month. `balance = carriedIn + budget - actual`. */
  carriedIn: number;
  /** Envelope: whether a negative balance rolls into the next month. */
  carryover: boolean;
};

export const EMPTY_CELL: CategoryCell = {
  present: false,
  budget: 0,
  actual: 0,
  balance: 0,
  carriedIn: 0,
  carryover: false,
};

/**
 * Convert a loaded category into display magnitudes.
 *
 * Tracking expense budgets arrive negative and spending arrives negative, so
 * both are normalised here, once. Income `received` and its budget are already
 * positive.
 *
 * An Envelope expense allocation keeps its sign: money moved out of an envelope
 * is a negative allocation, and flipping it would change the carried-in amount
 * the balance bridge derives from it.
 */
export function normalizeCategoryCell(
  category: LoadedCategory,
  side: VarianceSide,
  mode: VarianceMode
): CategoryCell {
  const budget =
    mode === "envelope" && side === "expense" ? category.budgeted : Math.abs(category.budgeted);
  const actual = side === "expense" ? -category.actuals : category.actuals;
  const balance = category.balance;
  return {
    present: true,
    budget,
    actual,
    balance,
    // balance = carriedIn + budget - actual, rearranged. Only meaningful for
    // Envelope expense categories; Tracking never reads it.
    carriedIn: side === "expense" ? balance - budget + actual : 0,
    carryover: category.carryover,
  };
}

/**
 * Signed unfavourable amount: positive means unfavourable.
 *
 * Expenses: overspend is `actual - budget`.
 * Income: shortfall is `budget - actual`.
 */
export function unfavourableAmount(
  side: VarianceSide,
  budget: number,
  actual: number
): number {
  return side === "expense" ? actual - budget : budget - actual;
}

export type GrossSplit = {
  /** Sum of the positive unfavourable amounts (overspend / shortfall). */
  unfavourable: number;
  /** Sum of the magnitudes of the negative ones (savings / surplus). */
  favourable: number;
  /** `unfavourable - favourable`. Positive = net unfavourable. */
  net: number;
};

export function splitGross(unfavourableAmounts: readonly number[]): GrossSplit {
  let unfavourable = 0;
  let favourable = 0;
  for (const amount of unfavourableAmounts) {
    if (amount > 0) unfavourable += amount;
    else if (amount < 0) favourable -= amount;
  }
  return { unfavourable, favourable, net: unfavourable - favourable };
}

/**
 * A driver's share of the gross side it belongs to, never of the net.
 * `null` when it has no variance or its side sums to zero.
 */
export function shareOfSide(
  unfavourable: number,
  gross: Pick<GrossSplit, "unfavourable" | "favourable">
): number | null {
  if (unfavourable > 0) {
    return gross.unfavourable > 0 ? unfavourable / gross.unfavourable : null;
  }
  if (unfavourable < 0) {
    return gross.favourable > 0 ? -unfavourable / gross.favourable : null;
  }
  return null;
}

/** Variance as a fraction of budget. `null` (shown as an em dash) at a zero budget. */
export function pctOfBudget(unfavourable: number, budget: number): number | null {
  return budget > 0 ? Math.abs(unfavourable) / budget : null;
}

export type VarianceVocabulary = {
  budget: string;
  actual: string;
  /** "Overspent", "Shortfall", "Over allocation". */
  unfavourable: string;
  favourable: string;
  unfavourableLower: string;
  favourableLower: string;
  /** "over budget", "below target", "over allocation". */
  netUnfavourable: string;
  netFavourable: string;
  /** "of overspend", "of savings". */
  shareUnfavourable: string;
  shareFavourable: string;
  otherUnfavourable: string;
  otherFavourable: string;
  /** What `actual` is called in a sentence: "spent", "received". */
  actualVerb: string;
  /** What `budget` is called in a sentence: "budgeted", "allocated". */
  budgetVerb: string;
  /** Column heading for a share, by the side the rows on screen belong to. */
  shareHeaderBoth: string;
  shareHeaderUnfavourable: string;
  shareHeaderFavourable: string;
};

/**
 * The words for each mode and side.
 *
 * Envelope never says "saved": unspent money is still assigned to its
 * envelope, which is not the same fact as coming in under a plan.
 */
export function vocabulary(
  mode: VarianceMode,
  side: VarianceSide
): VarianceVocabulary {
  if (mode === "envelope") {
    return {
      budget: "Allocated",
      actual: "Spent",
      unfavourable: "Over allocation",
      favourable: "Unspent",
      unfavourableLower: "over allocation",
      favourableLower: "unspent",
      netUnfavourable: "over allocation",
      netFavourable: "under allocation",
      shareUnfavourable: "of over-allocation",
      shareFavourable: "of unspent",
      otherUnfavourable: "Other over-allocation",
      otherFavourable: "Other unspent",
      actualVerb: "spent",
      budgetVerb: "allocated",
      shareHeaderBoth: "% of over / unspent",
      shareHeaderUnfavourable: "% of over-allocation",
      shareHeaderFavourable: "% of unspent",
    };
  }
  if (side === "income") {
    return {
      budget: "Budgeted",
      actual: "Received",
      unfavourable: "Shortfall",
      favourable: "Surplus",
      unfavourableLower: "shortfall",
      favourableLower: "surplus",
      netUnfavourable: "below target",
      netFavourable: "above target",
      shareUnfavourable: "of shortfall",
      shareFavourable: "of surplus",
      otherUnfavourable: "Other shortfall",
      otherFavourable: "Other surplus",
      actualVerb: "received",
      budgetVerb: "budgeted",
      shareHeaderBoth: "% of shortfall / surplus",
      shareHeaderUnfavourable: "% of shortfall",
      shareHeaderFavourable: "% of surplus",
    };
  }
  return {
    budget: "Budgeted",
    actual: "Spent",
    unfavourable: "Overspent",
    favourable: "Saved",
    unfavourableLower: "overspent",
    favourableLower: "saved",
    netUnfavourable: "over budget",
    netFavourable: "under budget",
    shareUnfavourable: "of overspend",
    shareFavourable: "of savings",
    otherUnfavourable: "Other overspend",
    otherFavourable: "Other savings",
    actualVerb: "spent",
    budgetVerb: "budgeted",
    shareHeaderBoth: "% of overspend / savings",
    shareHeaderUnfavourable: "% of overspend",
    shareHeaderFavourable: "% of savings",
  };
}

/** Median of a non-empty list; the mean of the middle two when even. */
export function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
