/**
 * Payee Cleanup eligibility boundary (RD-078 §4).
 *
 * Two classes of payee can never take part in cleanup, and both must be
 * rejected *before* derived forms, pair generation, fuzzy matching, cluster
 * resolution, target selection or deletion — not filtered out later in the UI:
 *
 * - **Transfer payees** (`transfer_acct` set) are account-backed and managed by
 *   Actual. They are read-only: not renameable, deleteable, mergeable or
 *   batch-selectable. Actual's own `db.mergePayees` silently *no-ops* when the
 *   target is a transfer payee and silently drops transfer payees from the
 *   source list — so letting one into a plan produces a merge that reports
 *   success while doing nothing.
 * - **Tombstoned payees** are already deleted. Surfacing them would resurrect
 *   dead entities as candidates and let suppressions bind to ids that no longer
 *   exist.
 *
 * Their rules may still be inspected when analysing rule overlap globally; that
 * is a separate concern from being a cleanup *candidate*.
 */

import type { PayeeCleanupCandidate, PayeeCleanupMetadata } from "../types";

export type IneligibleReason = "transfer-payee" | "tombstoned";

/**
 * The eligibility predicate. Accepts anything carrying the metadata fields, so
 * it can be applied to a raw metadata row before the full candidate is built.
 */
export function isCleanupEligible(
  payee: Pick<PayeeCleanupMetadata, "tombstone" | "transferAccountId">
): boolean {
  // Falsy rather than nullish. This predicate is documented as safe to run on a
  // raw metadata row, and a raw row can carry `transfer_acct: ""` — never a real
  // account id, but enough to hide an ordinary payee from cleanup with no
  // explanation anywhere in the UI.
  return !payee.transferAccountId && !payee.tombstone;
}

/**
 * Why a payee was excluded, or `null` when it is eligible.
 *
 * Transfer is reported ahead of tombstone so a deleted transfer payee reads as
 * the more specific "this is not an ordinary merchant" case.
 */
export function ineligibleReason(
  payee: Pick<PayeeCleanupMetadata, "tombstone" | "transferAccountId">
): IneligibleReason | null {
  if (payee.transferAccountId) return "transfer-payee";
  if (payee.tombstone) return "tombstoned";
  return null;
}

export type EligibilityPartition = {
  eligible: PayeeCleanupCandidate[];
  /** Kept so the dashboard can report "N transfer payees excluded" honestly. */
  excludedTransfer: PayeeCleanupCandidate[];
  excludedTombstoned: PayeeCleanupCandidate[];
};

/**
 * Splits the candidate set at the boundary. Callers pass `partition.eligible`
 * into detection and use the excluded counts for the scan summary.
 */
export function partitionByEligibility(
  candidates: PayeeCleanupCandidate[]
): EligibilityPartition {
  const partition: EligibilityPartition = {
    eligible: [],
    excludedTransfer: [],
    excludedTombstoned: [],
  };

  for (const candidate of candidates) {
    switch (ineligibleReason(candidate.metadata)) {
      case "transfer-payee":
        partition.excludedTransfer.push(candidate);
        break;
      case "tombstoned":
        partition.excludedTombstoned.push(candidate);
        break;
      default:
        partition.eligible.push(candidate);
    }
  }

  return partition;
}

/**
 * Guard for every later slice that accepts a payee id from the UI — adding a
 * cluster member (041d), choosing a merge target (041e), staging a deletion.
 * Returns the reason so callers can explain the refusal rather than silently
 * dropping the id.
 */
export function assertCleanupEligible(
  candidate: PayeeCleanupCandidate
): IneligibleReason | null {
  return ineligibleReason(candidate.metadata);
}
