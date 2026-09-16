import { monthsInRange } from "@/lib/budget/monthMath";
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
  /**
   * First month of the range the figure covers, `YYYY-MM`.
   *
   * A drill-through from a single month sets both ends to it; one from a period
   * figure spans its months, so the dialog can total the same number that was
   * clicked rather than a slice of it.
   */
  monthStart: string;
  /** Last month of the range, inclusive. */
  monthEnd: string;
  title: string;
  entity: BudgetTransactionEntity;
  side: BudgetTransactionSide;
  categoryIds: string[];
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
 * figures. Built for one month, which is a range whose ends match.
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
    monthStart: month,
    monthEnd: month,
    title: wantIncome ? "All income" : "All expenses",
    entity: "group",
    side: wantIncome ? "income" : "expense",
    categoryIds,
  };
}

/**
 * The months a set of entries actually contributes, or null if they have a hole
 * in them.
 *
 * A drilldown says only where a range starts and ends, so a gap in the middle
 * cannot be expressed: the query asks for every transaction between the two
 * dates and would sweep up the months that were skipped. That makes the
 * dialog's total disagree with the figure it was opened from, silently. An
 * interior month with no loaded state is rare - a window still loading, or one
 * month that failed - and withholding the drill-through is better than opening
 * it on the wrong number.
 */
function contiguousSpan(
  entries: { month: string; state?: LoadedMonthState | null }[]
): { first: string; last: string } | null {
  const months = entries.filter((entry) => entry.state != null).map((entry) => entry.month);
  const first = months[0];
  const last = months[months.length - 1];
  if (!first || !last) return null;
  return monthsInRange(first, last).length === months.length ? { first, last } : null;
}

/**
 * Drill target for every expense (or income) category across a range of months
 * - powers the full-period summary's "Expenses spent" / "Income received"
 * figures.
 *
 * The range is the months the figure itself covers, not the whole window: those
 * headlines are "to date" totals over the closed months, and a drill-through
 * spanning months the figure excluded would open on a number that disagreed
 * with the one clicked.
 *
 * Categories are unioned across the range rather than read from one month. A
 * category created midway through the year exists in later months only, and
 * taking the last month alone would silently drop anything retired before it.
 *
 * Hidden categories are left out, even though the headline this opens from -
 * the month's own `summary` totals - counts them. Including them to make the
 * two spend figures agree was tried and was worse: a hidden category keeps its
 * budget, so the dialog's Budgeted figure grew by everything the user had put
 * out of sight and the variance beside it read better than reality. Matching
 * the spend cost the comparison, which is the more useful of the two, and this
 * is the set every other view of the budget shows.
 */
export function buildRangeCategoriesDrilldown(
  entries: { month: string; state?: LoadedMonthState | null }[],
  kind: "expense" | "income"
): BudgetTransactionsDrilldown | null {
  const span = contiguousSpan(entries);
  if (!span) return null;

  const wantIncome = kind === "income";
  const categoryIds = new Set<string>();

  for (const entry of entries) {
    const state = entry.state;
    if (!state) continue;
    for (const groupId of state.groupOrder) {
      const group = state.groupsById[groupId];
      if (!group || group.isIncome !== wantIncome) continue;
      if (group.hidden) continue;
      for (const categoryId of group.categoryIds) {
        const category = state.categoriesById[categoryId];
        if (!category || category.isIncome !== wantIncome) continue;
        if (category.hidden) continue;
        categoryIds.add(categoryId);
      }
    }
  }

  if (categoryIds.size === 0) return null;
  return {
    id: wantIncome ? "__period_income__" : "__period_expenses__",
    monthStart: span.first,
    monthEnd: span.last,
    title: wantIncome ? "All income" : "All expenses",
    entity: "group",
    side: wantIncome ? "income" : "expense",
    categoryIds: [...categoryIds],
  };
}

export function buildBudgetTransactionBrowserOptions(
  model: BudgetDetailsModel
): BudgetTransactionBrowserOptions {
  const categories: BudgetTransactionCategoryOption[] = [];
  const seen = new Set<string>();
  // Every visible category on each side, for the whole-side options below.
  const allBySide: Record<BudgetTransactionSide, Set<string>> = {
    expense: new Set<string>(),
    income: new Set<string>(),
  };

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
        allBySide[category.isIncome ? "income" : "expense"].add(category.id);

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

  /*
   * "All expenses" and "All income", at the top of the list.
   *
   * A drill-through from a month's own expense figure already reports on every
   * category at once, so the view existed - there was just no way to ask for it
   * from inside the dialog. Reaching it meant closing, finding the right figure
   * on the page behind, and clicking that instead.
   *
   * Placed ahead of the real groups because it is the widest selection on
   * offer, and the list reads outside-in from there.
   */
  const wholeSide: BudgetTransactionCategoryOption[] = [];
  for (const side of ["expense", "income"] as const) {
    const ids = [...allBySide[side]];
    if (ids.length === 0) continue;
    wholeSide.push({
      id: side === "income" ? "__all_income__" : "__all_expenses__",
      entity: "group",
      side,
      title: side === "income" ? "All income" : "All expenses",
      subtitle: side === "income" ? "Every income category" : "Every expense category",
      categoryIds: ids,
    });
  }

  return { categories: [...wholeSide, ...categories] };
}
