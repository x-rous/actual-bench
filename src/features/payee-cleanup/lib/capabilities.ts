/**
 * Payee Cleanup capability report (RD-078 §26).
 *
 * Mirrors `src/lib/sync/capabilities.ts`: a mode-keyed set with a reason, so
 * the UI can gate a control instead of letting it fail at Save.
 *
 * Every `false` below is a *verified* gap, not a placeholder. The rule the
 * whole feature depends on: never silently degrade a destructive operation
 * because a capability is missing — disable it and say why.
 */

import type { ConnectionInstance, ConnectionMode } from "@/store/connection";

export type PayeeCleanupCapabilitySet = {
  /** Enumerate payees. `getPayees()` in Direct, `GET /payees` in HTTP. */
  listPayees: boolean;
  /**
   * Read `favorite` / `learn_categories` / `tombstone`.
   * Via the AQL `payees` schema — not `getPayees()`, which cannot carry them.
   */
  readPayeeAnalysisMetadata: boolean;
  /**
   * Write `favorite` / `learn_categories`.
   *
   * **False in both transports.** `updatePayee` takes `Partial<APIPayeeEntity>`
   * (`id`/`name`/`transfer_acct` only) and actual-http-api's `Payee` schema
   * matches. Only the internal `payees-batch-change` send handler can write
   * them, and it has no HTTP equivalent. Cleanup therefore shows these fields
   * as read-only differences and lets the user resolve them by choosing which
   * payee survives.
   */
  writePayeeBehaviorFields: boolean;
  /** Rename the surviving payee. `updatePayee({name})`, supported everywhere. */
  renamePayee: boolean;
  /** Native merge. `mergePayees(targetId, mergeIds)` in both transports. */
  mergePayees: boolean;
  /** Delete a validated orphan payee. */
  deletePayee: boolean;
  /** Count transactions per payee (ActualQL group-by). */
  readTransactionCountsByPayee: boolean;
  /** Read historical `imported_payee` for rule backtesting (041f). */
  readImportedPayeeHistory: boolean;
  /** Create the optional normalization rule (041f). */
  createRules: boolean;
  /**
   * Actual's own orphan handlers (`payees-get-orphaned` /
   * `payees-check-orphaned`).
   *
   * **False in HTTP mode** — they are internal `send` handlers with no
   * actual-http-api route. Bench reimplements the predicate so both transports
   * behave identically; where this is `true` (Direct) it is used to parity-check
   * that reimplementation, never as a second code path.
   */
  nativeOrphanHandler: boolean;
  /**
   * Read payee locations (`payee-locations-get`).
   *
   * **False in both transports** — internal send handlers, no public API method
   * and no HTTP route. `db.mergePayees` does not reassign locations, so a
   * source's locations are left attached to a tombstoned payee. Cleanup does not
   * surface or promise anything about them; documented as a known limitation.
   */
  readPayeeLocations: boolean;
};

/**
 * Capabilities common to both transports. Everything here is exercised by
 * existing shipped code (entity CRUD, `mergePayees`, ActualQL) rather than
 * assumed from a schema.
 */
const SHARED_CAPABILITIES: PayeeCleanupCapabilitySet = {
  listPayees: true,
  readPayeeAnalysisMetadata: true,
  writePayeeBehaviorFields: false,
  renamePayee: true,
  mergePayees: true,
  deletePayee: true,
  readTransactionCountsByPayee: true,
  readImportedPayeeHistory: true,
  createRules: true,
  nativeOrphanHandler: false,
  readPayeeLocations: false,
};

const DIRECT_CAPABILITIES: PayeeCleanupCapabilitySet = {
  ...SHARED_CAPABILITIES,
  // The browser runtime exposes Actual's `send`, so the orphan handlers are
  // reachable here — used only to parity-check Bench's own predicate.
  nativeOrphanHandler: true,
};

const HTTP_CAPABILITIES: PayeeCleanupCapabilitySet = {
  ...SHARED_CAPABILITIES,
};

export type PayeeCleanupCapabilityKey = keyof PayeeCleanupCapabilitySet;

export type PayeeCleanupCapabilityReport = {
  mode: ConnectionMode;
  /** False only when cleanup cannot run at all in this mode. */
  supported: boolean;
  reason: string | null;
  capabilities: PayeeCleanupCapabilitySet;
};

export function getPayeeCleanupCapabilities(
  connection: Pick<ConnectionInstance, "mode"> | { mode: ConnectionMode }
): PayeeCleanupCapabilityReport {
  const capabilities =
    connection.mode === "http-api"
      ? { ...HTTP_CAPABILITIES }
      : { ...DIRECT_CAPABILITIES };

  return {
    mode: connection.mode,
    supported: true,
    reason: null,
    capabilities,
  };
}

/**
 * User-facing explanation for a capability the current mode does not have.
 * Used by the UI to disable a control *with a reason* (RD-078 §26).
 */
export function explainMissingCapability(
  key: PayeeCleanupCapabilityKey
): string | null {
  switch (key) {
    case "writePayeeBehaviorFields":
      return "Actual's API does not allow changing Favorite or Category learning from outside Actual. The payee you keep as the merge target keeps its own settings.";
    case "readPayeeLocations":
      return "Saved payee locations cannot be read through Actual's API, so cleanup does not report them. Merging does not move a payee's saved locations to the payee you keep.";
    case "nativeOrphanHandler":
      return "Actual's built-in unused-payee check is not available over the HTTP API, so Actual Bench applies the same rules itself — and checks a payee's rule actions as well as its conditions, which is slightly stricter.";
    default:
      return null;
  }
}
