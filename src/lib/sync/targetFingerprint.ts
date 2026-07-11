import { fnv1aHex } from "./hash";
import type { SyncAppliedSnapshot } from "@/lib/actual/transport";

/**
 * Stable hash of a target transaction's syncable fields (RD-057 §4).
 *
 * Recorded on the mapping when the engine writes a target (create or update), so
 * a later update can tell whether the live target still matches what sync last
 * wrote. A mismatch means the target was edited outside sync, and the update
 * path must NOT overwrite it - the manual edit wins.
 */
export function hashTargetFields(fields: SyncAppliedSnapshot): string {
  return fnv1aHex(
    [
      fields.amount,
      fields.date,
      fields.cleared ? "1" : "0",
      fields.categoryId ?? "",
      fields.payeeId ?? "",
      fields.notes ?? "",
    ].join("")
  );
}
