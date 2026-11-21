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
  StagedHold,
} from "../types";

export type ComputeEffectiveMonthStateInput = {
  serverState: LoadedMonthState | undefined;
  allEdits: Record<BudgetCellKey, StagedBudgetEdit>;
  isTracking: boolean;
  /** Map<month, Map<categoryId, budgeted>> from useIncomeBudgets. Tracking mode only. */
  incomeBudgets: Map<string, Map<string, number>> | undefined;
  month: string;
  /** Staged holds keyed by month — from the budgetEdits store. */
  stagedHolds?: Record<string, StagedHold>;
  /**
   * Envelope mode only: what staged edits in earlier months carry into this
   * month, computed by `computeEnvelopeCarry` with Actual's real rules. When
   * given it replaces the linear prior-month cascade below. Omit it (or pass
   * undefined) to keep the linear approximation.
   */
  envelopeCarry?: EnvelopeCarry;
};

/**
 * Change carried into one month by staged edits in earlier months (Envelope),
 * all in integer minor units.
 */
export type EnvelopeCarry = {
  /** Change to `fromLastMonth` (and so to `incomeAvailable`). */
  fromLastMonthDelta: number;
  /** Change to `lastMonthOverspent` (negative = more overspending charged). */
  lastMonthOverspentDelta: number;
  /** Change to each category's carried-in balance, keyed by category id. */
  categoryDeltas: Map<string, number>;
};

/**
 * Envelope (H1): staged edits carried forward the way Actual's envelope sheet
 * does it, month by month through `months` (chronological, consecutive):
 *
 *   leftover(M)          = budgeted(M) + spent(M) + carryIn(M)
 *   carryIn(M+1)         = carryover ? leftover(M) : max(0, leftover(M))
 *   lastMonthOverspent   = Σ non-carryover min(0, leftover(M))   (into M+1)
 *   fromLastMonth(M+1)   = toBudget(M) + buffered(M)
 *   toBudget(M)          = income + fromLastMonth + lastMonthOverspent
 *                          − budgeted(M) − buffered(M)
 *
 * So covering an overspend does not raise next month's balance, and a cut
 * below zero is charged to next month's To Budget as overspending, not
 * carried as a negative balance. Holds net out in the next month (To Budget
 * falls by the hold and `buffered` rises by it), so they are not carried.
 *
 * Edits before the first month in `months` cannot be replayed without their
 * months' data, so they enter the first month with the linear rule (full
 * delta to the balance and to To Budget), as before. A month whose server
 * state is missing is passed through the same way.
 */
