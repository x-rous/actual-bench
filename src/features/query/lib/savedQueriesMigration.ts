import type { SavedQuery } from "../types";
import type { SavedQueryCreateInput } from "./savedQueriesApi";

/**
 * One-time migration of pre-RD-064 saved queries from per-budget localStorage
 * into the global app DB. Runs once per browser; the flag is only set after a
 * successful import so a transient failure retries on the next load.
 */

const LEGACY_KEY_PREFIX = "actualql-saved-queries:";
const MIGRATED_FLAG = "actualql-saved-queries-migrated";

export function hasMigratedLegacySavedQueries(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return localStorage.getItem(MIGRATED_FLAG) === "1";
  } catch {
    // Storage unavailable — treat as migrated so we never loop trying.
    return true;
  }
}

function markMigrated(): void {
  try {
    localStorage.setItem(MIGRATED_FLAG, "1");
  } catch {
    // Best effort; if we can't persist the flag the import simply re-runs (the
    // server-side import dedupes by name+query, so re-running is harmless).
  }
}

/**
 * Read and flatten every `actualql-saved-queries:<budgetSyncId>` entry into a
 * single deduped list. Deduping here keeps the import payload small; the server
 * dedupes again against existing rows.
 */
export function collectLegacySavedQueries(): SavedQueryCreateInput[] {
  if (typeof window === "undefined") return [];
  const seen = new Set<string>();
  const collected: SavedQueryCreateInput[] = [];

  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!key?.startsWith(LEGACY_KEY_PREFIX)) continue;

      let entries: SavedQuery[];
      try {
        entries = JSON.parse(localStorage.getItem(key) ?? "[]") as SavedQuery[];
      } catch {
        continue;
      }
      if (!Array.isArray(entries)) continue;

      for (const entry of entries) {
        if (!entry || typeof entry.name !== "string" || typeof entry.query !== "string") continue;
        const name = entry.name.trim();
        if (!name || !entry.query.trim()) continue;
        const dedupeKey = `${name} ${entry.query}`;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);
        collected.push({ name, query: entry.query, isFavorite: entry.isFavorite === true });
      }
    }
  } catch {
    return [];
  }

  return collected;
}

/**
 * Import legacy saved queries once. Returns the number imported (0 if already
 * migrated or nothing to import). `importFn` is injected so the caller supplies
 * the app's client (keeps this module free of a fetch dependency to test).
 */
export async function migrateLegacySavedQueriesOnce(
  importFn: (queries: SavedQueryCreateInput[]) => Promise<{ imported: number }>
): Promise<number> {
  if (hasMigratedLegacySavedQueries()) return 0;

  const legacy = collectLegacySavedQueries();
  if (legacy.length === 0) {
    markMigrated();
    return 0;
  }

  const { imported } = await importFn(legacy);
  markMigrated();
  return imported;
}
