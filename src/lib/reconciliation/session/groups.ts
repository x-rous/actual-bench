import type { ActualTransactionSnapshot, ReconciliationItem } from "../types";
import { transactionOwners } from "./build";

export type MatchingGroup = { itemIds: string[]; transactionIds: string[] };

/** Remaining connected candidate components, derived in O(items + edges). */
export function matchingGroups(
  items: ReconciliationItem[],
  transactions: Map<string, ActualTransactionSnapshot>
): MatchingGroup[] {
  const claimed = transactionOwners(items);
  const rows = new Map(items.filter((item) => item.disposition === "unresolved" &&
    item.statementRowIds.length === 1).map((item) => [item.id, item]));
  const owners = new Map<string, string[]>();
  for (const item of rows.values()) for (const id of item.actualTransactionIds) {
    if (claimed.has(id) || !transactions.has(id)) continue;
    const ids = owners.get(id) ?? [];
    ids.push(item.id);
    owners.set(id, ids);
  }
  const seen = new Set<string>();
  const groups: MatchingGroup[] = [];
  for (const seed of rows.keys()) {
    if (seen.has(seed)) continue;
    const itemIds: string[] = [];
    const transactionIds = new Set<string>();
    const queue = [seed];
    seen.add(seed);
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const id = queue[cursor];
      itemIds.push(id);
      for (const transactionId of rows.get(id)!.actualTransactionIds) {
        if (!owners.has(transactionId) || transactionIds.has(transactionId)) continue;
        transactionIds.add(transactionId);
        for (const owner of owners.get(transactionId)!) if (!seen.has(owner)) {
          seen.add(owner);
          queue.push(owner);
        }
      }
    }
    if (transactionIds.size > 0 && (itemIds.length > 1 || transactionIds.size > 1)) {
      groups.push({ itemIds, transactionIds: [...transactionIds] });
    }
  }
  return groups;
}