export function computeEnvelopeCarry(
  months: string[],
  rawStates: (LoadedMonthState | undefined)[],
  allEdits: Record<BudgetCellKey, StagedBudgetEdit>
): Map<string, EnvelopeCarry> {
  const result = new Map<string, EnvelopeCarry>();
  if (months.length === 0) return result;

  // Staged change per month per category, against the server value.
  const editDeltas = new Map<string, Map<string, StagedBudgetEdit>>();
  for (const [key, edit] of Object.entries(allEdits)) {
    const editMonth = key.split(":")[0];
    if (!editMonth) continue;
    const catId = key.slice(editMonth.length + 1);
    let byCat = editDeltas.get(editMonth);
    if (!byCat) editDeltas.set(editMonth, (byCat = new Map()));
    byCat.set(catId, edit);
  }

  const firstMonth = months[0]!;
  const firstState = rawStates[0];
  let carry = new Map<string, number>();
  let fromLast = 0;
  for (const [key, edit] of Object.entries(allEdits)) {
    const editMonth = key.split(":")[0];
    if (!editMonth || editMonth >= firstMonth) continue;
    const catId = key.slice(editMonth.length + 1);
    const cat = firstState?.categoriesById[catId];
    if (cat?.isIncome) continue;
    const delta = edit.nextBudgeted - edit.previousBudgeted;
    fromLast -= delta;
    if (cat) carry.set(catId, (carry.get(catId) ?? 0) + delta);
  }
  let overspent = 0;

  for (let i = 0; i < months.length; i++) {
    const month = months[i]!;
    const state = rawStates[i];
    result.set(month, {
      fromLastMonthDelta: fromLast,
      lastMonthOverspentDelta: overspent,
      categoryDeltas: carry,
    });

    // Roll this month forward into the next one.
    const monthEdits = editDeltas.get(month);
    const nextCarry = new Map<string, number>();
    let nextOverspent = 0;
    let budgetedDelta = 0;
    const catIds = new Set<string>([...carry.keys(), ...(monthEdits?.keys() ?? [])]);
    for (const catId of catIds) {
      const cat = state?.categoriesById[catId];
      if (state && !cat) continue;
      if (cat?.isIncome) continue;
      const edit = monthEdits?.get(catId);
      // Layer 2 measures a staged edit against the cached server value.
      const staged = edit ? edit.nextBudgeted - (cat?.budgeted ?? edit.previousBudgeted) : 0;
      budgetedDelta += staged;
      const leftoverDelta = (carry.get(catId) ?? 0) + staged;
      if (leftoverDelta === 0) continue;
      if (!cat || cat.carryover) {
        nextCarry.set(catId, leftoverDelta);
        continue;
      }
      const before = cat.balance;
      const after = before + leftoverDelta;
      const carried = Math.max(0, after) - Math.max(0, before);
      if (carried !== 0) nextCarry.set(catId, carried);
      nextOverspent += Math.min(0, after) - Math.min(0, before);
    }
    fromLast = fromLast + overspent - budgetedDelta;
    overspent = nextOverspent;
    carry = nextCarry;
  }

  return result;
}

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
 *   Layer 3 — Per-category balance cascade:
 *     Envelope mode: all spending categories — the server always chains
 *       balance(M) = budgeted(M) + actuals(M) + balance(M−1), so a staged
 *       edit in any prior month shifts the effective balance of every later
 *       month by the same cumulative delta.
 *     Tracking mode: only categories with carryover === true.
 *     cascadeDelta(M, C) = Σ (nextBudgeted − previousBudgeted) for all
 *       staged edits for C in months < M.
 *     Updates category.balance, group.balance, summary.totalBalance.
 *     summary.toBudget is NOT touched here — the scalar priorDelta cascade
 *     above already adjusts it correctly.
 *
 * Returns the unmodified `serverState` when no layer changes anything (cheap
 * short-circuit) or `undefined` when no server state was provided.
 */
