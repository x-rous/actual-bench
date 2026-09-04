/**
 * Split-transaction rules.
 *
 * Actual expresses splits entirely through `options` on actions — there is no separate
 * structure. `options.splitIndex` is absent or `0` for the parent transaction and `1..n` for
 * split child *n*; each child group is seeded by exactly one `set-split-amount` action whose
 * `options.method` says how that child's amount is derived:
 *
 *   fixed-amount   value is a money amount for this child
 *   fixed-percent  value is a percent of what remains after the fixed amounts
 *   formula        options.formula computes the amount
 *   remainder      an equal share of whatever is left
 *
 * The engine applies them in that order (`execSplitActions`), pushing the rounding residue onto
 * the last remainder child. Bench does not execute rules, so it only needs to keep the record
 * well-formed: indices dense, one `set-split-amount` per child, parent-only fields kept out.
 *
 * Actions stay a flat list here, as they are on the wire. Grouping is a view for rendering.
 */

import type { ConditionOrAction, RuleAllocationMethod, RuleOptions } from "@/types/entities";

export const SPLIT_AMOUNT_OP = "set-split-amount";

export type SplitGroup<T> = {
  /** 0 = the parent transaction, 1..n = split child n. */
  index: number;
  items: T[];
};

export function isSplitAmountAction(action: ConditionOrAction): boolean {
  return action.op === SPLIT_AMOUNT_OP;
}

/** The transaction an action targets. Absent and 0 mean the same thing: the parent. */
export function splitIndexOf(action: ConditionOrAction): number {
  const index = action.options?.splitIndex;
  return typeof index === "number" && Number.isInteger(index) && index > 0 ? index : 0;
}

/** True when the rule splits the transaction at all. */
export function isSplitRule(actions: readonly ConditionOrAction[]): boolean {
  return actions.some((a) => isSplitAmountAction(a) || splitIndexOf(a) > 0);
}

/** How many split children the rule declares (0 when it is not a split rule). */
export function splitCount(actions: readonly ConditionOrAction[]): number {
  return actions.reduce((max, a) => Math.max(max, splitIndexOf(a)), 0);
}

/**
 * Group items by the split they belong to, densely: group 0 is always present, and a gap in the
 * stored indices becomes an empty group rather than a hole, so callers can render and validate
 * without special-casing malformed data.
 */
export function groupBySplitIndex<T>(
  items: readonly T[],
  getAction: (item: T) => ConditionOrAction
): SplitGroup<T>[] {
  const max = items.reduce((acc, item) => Math.max(acc, splitIndexOf(getAction(item))), 0);
  const groups: SplitGroup<T>[] = Array.from({ length: max + 1 }, (_, index) => ({
    index,
    items: [],
  }));
  for (const item of items) {
    groups[splitIndexOf(getAction(item))].items.push(item);
  }
  return groups;
}

export function groupActionsBySplitIndex(
  actions: readonly ConditionOrAction[]
): SplitGroup<ConditionOrAction>[] {
  return groupBySplitIndex(actions, (a) => a);
}

/**
 * Set (or clear) an action's split index, leaving the rest of `options` untouched. Index 0 drops
 * the key entirely, which is the shape Actual writes for parent actions.
 */
export function withSplitIndex(action: ConditionOrAction, index: number): ConditionOrAction {
  const rest: RuleOptions = { ...(action.options ?? {}) };
  delete rest.splitIndex;
  if (index > 0) rest.splitIndex = index;
  if (Object.keys(rest).length === 0) {
    const withoutOptions = { ...action };
    delete withoutOptions.options;
    return withoutOptions;
  }
  return { ...action, options: rest };
}

/** A freshly seeded split child, matching Actual's `addActionToSplitAfterIndex`. */
export function makeSplitAmountAction(
  splitIndex: number,
  method: RuleAllocationMethod = "remainder"
): ConditionOrAction {
  return {
    op: SPLIT_AMOUNT_OP,
    value: null,
    type: "number",
    options: { method, splitIndex },
  };
}

/** The index a newly added split child should take. */
export function nextSplitIndex(actions: readonly ConditionOrAction[]): number {
  return splitCount(actions) + 1;
}

/**
 * Remove one split child and renumber the ones above it, so indices stay dense.
 * Removing group 0 is not meaningful and is a no-op — the parent group always exists.
 */
export function removeSplitGroup(
  actions: readonly ConditionOrAction[],
  removedIndex: number
): ConditionOrAction[] {
  if (removedIndex <= 0) return [...actions];
  const kept: ConditionOrAction[] = [];
  for (const action of actions) {
    const index = splitIndexOf(action);
    if (index === removedIndex) continue;
    kept.push(index > removedIndex ? withSplitIndex(action, index - 1) : action);
  }
  return kept;
}

/**
 * Renumber every action so the split indices are dense and start at 1, preserving their relative
 * order. Used when reading a rule whose stored indices have gaps.
 */
export function normalizeSplitIndices(
  actions: readonly ConditionOrAction[]
): ConditionOrAction[] {
  const present = [...new Set(actions.map(splitIndexOf))].filter((i) => i > 0).sort((a, b) => a - b);
  if (present.every((value, i) => value === i + 1)) return [...actions];
  const remap = new Map(present.map((value, i) => [value, i + 1]));
  return actions.map((action) => {
    const index = splitIndexOf(action);
    return index > 0 ? withSplitIndex(action, remap.get(index) ?? index) : action;
  });
}
