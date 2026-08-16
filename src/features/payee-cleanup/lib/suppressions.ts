/**
 * Applying the user's "not duplicates" decisions (RD-078 §14).
 *
 * Two rules govern this module, and both exist because the obvious
 * implementation is wrong:
 *
 * 1. **A suppression hides a relationship, not a payee.** Marking `EMIRATES`
 *    and `EMIRATES NBD` as unrelated must not remove either from a different,
 *    well-evidenced cluster. So a suppression matches only when the cluster it
 *    is being tested against is *the same grouping* — every suppressed payee
 *    present, and no meaningful extras.
 * 2. **Ids alone are not a durable key.** Payee ids vanish when the payees are
 *    merged or deleted, which is precisely what happens after a successful
 *    cleanup; normalized names outlive them but can be reused by a genuinely
 *    new payee. Matching on either, and requiring the whole grouping to line
 *    up, keeps an old decision meaningful without letting it silence something
 *    new.
 */

import { normalizeToken } from "./reduce";
import type { PayeeCleanupSuppressionRecord } from "@/lib/app-db/types";
import type { CorpusAffix } from "./corpusAffixes";
import type { PayeeCluster } from "./clusterResolver";

/** The comparison form for a payee name inside a suppression. */
export function suppressionKey(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .map(normalizeToken)
    .filter(Boolean)
    .join(" ");
}

function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const left = new Set(a);
  return b.every((value) => left.has(value));
}

/**
 * True when this suppression covers exactly this cluster.
 *
 * Deliberately an exact-grouping test rather than "any member overlaps". A
 * rejected pair should stop being suggested; it should not veto a three-member
 * cluster that happens to include one of the same payees, because that is a
 * different proposal the user has never seen.
 */
export function suppressesCluster(
  suppression: PayeeCleanupSuppressionRecord,
  cluster: PayeeCluster
): boolean {
  if (suppression.kind !== "not-duplicates") return false;

  const clusterIds = cluster.members.map((m) => m.id);
  if (
    suppression.payeeIds.length > 0 &&
    sameSet(suppression.payeeIds, clusterIds)
  ) {
    return true;
  }

  // The ids no longer exist, or never matched: fall back to the names, which
  // survive a merge that removed the original payees.
  const clusterNames = cluster.members.map((m) => suppressionKey(m.name));
  return (
    suppression.normalizedNames.length > 0 &&
    sameSet(suppression.normalizedNames, clusterNames)
  );
}

/** Drops the clusters the user has already rejected. */
export function applySuppressions(
  clusters: PayeeCluster[],
  suppressions: PayeeCleanupSuppressionRecord[]
): PayeeCluster[] {
  if (suppressions.length === 0) return clusters;
  return clusters.filter(
    (cluster) => !suppressions.some((s) => suppressesCluster(s, cluster))
  );
}

/**
 * Drops learned affixes the user has rejected.
 *
 * The corpus learner cannot tell a channel wrapper from a meaningful word like
 * `TRANSFER` — both open many payees. Rejecting one cluster does not stop the
 * affix being applied everywhere else, so the affix itself has to be
 * suppressible, or the user would be re-rejecting the same inference forever.
 */
export function applyAffixSuppressions(
  affixes: CorpusAffix[],
  suppressions: PayeeCleanupSuppressionRecord[]
): CorpusAffix[] {
  const rejected = suppressions.filter((s) => s.kind === "rejected-affix");
  if (rejected.length === 0) return affixes;

  return affixes.filter(
    (affix) => !rejected.some((s) => sameSet(s.normalizedNames, affix.tokens))
  );
}

/** The record to persist when the user rejects a cluster. */
export function buildClusterSuppression(
  budgetSyncId: string,
  cluster: PayeeCluster
): {
  budgetSyncId: string;
  kind: "not-duplicates";
  payeeIds: string[];
  normalizedNames: string[];
  detectorIds: string[];
} {
  return {
    budgetSyncId,
    kind: "not-duplicates",
    payeeIds: cluster.members.map((m) => m.id),
    normalizedNames: cluster.members.map((m) => suppressionKey(m.name)),
    detectorIds: [...new Set(cluster.evidence.map((e) => e.detectorId))],
  };
}

/** The record to persist when the user rejects a piece of learned boilerplate. */
export function buildAffixSuppression(
  budgetSyncId: string,
  affix: CorpusAffix
): {
  budgetSyncId: string;
  kind: "rejected-affix";
  payeeIds: string[];
  normalizedNames: string[];
  detectorIds: string[];
} {
  return {
    budgetSyncId,
    kind: "rejected-affix",
    payeeIds: [],
    normalizedNames: affix.tokens,
    detectorIds: [affix.kind === "prefix" ? "corpus-prefix" : "corpus-suffix"],
  };
}
