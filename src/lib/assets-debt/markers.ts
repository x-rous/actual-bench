/**
 * Deterministic posting markers (RD-084 P1.6 T114; FR-160, S10).
 *
 * `abdebt:<budget>:<subject>:<kind>:<period>:g<generation>` is written to the
 * Actual row's `imported_id`, so a create that Actual accepted but Bench never
 * recorded is found again by equality instead of being written twice. It is
 * an opaque key: nothing ever parses it. The generation starts at 1 and moves
 * on only after a reversal, so a corrected posting never collides with the
 * reversed row it replaces.
 */

export const POSTING_MARKER_PREFIX = "abdebt:";

export type PostingMarkerKey = {
  budgetSyncId: string;
  subjectId: string;
  postingKind: string;
  periodKey: string;
  generation: number;
};

function segment(value: string, field: string): string {
  if (value.length === 0) throw new RangeError(`${field} is required for a posting marker`);
  // A colon would let two different keys produce the same marker.
  if (value.includes(":")) throw new RangeError(`${field} must not contain ":" in a posting marker`);
  return value;
}

export function buildPostingMarker(key: PostingMarkerKey): string {
  if (!Number.isSafeInteger(key.generation) || key.generation < 1) throw new RangeError("generation must be a whole number of at least 1");
  return [
    "abdebt",
    segment(key.budgetSyncId, "budgetSyncId"),
    segment(key.subjectId, "subjectId"),
    segment(key.postingKind, "postingKind"),
    segment(key.periodKey, "periodKey"),
    `g${key.generation}`,
  ].join(":");
}

/** True for any Bench posting marker. Prefix only; the marker is never parsed. */
export function isPostingMarker(importedId: string | null | undefined): boolean {
  return typeof importedId === "string" && importedId.startsWith(POSTING_MARKER_PREFIX);
}
