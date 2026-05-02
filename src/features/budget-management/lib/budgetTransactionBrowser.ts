import { formatMonthLabel } from "@/lib/budget/monthMath";
import type { BudgetDetailsModel } from "./budgetDetailsModel";

export type BudgetTransactionEntity = "category" | "group";

export type BudgetTransactionsDrilldown = {
  id: string;
  month: string;
  title: string;
  entity: BudgetTransactionEntity;
  categoryIds: string[];
};

export type BudgetTransactionMonthOption = {
  month: string;
  label: string;
};

export type BudgetTransactionCategoryOption = {
  id: string;
  entity: BudgetTransactionEntity;
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

function collectVisibleExpenseCategoryIds(
  model: BudgetDetailsModel,
  groupId: string
): string[] {
  const ids = new Set<string>();

  for (const entry of model.months) {
    const state = entry.state;
    const group = state?.groupsById[groupId];
    if (!state || !group || group.hidden || group.isIncome) continue;

    for (const categoryId of group.categoryIds) {
      const category = state.categoriesById[categoryId];
      if (!category || category.hidden || category.isIncome) continue;
      ids.add(categoryId);
    }
  }

  return [...ids];
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
      if (!group || group.hidden || group.isIncome) continue;

      const groupKey = transactionOptionKey("group", group.id);
      if (!seen.has(groupKey)) {
        const categoryIds = collectVisibleExpenseCategoryIds(model, group.id);
        if (categoryIds.length > 0) {
          categories.push({
            id: group.id,
            entity: "group",
            title: group.name,
            subtitle: "Expense group",
            categoryIds,
          });
          seen.add(groupKey);
        }
      }

      for (const categoryId of group.categoryIds) {
        const category = state.categoriesById[categoryId];
        if (!category || category.hidden || category.isIncome) continue;

        const categoryKey = transactionOptionKey("category", category.id);
        if (seen.has(categoryKey)) continue;
        categories.push({
          id: category.id,
          entity: "category",
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
