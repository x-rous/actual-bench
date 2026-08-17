/**
 * Payee Cleanup Assistant (RD-078 / PR-041) — feature-local types.
 *
 * Cleanup reasons about payee fields that the *supported* transport APIs do not
 * return: `favorite`, `learn_categories` and `tombstone` are absent from
 * `APIPayeeEntity` (`Pick<PayeeEntity, 'id' | 'name' | 'transfer_acct'>`) and
 * from actual-http-api's `Payee` schema, but all three are exposed by the AQL
 * `payees` schema and so are readable through ActualQL in both transports.
 *
 * These extra fields stay in this feature-local view model on purpose — the
 * shared `Payee` entity type describes what the entity CRUD surface can read
 * and write, and none of these are writable through a supported API.
 */

import type { Payee } from "@/types/entities";

/**
 * Payee analysis metadata read via ActualQL, keyed by payee id.
 *
 * All three fields are read-only for Bench: `updatePayee` cannot carry
 * `favorite` or `learn_categories` in either transport (see
 * `lib/nativeSemantics.test.ts`), and `tombstone` is Actual's own sync state.
 */
export type PayeeCleanupMetadata = {
  id: string;
  /**
   * Actual's `favorite` flag — surfaces the payee prominently in autocomplete.
   * Read-only: informs target selection, never written by cleanup.
   */
  favorite: boolean;
  /**
   * Actual's per-payee category-learning switch.
   * Read-only: informs target selection, never written by cleanup.
   */
  learnCategories: boolean;
  /** Actual's soft-delete/sync marker. Tombstoned payees are never cleanup candidates. */
  tombstone: boolean;
  /** Set when this is an account-backed transfer payee. Never a cleanup candidate. */
  transferAccountId: string | null;
};

/**
 * A payee joined with its ActualQL-only analysis metadata — the unit every
 * detector, cluster and impact calculation works on.
 */
export type PayeeCleanupCandidate = Payee & {
  metadata: PayeeCleanupMetadata;
};
