/**
 * User corrections to a cleanup proposal (RD-078 §13).
 *
 * Detection will be wrong sometimes, so every part of a proposal has to be
 * editable: which payees are in it, which one survives, and what it ends up
 * called. This module holds that state as plain data and pure transitions, so
 * the edits are testable without a component and every derived value can be
 * recomputed from them.
 *
 * The eligibility boundary is enforced here as well as at scan time, because
 * these functions accept ids coming back from the UI — a transfer payee must
 * not be able to enter a cluster through the "add member" control any more than
 * through detection.
 */

import { assertCleanupEligible } from "./eligibility";
import type { IneligibleReason } from "./eligibility";
import type { PayeeCleanupCandidate } from "../types";

export type ClusterDecision = "undecided" | "accepted" | "rejected";

export type ClusterCorrection = {
  decision: ClusterDecision;
  /** Members the user removed from the proposal. */
  excludedIds: string[];
  /** Members the user added by hand. */
  addedIds: string[];
  /** Overrides the suggested merge target. */
  targetId?: string;
  /** Overrides the suggested final name. */
  canonicalName?: string;
  /** Opt-in: also create the proposed normalization rule (041f). */
  createRule?: boolean;
  /** A pattern the user typed, replacing the generated one. */
  rulePattern?: { field: "imported_payee" | "notes"; text: string };
};

export const EMPTY_CORRECTION: ClusterCorrection = {
  decision: "undecided",
  excludedIds: [],
  addedIds: [],
};

export type CorrectionMap = Record<string, ClusterCorrection>;

function current(corrections: CorrectionMap, clusterId: string): ClusterCorrection {
  return corrections[clusterId] ?? EMPTY_CORRECTION;
}

function update(
  corrections: CorrectionMap,
  clusterId: string,
  patch: Partial<ClusterCorrection>
): CorrectionMap {
  return {
    ...corrections,
    [clusterId]: { ...current(corrections, clusterId), ...patch },
  };
}

export function setDecision(
  corrections: CorrectionMap,
  clusterId: string,
  decision: ClusterDecision
): CorrectionMap {
  return update(corrections, clusterId, { decision });
}

/**
 * Removes a member from the proposal.
 *
 * If the excluded payee was the target, the override is cleared so the scorer
 * picks a new one — leaving a target that is no longer in the cluster would
 * produce a merge into a payee the user just removed.
 */
export function excludeMember(
  corrections: CorrectionMap,
  clusterId: string,
  payeeId: string
): CorrectionMap {
  const existing = current(corrections, clusterId);
  return update(corrections, clusterId, {
    excludedIds: [...new Set([...existing.excludedIds, payeeId])],
    addedIds: existing.addedIds.filter((id) => id !== payeeId),
    targetId: existing.targetId === payeeId ? undefined : existing.targetId,
  });
}

export function includeMember(
  corrections: CorrectionMap,
  clusterId: string,
  payeeId: string
): CorrectionMap {
  const existing = current(corrections, clusterId);
  return update(corrections, clusterId, {
    excludedIds: existing.excludedIds.filter((id) => id !== payeeId),
  });
}

/**
 * Adds a payee the detector missed.
 *
 * Returns the reason instead of the new state when the payee cannot take part,
 * so the caller can explain the refusal rather than silently dropping it.
 */
export function addMember(
  corrections: CorrectionMap,
  clusterId: string,
  candidate: PayeeCleanupCandidate
): CorrectionMap | IneligibleReason {
  const reason = assertCleanupEligible(candidate);
  if (reason) return reason;

  const existing = current(corrections, clusterId);
  return update(corrections, clusterId, {
    addedIds: [...new Set([...existing.addedIds, candidate.id])],
    excludedIds: existing.excludedIds.filter((id) => id !== candidate.id),
  });
}

/** Same guard for the target: a transfer or tombstoned payee can never survive a merge. */
export function setTarget(
  corrections: CorrectionMap,
  clusterId: string,
  candidate: PayeeCleanupCandidate
): CorrectionMap | IneligibleReason {
  const reason = assertCleanupEligible(candidate);
  if (reason) return reason;
  return update(corrections, clusterId, { targetId: candidate.id });
}

export function setCreateRule(
  corrections: CorrectionMap,
  clusterId: string,
  createRule: boolean
): CorrectionMap {
  return update(corrections, clusterId, { createRule });
}

