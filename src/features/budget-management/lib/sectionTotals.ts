import type { BudgetMode, CellView, LoadedMonthState } from "../types";
import { trackingIncomeBalance, trackingIncomeBudgeted } from "./monthAuthority";

export type SectionFilter = "expense" | "income";

export function getSectionEffectiveView({
  budgetMode,
  filter,
  cellView,
}: {
  budgetMode: BudgetMode;
  filter: SectionFilter;
  cellView: CellView;
}): CellView {
  return budgetMode === "envelope" && filter === "income" ? "spent" : cellView;
}

function trackingIncomeTotal(
  state: LoadedMonthState,
  effectiveView: CellView
): number {
  // Received is the API summary; budgeted/balance come from the shared
  // canonical selectors (BM-14) so grid and details can never disagree.
  if (effectiveView === "spent") return state.summary.totalIncome;
  if (effectiveView === "balance") return trackingIncomeBalance(state);
  return trackingIncomeBudgeted(state);
}

function trackingExpenseTotal(
  state: LoadedMonthState,
  effectiveView: CellView
): number {
  if (effectiveView === "spent") return state.summary.totalSpent;
  if (effectiveView === "balance") return state.summary.totalBalance;
  return state.summary.totalBudgeted;
}

function envelopeTotal(
  state: LoadedMonthState,
  filter: SectionFilter,
  effectiveView: CellView
): number {
  // BM-14: Envelope section totals are authoritative API summary values — never
  // a sum of rendered/group rows. Income is Received-only (summary.totalIncome);
  // expenses read the summary by view. The summary already includes hidden
  // entities, so financial inclusion never shifts with visibility.
  if (filter === "income") return state.summary.totalIncome;
  if (effectiveView === "spent") return state.summary.totalSpent;
  if (effectiveView === "balance") return state.summary.totalBalance;
  return state.summary.totalBudgeted;
}

export function calculateSectionTotal({
  state,
  filter,
  cellView,
  budgetMode,
}: {
  state: LoadedMonthState;
  filter: SectionFilter;
  cellView: CellView;
  budgetMode: BudgetMode;
}): number {
  const effectiveView = getSectionEffectiveView({ budgetMode, filter, cellView });

  if (budgetMode === "tracking") {
    return filter === "expense"
      ? trackingExpenseTotal(state, effectiveView)
      : trackingIncomeTotal(state, effectiveView);
  }

  return envelopeTotal(state, filter, effectiveView);
}
