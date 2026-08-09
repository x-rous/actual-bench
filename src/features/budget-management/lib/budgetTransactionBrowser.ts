import { formatMonthLabel } from "@/lib/budget/monthMath";
import type { BudgetDetailsModel } from "./budgetDetailsModel";
import type { LoadedMonthState } from "../types";

export type BudgetTransactionEntity = "category" | "group";

/**
 * Which side of the ledger a drill-through describes. Expense activity is an
 * outflow (negative amounts), income activity is an inflow (positive amounts).
 * The analytics and the dialog read this to present figures in the natural
 * direction instead of forcing everything through the expense/"spent" lens
 * (BM-04).
 */
export type BudgetTransactionSide = "income" | "expense";

export type BudgetTransactionsDrilldown = {
  id: string;
  month: string;
  title: string;
  entity: BudgetTransactionEntity;
  side: BudgetTransactionSide;
  categoryIds: string[];
};

export type BudgetTransactionMonthOption = {
  month: string;
  label: string;
};

export type BudgetTransactionCategoryOption = {
  id: string;
  entity: BudgetTransactionEntity;
  side: BudgetTransactionSide;
  title: string;
  subtitle: string;
  categoryIds: string[];
};

export type BudgetTransactionBrowserOptions = {
  months: BudgetTransactionMonthOption[];
  categories: BudgetTransactionCategoryOption[];
};

function transactionOptionKey(
  entity: BudgetTransactionEntity,
  id: string
): string {
  return `${entity}:${id}`;
}

function collectVisibleCategoryIds(
  model: BudgetDetailsModel,
  groupId: string,
  wantIncome: boolean
): string[] {
  const ids = new Set<string>();

  for (const entry of model.months) {
    const state = entry.state;
    const group = state?.groupsById[groupId];
    if (!state || !group || group.hidden || group.isIncome !== wantIncome) continue;

    for (const categoryId of group.categoryIds) {
      const category = state.categoriesById[categoryId];
      if (!category || category.hidden || category.isIncome !== wantIncome) continue;
      ids.add(categoryId);
    }
  }

  return [...ids];
}

/**
 * Drill target for every visible expense (or income) category in a single
 * month — powers the whole-month summary's "Expenses spent" / "Income received"
 * figures. Single-month only; period aggregates are deliberately not drillable.
 */
export function buildMonthCategoriesDrilldown(
  state: LoadedMonthState,
  month: string,
  kind: "expense" | "income"
): BudgetTransactionsDrilldown | null {
  const wantIncome = kind === "income";
  const categoryIds: string[] = [];

  for (const groupId of state.groupOrder) {
    const group = state.groupsById[groupId];
    if (!group || group.hidden || group.isIncome !== wantIncome) continue;
    for (const categoryId of group.categoryIds) {
      const category = state.categoriesById[categoryId];
      if (!category || category.hidden || category.isIncome !== wantIncome) {
        continue;
      }
      categoryIds.push(categoryId);
    }
  }

  if (categoryIds.length === 0) return null;
  return {
    id: wantIncome ? "__month_income__" : "__month_expenses__",
    month,
    title: wantIncome ? "All income" : "All expenses",
    entity: "group",
    side: wantIncome ? "income" : "expense",
    categoryIds,
  };
}

export function buildBudgetTransactionBrowserOptions(
  model: BudgetDetailsModel
): BudgetTransactionBrowserOptions {
  const months = model.displayMonths.map((month) => ({
    month,
    label: formatMonthLabel(month, "short"),
  }));
  const categories: BudgetTransactionCategoryOption[] = [];
  const seen = new Set<string>();

  for (const entry of model.months) {
    const state = entry.state;
    if (!state) continue;

    for (const groupId of state.groupOrder) {
      const group = state.groupsById[groupId];
      if (!group || group.hidden) continue;
      const side: BudgetTransactionSide = group.isIncome ? "income" : "expense";

      const groupKey = transactionOptionKey("group", group.id);
      if (!seen.has(groupKey)) {
        const categoryIds = collectVisibleCategoryIds(model, group.id, group.isIncome);
        if (categoryIds.length > 0) {
          categories.push({
            id: group.id,
            entity: "group",
            side,
            title: group.name,
            subtitle: group.isIncome ? "Income group" : "Expense group",
            categoryIds,
          });
          seen.add(groupKey);
        }
      }

      for (const categoryId of group.categoryIds) {
        const category = state.categoriesById[categoryId];
        if (!category || category.hidden) continue;

        const categoryKey = transactionOptionKey("category", category.id);
        if (seen.has(categoryKey)) continue;
        categories.push({
          id: category.id,
          entity: "category",
          side: category.isIncome ? "income" : "expense",
          title: category.name,
          subtitle: category.groupName,
          categoryIds: [category.id],
        });
        seen.add(categoryKey);
      }
    }
  }

  return { months, categories };
}
