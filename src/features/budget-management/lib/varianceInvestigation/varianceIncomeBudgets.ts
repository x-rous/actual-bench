import type { LoadedMonthState } from "../../types";

/**
 * Older Actual servers leave income budgets out of the month payload. The
 * budget workspace fetches them separately; this puts them onto a month state
 * for the categories that need it, so Tracking income variance has a target to
 * compare against. Everything else in the state is returned as it was.
 */
export function applyIncomeBudgetFallback(
  state: LoadedMonthState,
  month: string,
  incomeBudgets: ReadonlyMap<string, ReadonlyMap<string, number>> | undefined
): LoadedMonthState {
  const ids = state.incomeBudgetFallbackIds;
  if (!ids || ids.length === 0 || !incomeBudgets) return state;
  const forMonth = incomeBudgets.get(month);
  const categoriesById = { ...state.categoriesById };
  let changed = false;
  for (const id of ids) {
    const category = categoriesById[id];
    if (!category?.isIncome) continue;
    const budgeted = forMonth?.get(id) ?? 0;
    if (budgeted === category.budgeted) continue;
    categoriesById[id] = { ...category, budgeted };
    changed = true;
  }
  return changed ? { ...state, categoriesById } : state;
}
