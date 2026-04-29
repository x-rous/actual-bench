/**
 * Pure helpers extracted from useEffectiveMonthData.
 *
 * `computeEffectiveMonthState` applies the three-layer cascade (prior-month
 * carry-forward, income budgets in tracking mode, staged edits) to a single
 * month's server state. Pure so it's testable and so it can be invoked once
 * per month at a single call-site instead of per-cell.
 */

import type {
  BudgetCellKey,
  LoadedCategory,
  LoadedGroup,
  LoadedMonthState,
  StagedBudgetEdit,
} from "../types";

export type ComputeEffectiveMonthStateInput = {
  serverState: LoadedMonthState | undefined;
  allEdits: Record<BudgetCellKey, StagedBudgetEdit>;
  isTracking: boolean;
  /** Map<month, Map<categoryId, budgeted>> from useIncomeBudgets. Tracking mode only. */
  incomeBudgets: Map<string, Map<string, number>> | undefined;
  month: string;
};

/**
 * Returns the effective month state for `month` after applying:
 *
 *   Cascade — Prior-month carry-forward (all modes):
 *     priorDelta = Σ (nextBudgeted − previousBudgeted) for edits in months < M
 *     summary.incomeAvailable −= priorDelta
 *     summary.toBudget        −= priorDelta
 *
 *   Layer 1 — Income budgets (Tracking mode only):
 *     Income category `budgeted` values come from the reflect_budgets query.
 *     The summary totals are NOT touched (the API summary is correct).
 *
 *   Layer 2 — Staged edits:
 *     delta = edit.nextBudgeted − baselineBudgeted (after Layer 1)
 *     Updates category, group, and summary totals. Tracking-mode hidden
 *     categories are excluded from the summary updates.
 *
 * Returns the unmodified `serverState` when no layer changes anything (cheap
 * short-circuit) or `undefined` when no server state was provided.
 */
export function computeEffectiveMonthState(
  input: ComputeEffectiveMonthStateInput
): LoadedMonthState | undefined {
  const { serverState, allEdits, isTracking, incomeBudgets, month } = input;
  if (!serverState || !month) return serverState;

  const incomeBudgetForMonth = isTracking ? incomeBudgets?.get(month) : undefined;

  // ── Layer 2 prep: collect this month's edits ────────────────────────────────
  const prefix = `${month}:`;
  const editEntries = Object.entries(allEdits).filter(([k]) => k.startsWith(prefix));

  // ── Cascade: sum of deltas from edits in months strictly before this month ─
  // In Tracking mode, effectively-hidden category edits are excluded.
  let priorDelta = 0;
  for (const [key, edit] of Object.entries(allEdits)) {
    const editMonth = key.split(":")[0];
    if (!editMonth || editMonth >= month) continue;
    if (isTracking) {
      const catId = key.slice(editMonth.length + 1);
      const cat = serverState.categoriesById[catId];
      const group = cat ? serverState.groupsById[cat.groupId] : undefined;
      if (cat?.hidden || group?.hidden) continue;
    }
    priorDelta += edit.nextBudgeted - edit.previousBudgeted;
  }

  if (!incomeBudgetForMonth && editEntries.length === 0 && priorDelta === 0) {
    return serverState;
  }

  // Shallow-clone the structures we will mutate.
  const summary = { ...serverState.summary };
  const groupsById: Record<string, LoadedGroup> = { ...serverState.groupsById };
  const categoriesById: Record<string, LoadedCategory> = { ...serverState.categoriesById };

  // ── Apply cascade ──────────────────────────────────────────────────────────
  if (priorDelta !== 0) {
    summary.incomeAvailable -= priorDelta;
    summary.toBudget -= priorDelta;
  }

  // ── Apply Layer 1 ──────────────────────────────────────────────────────────
  if (incomeBudgetForMonth) {
    const incomeGroupBudgetDelta = new Map<string, number>();

    for (const [catId, budgeted] of incomeBudgetForMonth) {
      const serverCat = serverState.categoriesById[catId];
      if (!serverCat?.isIncome) continue;
      if (serverCat.budgeted === budgeted) continue;
      const delta = budgeted - serverCat.budgeted;

      categoriesById[catId] = {
        ...serverCat,
        budgeted,
        balance: serverCat.balance + delta,
      };

      const prev = incomeGroupBudgetDelta.get(serverCat.groupId) ?? 0;
      incomeGroupBudgetDelta.set(serverCat.groupId, prev + delta);
    }

    for (const [groupId, delta] of incomeGroupBudgetDelta) {
      const existing = groupsById[groupId] ?? serverState.groupsById[groupId];
      if (existing) {
        groupsById[groupId] = {
          ...existing,
          budgeted: existing.budgeted + delta,
          balance: existing.balance + delta,
        };
      }
    }
    // summary.totalBudgeted is NOT updated — API summary is correct in Tracking mode.
  }

  // ── Apply Layer 2 ──────────────────────────────────────────────────────────
  for (const [key, edit] of editEntries) {
    const catId = key.slice(prefix.length);
    const baseCat = categoriesById[catId] ?? serverState.categoriesById[catId];
    if (!baseCat) continue;

    const delta = edit.nextBudgeted - baseCat.budgeted;
    if (delta === 0) continue;

    categoriesById[catId] = {
      ...baseCat,
      budgeted: edit.nextBudgeted,
      balance: baseCat.balance + delta,
    };

    const groupId = baseCat.groupId;
    const existingGroup = groupsById[groupId] ?? serverState.groupsById[groupId];

    // A category is effectively hidden if its own flag is set OR its parent group is.
    const effectivelyHidden = baseCat.hidden || (existingGroup?.hidden ?? false);

    // In Tracking mode, an effectively-hidden category only propagates to its group
    // when the group itself is also hidden. A hidden category inside a visible group
    // must not pollute the visible group's aggregate.
    const skipGroupUpdate =
      isTracking && effectivelyHidden && !(existingGroup?.hidden ?? false);

    if (!skipGroupUpdate && existingGroup) {
      groupsById[groupId] = {
        ...existingGroup,
        budgeted: existingGroup.budgeted + delta,
        balance: existingGroup.balance + delta,
      };
    }

    if (!(isTracking && effectivelyHidden)) {
      summary.totalBudgeted -= delta;
      summary.totalBalance += delta;
      summary.toBudget -= delta;
    }
  }

  return {
    summary,
    groupsById,
    categoriesById,
    groupOrder: serverState.groupOrder,
  };
}

