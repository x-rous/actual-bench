import type { DirectoryAccount } from "./ledgerPort";

/**
 * How an economic movement is represented in Actual (RD-084 P1.6 T117;
 * FR-011, FR-011a, FR-013, FR-014, FR-057, FR-064, research R-17).
 *
 * Pure rules, verified live in P1.0 (R-18, T014): Actual clears every category
 * on an off-budget row, and on a transfer it keeps a category only on the
 * on-budget side of a budget-boundary transfer (both on-budget: neither side
 * keeps one). Bench therefore plans the category Actual will actually hold, so
 * the preview equals the post-apply row (SC-019), and it never invents an
 * on-budget transaction to make an off-budget charge "show up" in the budget.
 */

export type CategoryDecision =
  | { ok: true; categoryId: string | null }
  | { ok: false; code: "missing-category"; text: string };

type Budgeted = Pick<DirectoryAccount, "offBudget">;

/**
 * An interest charge, capitalized fee or adjustment written into the liability
 * account itself: uncategorized when the liability is off-budget, the
 * configured category when it is on-budget (FR-014, FR-057).
 */
export function chargeCategory(liability: Budgeted, categoryId: string | null, label: string): CategoryDecision {
  if (liability.offBudget) return { ok: true, categoryId: null };
  if (!categoryId) return { ok: false, code: "missing-category", text: `Choose a ${label} category for this debt.` };
  return { ok: true, categoryId };
}

/**
 * The category of a transfer leg written in `from` toward `to` (FR-011a).
 * Crossing the boundary: the on-budget side carries the loan payment (or draw)
 * category and the off-budget side none. Not crossing: no category on either.
 */
export function transferLegCategory(from: Budgeted, to: Budgeted, boundaryCategoryId: string | null, label: string): CategoryDecision {
  if (from.offBudget === to.offBudget) return { ok: true, categoryId: null };
  if (from.offBudget) return { ok: true, categoryId: null };
  if (!boundaryCategoryId) return { ok: false, code: "missing-category", text: `Choose a ${label} category for this debt.` };
  return { ok: true, categoryId: boundaryCategoryId };
}

/**
 * A split child that is not a transfer (interest, cash-paid fee) in the
 * payment account: its own category when that account is on-budget, none when
 * it is off-budget, because Actual would clear it anyway.
 */
export function paymentChildCategory(payment: Budgeted, categoryId: string | null, label: string): CategoryDecision {
  if (payment.offBudget) return { ok: true, categoryId: null };
  if (!categoryId) return { ok: false, code: "missing-category", text: `Choose a ${label} category for this debt.` };
  return { ok: true, categoryId };
}

/**
 * The opening adjustment (FR-064): liability account only. Off-budget:
 * uncategorized. On-budget: only an explicit category the user chose for this
 * adjustment; there is no default, and without one the proposal is Blocked.
 */
export function openingAdjustmentCategory(liability: Budgeted, userCategoryId: string | null): CategoryDecision {
  if (liability.offBudget) return { ok: true, categoryId: null };
  if (!userCategoryId) return { ok: false, code: "missing-category", text: "Choose a category for the opening adjustment; this liability is on-budget." };
  return { ok: true, categoryId: userCategoryId };
}

/**
 * The account a draw is written from (R-18): always the on-budget side when
 * the movement crosses the boundary, so the draw category lands; otherwise the
 * liability.
 */
export function drawWriteSide<T extends Budgeted>(liability: T, cash: T): T {
  return liability.offBudget && !cash.offBudget ? cash : liability;
}