export function computeEffectiveMonthState(
  input: ComputeEffectiveMonthStateInput
): LoadedMonthState | undefined {
  const { serverState, allEdits, isTracking, incomeBudgets, month, stagedHolds } = input;
  if (!serverState || !month) return serverState;
  const envelopeCarry = isTracking ? undefined : input.envelopeCarry;

  const incomeBudgetForMonth = isTracking ? incomeBudgets?.get(month) : undefined;

  // ── Layer 2 prep: collect this month's edits ────────────────────────────────
  const prefix = `${month}:`;
  const editEntries = Object.entries(allEdits).filter(([k]) => k.startsWith(prefix));

  // ── Cascade: sum of deltas from edits in months strictly before this month ─
  // In Tracking mode, effectively-hidden category edits are excluded.
  let priorDelta = 0;
  for (const [key, edit] of envelopeCarry ? [] : Object.entries(allEdits)) {
    const editMonth = key.split(":")[0];
    if (!editMonth || editMonth >= month) continue;
    const catId = key.slice(editMonth.length + 1);
    const cat = serverState.categoriesById[catId];
    // Budgeting income is a forecast of money arriving, not an allocation of
    // money out, so it never consumes a later month's available-to-budget.
    // Mirrors the per-category cascade below and Layer 2's summary rule.
    if (cat?.isIncome) continue;
    if (isTracking) {
      const group = cat ? serverState.groupsById[cat.groupId] : undefined;
      if (cat?.hidden || group?.hidden) continue;
    }
    priorDelta += edit.nextBudgeted - edit.previousBudgeted;
  }

  // ── Per-category cascade: cumulative deltas from prior-month staged edits ──
  // Envelope mode: all spending categories (server always chains balance forward).
  // Tracking mode: only categories with carryover === true.
  const priorCatDeltas = new Map<string, number>(envelopeCarry?.categoryDeltas);
  for (const [key, edit] of envelopeCarry ? [] : Object.entries(allEdits)) {
    const editMonth = key.split(":")[0];
    if (!editMonth || editMonth >= month) continue;
    const catId = key.slice(editMonth.length + 1);
    const cat = serverState.categoriesById[catId];
    if (!cat) continue;
    if (isTracking && !cat.carryover) continue;
    if (cat.isIncome) continue;
    const prev = priorCatDeltas.get(catId) ?? 0;
    priorCatDeltas.set(catId, prev + (edit.nextBudgeted - edit.previousBudgeted));
  }

  const hasCatCascade = priorCatDeltas.size > 0;

  const stagedHold = stagedHolds?.[month];

  const carrySummaryChanges =
    !!envelopeCarry &&
    (envelopeCarry.fromLastMonthDelta !== 0 || envelopeCarry.lastMonthOverspentDelta !== 0);

  if (
    !incomeBudgetForMonth &&
    editEntries.length === 0 &&
    priorDelta === 0 &&
    !carrySummaryChanges &&
    !hasCatCascade &&
    !stagedHold
  ) {
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
  if (envelopeCarry && carrySummaryChanges) {
    summary.fromLastMonth += envelopeCarry.fromLastMonthDelta;
    summary.incomeAvailable += envelopeCarry.fromLastMonthDelta;
    summary.lastMonthOverspent += envelopeCarry.lastMonthOverspentDelta;
    summary.toBudget +=
      envelopeCarry.fromLastMonthDelta + envelopeCarry.lastMonthOverspentDelta;
  }

  // ── Apply Layer 1 ──────────────────────────────────────────────────────────
  if (incomeBudgetForMonth) {
    const incomeGroupBudgetDelta = new Map<string, number>();
    // BM-09: the reflect_budgets fallback may only fill income categories whose
    // monthly `budgeted` was absent — it must never overwrite a canonical value
    // the month payload already carried (Actual 26.8+). `undefined` = unknown,
    // which preserves the legacy overlay-all behaviour for older payloads.
    const fallbackIds = serverState.incomeBudgetFallbackIds;
    const needsFallback = (catId: string) =>
      fallbackIds == null || fallbackIds.includes(catId);

    for (const [catId, budgeted] of incomeBudgetForMonth) {
      const serverCat = serverState.categoriesById[catId];
      if (!serverCat?.isIncome) continue;
      if (!needsFallback(catId)) continue;
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

    // `summary.totalBudgeted`/`totalBalance` are the *expense* aggregates the
    // grid renders as "Total Budgeted Expenses" and "Total Expense Balance",
    // and `toBudget` is what an allocation consumes. An income category
    // contributes to none of them: its own totals are derived separately from
    // `categoriesById` (monthAuthority's trackingIncome* selectors), which the
    // edit above has already updated. Layer 1 states the same rule for the
    // income-budget fallback; this is that rule applied to staged edits.
    if (!baseCat.isIncome && !(isTracking && effectivelyHidden)) {
      summary.totalBudgeted -= delta;
      summary.totalBalance += delta;
      summary.toBudget -= delta;
    }
  }

  // ── Layer 3: Per-category balance cascade ──────────────────────────────────
  for (const [catId, cascadeDelta] of priorCatDeltas) {
    if (cascadeDelta === 0) continue;

    const currentCat = categoriesById[catId] ?? serverState.categoriesById[catId];
    if (!currentCat) continue;

    categoriesById[catId] = {
      ...currentCat,
      balance: currentCat.balance + cascadeDelta,
    };

    const groupId = currentCat.groupId;
    const currentGroup = groupsById[groupId] ?? serverState.groupsById[groupId];

    if (currentGroup) {
      const effectivelyHidden = currentCat.hidden || currentGroup.hidden;
      // Mirror Layer 2's skip rule: hidden cat inside a visible group must not
      // pollute the visible group's aggregate in Tracking mode.
      const skipGroupUpdate = isTracking && effectivelyHidden && !currentGroup.hidden;

      if (!skipGroupUpdate) {
        groupsById[groupId] = {
          ...currentGroup,
          balance: currentGroup.balance + cascadeDelta,
        };
      }

      if (!(isTracking && effectivelyHidden)) {
        summary.totalBalance += cascadeDelta;
      }
    }
  }

  // ── Hold overlay: staged hold for month M only ─────────────────────────────
  // forNextMonth on the server is a positive integer (0 = no hold).
  // nextAmount/previousAmount use the same convention.
  if (stagedHold) {
    const holdDelta = stagedHold.nextAmount - serverState.summary.forNextMonth;
    if (holdDelta !== 0) {
      summary.forNextMonth = stagedHold.nextAmount;
      summary.toBudget -= holdDelta;
    }
  }

  return {
    summary,
    groupsById,
    categoriesById,
    groupOrder: serverState.groupOrder,
    // Carry the income-budget provenance forward so the effective state stays a
    // faithful superset of the server state (BM-09).
    incomeBudgetFallbackIds: serverState.incomeBudgetFallbackIds,
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
