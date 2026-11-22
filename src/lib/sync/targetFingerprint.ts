import { fnv1aHex } from "./hash";
import type { SyncAppliedSnapshot } from "@/lib/actual/transport";

/**
 * Stable hash of the target fields sync owns (RD-057 §4).
 *
 * Recorded on the mapping when the engine writes a target, so a later update can
 * tell whether those fields still match what sync last wrote. A mismatch means
 * someone edited them outside sync, and the update path must not overwrite them.
 *
 * Category and cleared state belong to the target budget: people categorise and
 * clear synced rows there, and doing so must not stop later corrections from
 * reaching the row. They are deliberately left out of the hash and are never
 * overwritten by an update.
 */
const FIELD_SEPARATOR = "\u0001";
const VERSION_PREFIX = "v2:";

export function hashTargetFields(fields: SyncAppliedSnapshot): string {
  return (
    VERSION_PREFIX +
    fnv1aHex([fields.amount, fields.date, fields.payeeId ?? "", fields.notes ?? ""].join(FIELD_SEPARATOR))
  );
}

/** The hash mappings stored before category and cleared left it. */
function legacyHash(fields: SyncAppliedSnapshot, categoryId: string | null, cleared: boolean): string {
  return fnv1aHex(
    [fields.amount, fields.date, cleared ? "1" : "0", categoryId ?? "", fields.payeeId ?? "", fields.notes ?? ""].join(FIELD_SEPARATOR)
  );
}

/**
 * True when the live target's sync-owned fields still match the stored baseline.
 *
 * A baseline written by an older version also covers category and cleared, whose
 * original values are not stored. Sync created those rows uncleared and usually
 * without a category, so the live row is compared with those values as well as
 * its own. A row whose baseline had some other category stays protected.
 */
export function targetMatchesBaseline(live: SyncAppliedSnapshot, baseline: string): boolean {
  if (baseline.startsWith(VERSION_PREFIX)) return hashTargetFields(live) === baseline;
  for (const categoryId of new Set([live.categoryId ?? null, null])) {
    for (const cleared of new Set([live.cleared, false])) {
      if (legacyHash(live, categoryId, cleared) === baseline) return true;
    }
  }
  return false;
}
