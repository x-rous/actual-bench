import type { Decision, PlanEntry, RepaymentPlan, TypeCorrection, Workspace } from "../models";

/**
 * Lookup indexes keyed on the immutable workspace arrays. Store writes replace the arrays,
 * so an index never outlives the data it describes.
 */
const EMPTY: readonly never[] = [];

function indexed<Entry, Key, Value>(
  cache: WeakMap<readonly Entry[], Map<Key, Value>>,
  entries: readonly Entry[],
  build: (index: Map<Key, Value>, entry: Entry) => void,
) {
  let index = cache.get(entries);
  if (!index) {
    index = new Map();
    for (const entry of entries) build(index, entry);
    cache.set(entries, index);
  }
  return index;
}

const correctionIndexes = new WeakMap<readonly TypeCorrection[], Map<string, TypeCorrection>>();
/** The user's saved type for a row, while its narrow identity is unchanged (D21). */
export function typeCorrectionFor(
  workspace: Pick<Workspace, "typeCorrections">,
  cardId: string,
  row: { id: string; identity: string },
) {
  const index = indexed(correctionIndexes, workspace.typeCorrections, (map, entry) => {
    map.set(`${entry.cardId}\u0000${entry.transactionId}`, entry);
  });
  const entry = index.get(`${cardId}\u0000${row.id}`);
  return entry && entry.identityHash === row.identity ? entry : undefined;
}

const entryIndexes = new WeakMap<readonly PlanEntry[], Map<string, PlanEntry[]>>();
/** Every saved plan entry for a transaction id, regardless of freshness. */
export function planEntriesFor(workspace: Pick<Workspace, "planEntries">, transactionId: string): readonly PlanEntry[] {
  const index = indexed(entryIndexes, workspace.planEntries, (map, entry) => {
    map.set(entry.transactionId, [...(map.get(entry.transactionId) ?? []), entry]);
  });
  return index.get(transactionId) ?? EMPTY;
}

/** The current plan entry for a row: its narrow identity still matches. */
export function currentPlanEntry(workspace: Pick<Workspace, "planEntries">, row: { id: string; identity: string }) {
  return planEntriesFor(workspace, row.id).find((entry) => entry.identityHash === row.identity);
}

const plansByEntry = new WeakMap<readonly PlanEntry[], WeakMap<readonly RepaymentPlan[], Map<string, RepaymentPlan>>>();
/** The plan a transaction belongs to through any entry (original, instalment, cost…). */
export function planForTransaction(workspace: Pick<Workspace, "plans" | "planEntries">, transactionId: string) {
  let byPlans = plansByEntry.get(workspace.planEntries);
  if (!byPlans) {
    byPlans = new WeakMap();
    plansByEntry.set(workspace.planEntries, byPlans);
  }
  let index = byPlans.get(workspace.plans);
  if (!index) {
    index = new Map();
    const plans = new Map(workspace.plans.map((plan) => [plan.id, plan]));
    for (const entry of workspace.planEntries) {
      const plan = plans.get(entry.planId);
      if (plan && !index.has(entry.transactionId)) index.set(entry.transactionId, plan);
    }
    byPlans.set(workspace.plans, index);
  }
  return index.get(transactionId);
}

const decisionIndexes = new WeakMap<readonly Decision[], Map<string, Decision[]>>();
/** Every saved decision for a transaction on a card, across statements. */
export function decisionsFor(decisions: readonly Decision[], cardId: string, transactionId: string): readonly Decision[] {
  const index = indexed(decisionIndexes, decisions, (map, entry) => {
    const key = `${entry.cardId}\u0000${entry.transactionId}`;
    map.set(key, [...(map.get(key) ?? []), entry]);
  });
  return index.get(`${cardId}\u0000${transactionId}`) ?? EMPTY;
}

/** Root of a scoped cache; create one per cached function with `new WeakMap()`. */
export type RowCacheRoot = WeakMap<object, unknown>;
/**
 * A per-row result cache scoped to every object the result depends on. Each key is an
 * immutable input (snapshot, card, workspace arrays); a missing input uses a shared sentinel.
 */
export function scopedRowCache<Row extends object, Value>(root: RowCacheRoot, keys: readonly (object | undefined)[]) {
  let level = root;
  for (const key of keys) {
    const scope = key ?? EMPTY;
    let next = level.get(scope) as RowCacheRoot | undefined;
    if (!next) {
      next = new WeakMap();
      level.set(scope, next);
    }
    level = next;
  }
  return level as unknown as WeakMap<Row, Value>;
}
