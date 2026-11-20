import type { ReconciliationItem } from "@/lib/reconciliation/types";

/**
 * What changed between two versions of a session's items, by id.
 *
 * Picking a candidate or linking two rows touches a handful of items, and used
 * to rewrite every item in the session — snapshots and all — to say so.
 * Unchanged items are recognised by identity, which is what the session's
 * immutable updates preserve.
 */
export function diffItems(before: ReconciliationItem[], after: ReconciliationItem[]) {
  const previous = new Map(before.map((item) => [item.id, item]));
  const next = new Set(after.map((item) => item.id));
  return {
    changed: after.filter((item) => previous.has(item.id) && previous.get(item.id) !== item),
    added: after.filter((item) => !previous.has(item.id)),
    removedIds: before.filter((item) => !next.has(item.id)).map((item) => item.id),
  };
}
