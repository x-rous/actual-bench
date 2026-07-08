/**
 * Deterministic target-side sync marker (Actual `imported_id`) for Budget File
 * Sync (RD-053 / PR-019).
 *
 * The marker is derived from the flow id and the source item key, so the same
 * source item always yields the same marker on every rerun. This lets the
 * engine recover a lost DB mapping by matching the marker on the target side
 * (`target_marker_match`), and lets reciprocal flows recognise and exclude
 * transactions they generated. App DB mappings remain the primary source of
 * truth; the marker is a secondary recovery/dedupe aid.
 */

export const SYNC_MARKER_PREFIX = "absync";

/**
 * Build the deterministic marker for a source item within a flow. Returns null
 * when identity is incomplete (no flow id or item key), which callers treat as
 * "cannot produce a marker" → the create is blocked.
 */
export function generateSyncMarker(
  flowId: string,
  sourceItemKey: string
): string | null {
  if (!flowId || !sourceItemKey) return null;
  return SYNC_MARKER_PREFIX + ":" + flowId + ":" + sourceItemKey;
}

/** True when a value looks like a marker this app generated. */
export function isGeneratedSyncMarker(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith(SYNC_MARKER_PREFIX + ":");
}
