/**
 * Unused (orphaned) payees (RD-078 §10.5, §19).
 *
 * Actual has a native answer for this — `payees-get-orphaned` — but it is an
 * internal `send` handler with no actual-http-api route, so it is reachable in
 * Direct mode only. Rather than offer the feature in one transport and not the
 * other, Bench reimplements the predicate. Its exact SQL, pinned in
 * `nativeSemantics.test.ts`:
 *
 *   tombstone = 0
 *   AND transfer_acct IS NULL
 *   AND no alive transaction resolves to it through payee_mapping
 *   AND not referenced by a rule *condition* on the payee field
 *
 * **Bench is deliberately stricter on the last clause.** Actual checks only rule
 * conditions with `field = 'description'`; Bench also counts rule *actions* and
 * the `imported_payee` field, so a payee that some rule writes to is never
 * offered for deletion. Stricter is the right direction for a destructive
 * operation — the cost is leaving a genuinely unused payee in place, which is
 * recoverable, versus deleting one that a rule still targets, which is not.
 *
 * That divergence is disclosed in the UI (see `explainMissingCapability`), never
 * silent.
 */

import { buildRuleReferenceMap } from "@/lib/referenceCheck";
import type { Rule } from "@/types/entities";
import type { StagedMap } from "@/types/staged";
import { isCleanupEligible } from "./eligibility";
import type { PayeeCleanupCandidate } from "../types";

const PAYEE_FIELDS = ["payee", "imported_payee"];

export type OrphanPayee = {
  payee: PayeeCleanupCandidate;
  /** Why it qualifies, for the row's explanation. */
  reason: "no transactions, no rules";
};

export type OrphanInputs = {
  candidates: PayeeCleanupCandidate[];
  stagedRules: StagedMap<Rule>;
  /**
   * Transaction counts for the candidates. **Required** — a missing map means
   * "not loaded", and treating that as zero would offer every payee in the
   * budget for deletion.
   */
  transactionCounts: Map<string, number> | undefined;
};

export function findOrphanPayees(inputs: OrphanInputs): OrphanPayee[] {
  // Fail closed: without counts we cannot know a payee is unused.
  if (!inputs.transactionCounts) return [];

  const ruleCounts = buildRuleReferenceMap(inputs.stagedRules, PAYEE_FIELDS);

  return inputs.candidates
    .filter((candidate) => {
      if (!isCleanupEligible(candidate.metadata)) return false;
      if ((inputs.transactionCounts?.get(candidate.id) ?? 0) > 0) return false;
      if ((ruleCounts.get(candidate.id) ?? 0) > 0) return false;
      return true;
    })
    .map((payee) => ({ payee, reason: "no transactions, no rules" as const }))
    .sort((a, b) => a.payee.name.localeCompare(b.payee.name));
}
