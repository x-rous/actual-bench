import type {
  BudgetTransactionCategoryOption,
  BudgetTransactionsDrilldown,
} from "../budgetTransactionBrowser";

/**
 * What the dialog's category scope means for the model and for the
 * Spending Analysis link.
 *
 * The scope is the one Spending Analysis uses: a drill-through target, which
 * the category picker can replace with any mix of groups and categories. Whole
 * side targets ("All expenses") carry ids that start with `__`; they mean every
 * category on that side under the mode's own hidden-category rule.
 */

export type VarianceScope = {
  /** Every category on the side, no explicit list. */
  wholeSide: boolean;
  categoryIds: string[];
  groupIds: string[];
};

export const optionKeyOf = (option: Pick<BudgetTransactionCategoryOption, "entity" | "id">) =>
  `${option.entity}:${option.id}`;

export function scopeFromTarget(target: BudgetTransactionsDrilldown): VarianceScope {
  if (target.id.startsWith("__")) return { wholeSide: true, categoryIds: [], groupIds: [] };
  if (target.entity === "group") {
    return { wholeSide: false, categoryIds: [...target.categoryIds], groupIds: [target.id] };
  }
  return { wholeSide: false, categoryIds: [...target.categoryIds], groupIds: [] };
}

/** The scope for a set of picker keys, or `null` when none of them resolve. */
export function scopeFromKeys(
  keys: readonly string[],
  options: readonly BudgetTransactionCategoryOption[]
): VarianceScope | null {
  const byKey = new Map(options.map((o) => [optionKeyOf(o), o]));
  const chosen = keys.map((k) => byKey.get(k)).filter((o): o is BudgetTransactionCategoryOption => !!o);
  if (chosen.length === 0) return null;
  if (chosen.some((o) => o.id.startsWith("__all_"))) {
    return { wholeSide: true, categoryIds: [], groupIds: [] };
  }
  const groupIds = chosen.filter((o) => o.entity === "group").map((o) => o.id);
  const categoryIds = chosen.filter((o) => o.entity === "category").map((o) => o.id);
  return { wholeSide: false, categoryIds, groupIds };
}

/**
 * The drill-through target for Spending Analysis, from the drivers on screen.
 * Only the category set, side, title and months can be carried over; week and
 * day ranges are not part of a target.
 */
export function spendingAnalysisTarget(args: {
  side: "expense" | "income";
  title: string;
  categoryIds: readonly string[];
  monthStart: string;
  monthEnd: string;
}): BudgetTransactionsDrilldown {
  return {
    id: `variance:${[...args.categoryIds].sort().join("|")}`,
    monthStart: args.monthStart,
    monthEnd: args.monthEnd,
    title: args.title,
    entity: args.categoryIds.length > 1 ? "group" : "category",
    side: args.side,
    categoryIds: [...args.categoryIds],
  };
}
