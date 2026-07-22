import type { SqliteDatabase } from "./types";

/**
 * Tiny key/value accessors over the `app_meta` table. Used for cross-context
 * operational state that must survive the dev module-instance split - e.g. the
 * unattended scheduler writes its status snapshot here so the App Health API
 * route (a different module instance) can read an accurate view from the shared
 * database instead of blind in-memory state.
 */

export function getAppMeta(db: SqliteDatabase, key: string): string | null {
  const row = db.prepare("SELECT value FROM app_meta WHERE key = ?").get<{ value: string }>(key);
  return row?.value ?? null;
}

export function setAppMeta(db: SqliteDatabase, key: string, value: string): void {
  db.prepare(
    `INSERT INTO app_meta (key, value, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).run(key, value, new Date().toISOString());
}

export function deleteAppMeta(db: SqliteDatabase, key: string): void {
  db.prepare("DELETE FROM app_meta WHERE key = ?").run(key);
}
