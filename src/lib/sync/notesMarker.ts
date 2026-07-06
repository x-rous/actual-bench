/**
 * Visible sync notes marker for Budget File Sync (RD-053 / PR-019).
 *
 * The marker is a clean, human-readable line appended to target notes so a user
 * can see a transaction came from a sync flow. Technical source IDs are NOT put
 * here — those live in app metadata and the target-side `imported_id` marker.
 */

export type SyncNotesMarkerContext = {
  sourceBudgetName: string;
  sourceAccountName: string;
};

/** Build the default visible marker, e.g. `[Synced from Home / Checking]`. */
export function buildSyncNotesMarker(context: SyncNotesMarkerContext): string {
  return (
    "[Synced from " +
    context.sourceBudgetName +
    " / " +
    context.sourceAccountName +
    "]"
  );
}

/** True when `notes` already contains the exact marker. */
export function hasSyncNotesMarker(
  notes: string | null | undefined,
  marker: string
): boolean {
  return typeof notes === "string" && notes.includes(marker);
}

/**
 * Append the marker to the source notes, idempotently.
 *
 * - Empty/absent source notes → the marker alone.
 * - Notes that already contain the marker → returned unchanged.
 * - Otherwise → `<notes> <marker>` on the same visible line.
 */
export function applySyncNotesMarker(
  sourceNotes: string | null | undefined,
  marker: string
): string {
  const base = (sourceNotes ?? "").trim();
  if (!base) return marker;
  if (hasSyncNotesMarker(base, marker)) return base;
  return base + " " + marker;
}
