import type { Workspace } from "../models";

/**
 * Reuses `previous` rows (and whole tables) that are unchanged in `next`, so the derive caches keyed
 * on rows and table arrays (payments, plan ledgers, reviews) stay valid for every card a save didn't
 * touch. The server always returns a fresh copy of the whole workspace.
 */
export function shareWorkspace(previous: Workspace | undefined, next: Workspace): Workspace {
  if (!previous || previous === next) return next;
  const shared = {
    cards: shareRows(previous.cards, next.cards),
    statements: shareRows(previous.statements, next.statements),
    decisions: shareRows(previous.decisions, next.decisions),
    typeCorrections: shareRows(previous.typeCorrections, next.typeCorrections),
    plans: shareRows(previous.plans, next.plans),
    planEntries: shareRows(previous.planEntries, next.planEntries),
    planAccounts: shareRows(previous.planAccounts, next.planAccounts),
    limitChanges: shareRows(previous.limitChanges, next.limitChanges),
  } satisfies Workspace;
  const unchanged = (Object.keys(shared) as (keyof Workspace)[]).every((key) => shared[key] === previous[key]);
  return unchanged ? previous : { ...next, ...shared };
}

function shareRows<T>(previous: readonly T[], next: readonly T[]): T[] {
  const byValue = new Map<string, T>();
  for (const row of previous) byValue.set(JSON.stringify(row), row);
  let same = previous.length === next.length;
  const rows = next.map((row, index) => {
    const kept = byValue.get(JSON.stringify(row)) ?? row;
    if (kept !== previous[index]) same = false;
    return kept;
  });
  return same ? (previous as T[]) : rows;
}
