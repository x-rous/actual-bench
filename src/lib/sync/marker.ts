/**
 * Deterministic target-side sync marker (Actual `imported_id`) for Budget File
 * Sync (RD-053 / PR-019).
 *
 * The marker is derived only from **globally stable identity** — the source and
 * target Actual budget sync ids, the target account id, and the source item key
 * — never from the (random, per-instance) flow id or the server URL. That makes
 * it **portable across Actual Bench instances**: any instance, on any host,
 * computes the identical marker for the same source item → target account. So if
 * one instance syncs a transaction, another instance recognises it on the target
 * (`target_marker_match`) and will not create a duplicate, even though its local
 * mapping database has no record of it.
 *
 * App DB mappings remain the primary idempotency source of truth; the marker is
 * a secondary recovery/dedupe aid (and the only cross-instance one).
 *
 * The marker is a readable, collision-free concatenation of full ids (no hash),
 * so distinct source items can never collide onto the same marker. Equality is
 * the only operation performed on markers; they are never parsed.
 */

export const SYNC_MARKER_PREFIX = "absync";

export type SyncMarkerRoute = {
  /** Source Actual budget sync id (stable across servers/instances). */
  sourceBudgetId: string;
  /** Target Actual budget sync id. */
  targetBudgetId: string;
  /** Target account id (distinguishes the same source item synced to two accounts). */
  targetAccountId: string;
  /** Stable source item key (`txn:<id>` / `split:<id>:<splitId>` / fallback). */
  sourceItemKey: string;
};

/**
 * Build the portable marker for a source item on a route. Returns null when any
 * identity component is missing, which callers treat as "cannot produce a
 * durable marker" → the create is blocked.
 *
 * `sourceItemKey` is placed last because it may itself contain `:`; the
 * preceding fields are colon-free ids, so the concatenation is unambiguous.
 */
export function generateSyncMarker(route: SyncMarkerRoute): string | null {
  const { sourceBudgetId, targetBudgetId, targetAccountId, sourceItemKey } = route;
  if (!sourceBudgetId || !targetBudgetId || !targetAccountId || !sourceItemKey) {
    return null;
  }
  return [
    SYNC_MARKER_PREFIX,
    sourceBudgetId,
    targetBudgetId,
    targetAccountId,
    sourceItemKey,
  ].join(":");
}

/**
 * True when a value looks like a marker this app generated (any version), used
 * for reciprocal-flow loop prevention.
 */
export function isGeneratedSyncMarker(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith(SYNC_MARKER_PREFIX + ":");
}
