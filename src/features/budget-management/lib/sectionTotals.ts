import type {
  BudgetMode,
  CellView,
  LoadedCategory,
  LoadedMonthState,
} from "../types";

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

function visibleIncomeCategories(state: LoadedMonthState): LoadedCategory[] {
  return state.groupOrder
    .map((id) => state.groupsById[id])
    .filter((group) => !!group && group.isIncome && !group.hidden)
    .flatMap((group) =>
      group.categoryIds
        .map((categoryId) => state.categoriesById[categoryId])
        .filter((category): category is LoadedCategory => !!category && !category.hidden)
    );
}

function trackingIncomeTotal(
  state: LoadedMonthState,
  effectiveView: CellView
): number {
  if (effectiveView === "spent") return state.summary.totalIncome;

  const categories = visibleIncomeCategories(state);
  return effectiveView === "balance"
    ? categories.reduce((sum, category) => sum + category.balance, 0)
    : categories.reduce((sum, category) => sum + category.budgeted, 0);
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
  const groups = state.groupOrder
    .map((id) => state.groupsById[id])
    .filter((group) => !!group && (filter === "expense" ? !group.isIncome : group.isIncome));

  if (effectiveView === "spent") {
    return groups.reduce((sum, group) => sum + group.actuals, 0);
  }
  if (effectiveView === "balance") {
    return groups.reduce((sum, group) => sum + group.balance, 0);
  }
  return groups.reduce((sum, group) => sum + group.budgeted, 0);
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