// ─── Cross-month structure merge (BM-13) ──────────────────────────────────────

/**
 * Merges multiple month states into a single structural view: union of groups
 * and categories ordered by first appearance.
 *
 * Used so the grid and workspace can navigate / select / paste against the
 * union of categories that ever appear in the visible window — a category
 * added mid-year is still reachable in months where it's missing (it renders
 * as an empty cell with a hover tooltip).
 *
 * Returns null when no states have data.
 */
export type MergedStructure = {
  groupOrder: string[];
  groupsById: Record<string, LoadedGroup>;
  categoriesById: Record<string, LoadedCategory>;
};

export function mergeMonthStates(
  states: (LoadedMonthState | undefined)[]
): MergedStructure | null {
  let any = false;
  const groupOrder: string[] = [];
  const groupSeen = new Set<string>();
  const groupsById: Record<string, LoadedGroup> = {};
  const categoriesById: Record<string, LoadedCategory> = {};
  // Track which catIds have been added per group so we can preserve ordering.
  const groupCatSeen: Record<string, Set<string>> = {};
  const groupCatLists: Record<string, string[]> = {};

  for (const state of states) {
    if (!state) continue;
    any = true;
    for (const groupId of state.groupOrder) {
      const group = state.groupsById[groupId];
      if (!group) continue;
      if (!groupSeen.has(groupId)) {
        groupSeen.add(groupId);
        groupOrder.push(groupId);
        groupsById[groupId] = group;
        groupCatSeen[groupId] = new Set();
        groupCatLists[groupId] = [];
      }
      const seenSet = groupCatSeen[groupId]!;
      const list = groupCatLists[groupId]!;
      for (const catId of group.categoryIds) {
        if (seenSet.has(catId)) continue;
        seenSet.add(catId);
        list.push(catId);
        const cat = state.categoriesById[catId];
        if (cat && !categoriesById[catId]) {
          categoriesById[catId] = cat;
        }
      }
    }
  }

  if (!any) return null;

  // Replace each group's categoryIds with the merged ordered union.
  for (const groupId of groupOrder) {
    const group = groupsById[groupId]!;
    groupsById[groupId] = { ...group, categoryIds: groupCatLists[groupId] ?? [] };
  }

  return { groupOrder, groupsById, categoriesById };
}
