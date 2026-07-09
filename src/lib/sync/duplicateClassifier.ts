import { normalizeName } from "./normalize";
import type { SyncDuplicateConfidence } from "@/lib/app-db/types";
import type {
  PlannedTargetPayload,
  SyncTargetTransactionForDedupe,
} from "./plannedChanges";

/**
 * Heuristic duplicate detection for Budget File Sync (RD-053 / PR-019).
 *
 * Compares the *transformed* target payload (amount is already reversed) against
 * existing target transactions. This is a safety net below the primary DB
 * mapping and target-marker checks: it fires only when there is no mapping and
 * no marker match. Uncertain matches are skipped by default upstream.
 *
 * Confidence ladder (date + amount must always match to be considered):
 * - exact:  same normalized payee AND same category.
 * - strong: same normalized payee (category differs/absent).
 * - weak:   payee differs/absent (date + amount only).
 * - none:   no date+amount match at all.
 */
/** Result of duplicate detection: confidence plus the best-matching target id. */
export type DuplicateMatch = {
  confidence: SyncDuplicateConfidence;
  /** The matched target transaction id for the strongest match, else null. */
  targetTransactionId: string | null;
};

export function classifyDuplicate(
  payload: Pick<PlannedTargetPayload, "date" | "amount" | "categoryId">,
  targetTransactions: SyncTargetTransactionForDedupe[],
  /** Effective target payee name (resolved match, create name, or source name). */
  plannedPayeeName: string | null
): DuplicateMatch {
  const plannedPayee = normalizeName(plannedPayeeName);

  let best: SyncDuplicateConfidence = "none";
  let bestId: string | null = null;
  for (const txn of targetTransactions) {
    if (txn.date !== payload.date || txn.amount !== payload.amount) continue;

    const samePayee =
      plannedPayee !== "" && normalizeName(txn.payeeName) === plannedPayee;
    const sameCategory =
      payload.categoryId != null && txn.categoryId === payload.categoryId;

    let confidence: SyncDuplicateConfidence;
    if (samePayee && sameCategory) confidence = "exact";
    else if (samePayee) confidence = "strong";
    else confidence = "weak";

    if (RANK[confidence] > RANK[best]) {
      best = confidence;
      bestId = txn.id;
    }
    if (best === "exact") break;
  }

  return { confidence: best, targetTransactionId: bestId };
}

const RANK: Record<SyncDuplicateConfidence, number> = {
  none: 0,
  weak: 1,
  strong: 2,
  exact: 3,
};
