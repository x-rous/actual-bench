/**
 * Canonical month-value selectors (Section 8 source-of-truth matrix, BM-14).
 *
 * The grid, the summary rows, and the details panel must never each re-derive an
 * authoritative total their own way — that lets values disagree between views
 * and shift with visibility/collapse. Anything a component needs beyond a raw
 * API summary field comes from here, so there is exactly one implementation.
 *
 * Matrix rules honoured:
 *  1. Never sum currently rendered rows to reconstruct an authoritative summary.
 *  3. Never let showHidden or collapse state alter financial inclusion — these
 *     selectors read the category `hidden` flag per the mode's rule, never any
 *     UI toggle.
 */
import type { LoadedCategory, LoadedMonthState } from "../types";

/**
 * Income categories that count toward Tracking aggregates: Tracking excludes
 * hidden categories and hidden groups from its totals (unlike Envelope, which
 * keeps them financially active). Independent of the showHidden toggle.
 */
export function trackingVisibleIncomeCategories(
  state: LoadedMonthState
): LoadedCategory[] {
  const result: LoadedCategory[] = [];
  for (const groupId of state.groupOrder) {
    const group = state.groupsById[groupId];
    if (!group || group.hidden || !group.isIncome) continue;
    for (const categoryId of group.categoryIds) {
      const category = state.categoriesById[categoryId];
      if (!category || category.hidden) continue;
      result.push(category);
    }
  }
  return result;
}

/**
 * Canonical Tracking "budgeted income" total. The API month summary has no
 * income-budget field, so this is the authority — the sum of visible income
 * category `budgeted` values — and every view must read it from here.
 */
export function trackingIncomeBudgeted(state: LoadedMonthState): number {
  let total = 0;
  for (const category of trackingVisibleIncomeCategories(state)) {
    total += category.budgeted;
  }
  return total;
}

/**
 * Canonical Tracking "income balance" total (visible income categories). Same
 * authority basis as the budgeted total above.
 */
export function trackingIncomeBalance(state: LoadedMonthState): number {
  let total = 0;
  for (const category of trackingVisibleIncomeCategories(state)) {
    total += category.balance;
  }
  return total;
}
