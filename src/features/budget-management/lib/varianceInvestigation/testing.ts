import type {
  BudgetMonthSummary,
  LoadedCategory,
  LoadedGroup,
  LoadedMonthState,
} from "../../types";

/** Test fixtures for the variance investigation modules. Not shipped code. */

export type CategorySpec = {
  id: string;
  name?: string;
  group?: string;
  hidden?: boolean;
  income?: boolean;
  /** As the payload gives it: negative for Tracking expenses, positive elsewhere. */
  budgeted: number;
  /** As the payload gives it: negative spending, positive received. */
  actuals: number;
  balance?: number;
  carryover?: boolean;
};

export function makeState(
  specs: CategorySpec[],
  options: { hiddenGroups?: string[] } = {}
): LoadedMonthState {
  const categoriesById: Record<string, LoadedCategory> = {};
  const groups = new Map<string, LoadedGroup>();
  for (const spec of specs) {
    const groupId = spec.group ?? "g1";
    const category: LoadedCategory = {
      id: spec.id,
      name: spec.name ?? spec.id,
      groupId,
      groupName: `Group ${groupId}`,
      isIncome: spec.income ?? false,
      hidden: spec.hidden ?? false,
      budgeted: spec.budgeted,
      actuals: spec.actuals,
      balance: spec.balance ?? Math.abs(spec.budgeted) + spec.actuals,
      carryover: spec.carryover ?? false,
    };
    categoriesById[spec.id] = category;
    const group = groups.get(groupId) ?? {
      id: groupId,
      name: `Group ${groupId}`,
      isIncome: spec.income ?? false,
      hidden: options.hiddenGroups?.includes(groupId) ?? false,
      categoryIds: [],
      budgeted: 0,
      actuals: 0,
      balance: 0,
    };
    group.categoryIds.push(spec.id);
    groups.set(groupId, group);
  }
  return {
    summary: {} as BudgetMonthSummary,
    groupsById: Object.fromEntries(groups),
    categoriesById,
    groupOrder: [...groups.keys()],
  };
}

export function statesFor(
  byMonth: Record<string, CategorySpec[]>,
  options: { hiddenGroups?: string[] } = {}
): Map<string, LoadedMonthState> {
  return new Map(
    Object.entries(byMonth).map(([month, specs]) => [month, makeState(specs, options)])
  );
}