export function setRulePattern(
  corrections: CorrectionMap,
  clusterId: string,
  pattern: { field: "imported_payee" | "notes"; text: string } | undefined
): CorrectionMap {
  const text = pattern?.text.trim();
  // Clearing the box returns to the generated pattern rather than staging a
  // rule that matches everything.
  return update(corrections, clusterId, {
    rulePattern: pattern && text ? { field: pattern.field, text } : undefined,
  });
}

export function setCanonicalName(
  corrections: CorrectionMap,
  clusterId: string,
  name: string
): CorrectionMap {
  const trimmed = name.trim();
  // An empty override is not a name; fall back to the suggestion rather than
  // staging a rename to nothing.
  return update(corrections, clusterId, {
    canonicalName: trimmed ? trimmed : undefined,
  });
}

/**
 * Splits a cluster: the named payees stay, everything else is excluded.
 *
 * Expressed through the same exclusion list rather than as a new cluster id, so
 * a split can be undone by re-including members and nothing downstream has to
 * know about synthetic clusters.
 */
export function splitCluster(
  corrections: CorrectionMap,
  clusterId: string,
  keepIds: string[],
  allMemberIds: string[]
): CorrectionMap {
  const keep = new Set(keepIds);
  const excluded = allMemberIds.filter((id) => !keep.has(id));
  const existing = current(corrections, clusterId);
  return update(corrections, clusterId, {
    excludedIds: excluded,
    targetId:
      existing.targetId && keep.has(existing.targetId) ? existing.targetId : undefined,
  });
}

/**
 * Folds several groups into one (RD-078 §13 "add member" / "split", combined).
 *
 * When the user names two or three groups the same thing, they have said those
 * payees belong together — the scan simply could not see it, because the names
 * reduce to different stems. Rather than refusing, cleanup can act on what the
 * user just told it.
 *
 * Expressed entirely through the existing corrections: every member of the other
 * groups is *added* to the surviving one, and each other group is emptied so it
 * drops out of the list. No synthetic cluster ids, no new concept for the plan
 * builder or the validator to understand, and `resetCluster` undoes any part of
 * it.
 *
 * The final name is pinned explicitly, so the combined group keeps the name the
 * user chose rather than re-deriving one from the merged stem.
 */
export function combineGroups(
  corrections: CorrectionMap,
  survivor: { clusterId: string; finalName: string },
  absorbed: { clusterId: string; memberIds: string[] }[]
): CorrectionMap {
  let next = corrections;

  for (const group of absorbed) {
    for (const memberId of group.memberIds) {
      const existing = current(next, survivor.clusterId);
      next = update(next, survivor.clusterId, {
        addedIds: [...new Set([...existing.addedIds, memberId])],
        excludedIds: existing.excludedIds.filter((id) => id !== memberId),
      });
    }
    // Emptying the group takes it below two members, so it stops being a
    // proposal at all.
    next = update(next, group.clusterId, {
      excludedIds: [...new Set(group.memberIds)],
      targetId: undefined,
      decision: "undecided",
    });
  }

  return update(next, survivor.clusterId, { canonicalName: survivor.finalName });
}

export function resetCluster(
  corrections: CorrectionMap,
  clusterId: string
): CorrectionMap {
  const next = { ...corrections };
  delete next[clusterId];
  return next;
}

/**
 * The member list after corrections.
 *
 * A cluster reduced below two members is no longer a merge proposal, which the
 * caller uses to drop it from the list.
 */
export function correctedMembers(
  members: PayeeCleanupCandidate[],
  correction: ClusterCorrection,
  lookup: (id: string) => PayeeCleanupCandidate | undefined
): PayeeCleanupCandidate[] {
  const excluded = new Set(correction.excludedIds);
  const kept = members.filter((m) => !excluded.has(m.id));

  const existing = new Set(kept.map((m) => m.id));
  const added = correction.addedIds
    .filter((id) => !existing.has(id))
    .map(lookup)
    .filter((c): c is PayeeCleanupCandidate => Boolean(c));

  return [...kept, ...added];
}

export function hasCorrections(correction: ClusterCorrection): boolean {
  return (
    correction.decision !== "undecided" ||
    correction.excludedIds.length > 0 ||
    correction.addedIds.length > 0 ||
    correction.targetId !== undefined ||
    correction.canonicalName !== undefined ||
    correction.createRule === true ||
    correction.rulePattern !== undefined
  );
}
