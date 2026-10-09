import { ACCOUNT_CLASS_INFO, accountClassLabel, type AccountClass, type EffectiveAccountClass } from "@/lib/account-class";
import type { AccountGroup } from "@/types/entities";

export type GroupBy = "none" | "group" | "class";

export type AccountCluster<R> = {
  /** Unique within one grouping: a group id or class value, or NO_CLUSTER for the leftover. */
  key: string;
  label: string;
  /** Set for a group cluster; null for "No group". */
  groupId: string | null;
  /** Set for a class cluster; null for "Unclassified". */
  accountClass: AccountClass | null;
  rows: R[];
  /** Sum of the balances of the cluster's live accounts, in minor units; null when none has a balance. */
  subtotalCents: number | null;
};

/** Key of the cluster that holds accounts with no group, or no class. */
export const NO_CLUSTER = "__none__";

type ClusterRow = { entity: { id: string; groupId?: string | null }; isDeleted: boolean };

/** Balances on this page are whole currency units (decimals); sum them as integer minor units. */
export function sumBalancesCents(ids: readonly string[], balances: ReadonlyMap<string, number> | undefined): number | null {
  if (!balances) return null;
  let total = 0;
  let any = false;
  for (const id of ids) {
    const balance = balances.get(id);
    if (balance === undefined) continue;
    total += Math.round(balance * 100);
    any = true;
  }
  return any ? total : null;
}

/**
 * Splits already filtered and sorted rows into clusters, keeping the row order
 * inside each cluster. Groups are ordered by name and classes in list order
 * (assets, then liabilities); the "none" cluster is always last. A group that no
 * longer exists counts as no group.
 */
export function buildClusters<R extends ClusterRow>(
  rows: readonly R[],
  by: Exclude<GroupBy, "none">,
  context: {
    groups: readonly AccountGroup[] | undefined;
    effective: ReadonlyMap<string, EffectiveAccountClass>;
    balances: ReadonlyMap<string, number> | undefined;
  }
): AccountCluster<R>[] {
  const groupById = new Map((context.groups ?? []).map((g) => [g.id, g]));
  const buckets = new Map<string, R[]>();
  for (const row of rows) {
    let key = NO_CLUSTER;
    if (by === "group") {
      const groupId = row.entity.groupId;
      if (groupId && groupById.has(groupId)) key = groupId;
    } else {
      key = context.effective.get(row.entity.id)?.accountClass ?? NO_CLUSTER;
    }
    const bucket = buckets.get(key);
    if (bucket) bucket.push(row);
    else buckets.set(key, [row]);
  }

  const classOrder = new Map(ACCOUNT_CLASS_INFO.map((info, index) => [info.value as string, index]));
  const keys = [...buckets.keys()].sort((a, b) => {
    if (a === NO_CLUSTER || b === NO_CLUSTER) return a === NO_CLUSTER ? 1 : -1;
    if (by === "class") return (classOrder.get(a) ?? 0) - (classOrder.get(b) ?? 0);
    return (groupById.get(a)?.name ?? "").localeCompare(groupById.get(b)?.name ?? "", undefined, { sensitivity: "base" });
  });

  return keys.map((key) => {
    const clusterRows = buckets.get(key) ?? [];
    const none = key === NO_CLUSTER;
    return {
      key,
      label: none ? (by === "group" ? "No group" : "Unclassified") : by === "group" ? (groupById.get(key)?.name ?? key) : accountClassLabel(key as AccountClass),
      groupId: by === "group" && !none ? key : null,
      accountClass: by === "class" && !none ? (key as AccountClass) : null,
      rows: clusterRows,
      subtotalCents: sumBalancesCents(clusterRows.filter((r) => !r.isDeleted).map((r) => r.entity.id), context.balances),
    };
  });
}

/** "1,234.50" or "-1,234.50": the same whole-unit format the Balance column uses. */
export function formatCents(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
