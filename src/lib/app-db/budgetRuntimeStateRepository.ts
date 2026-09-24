import type { SqliteDatabase } from "./types";

/**
 * When Bench last uploaded a fresh snapshot of a Direct budget (RD-095 M3).
 *
 * Keyed by server and budget, not by connection: two enrolments of one budget
 * are one budget on the server, and one snapshot serves both.
 */

export function getLastSnapshotAt(
  db: SqliteDatabase,
  key: { serverFingerprint: string; budgetSyncId: string }
): string | null {
  const row = db
    .prepare(
      "SELECT last_snapshot_at FROM budget_runtime_state WHERE server_fingerprint = ? AND budget_sync_id = ?"
    )
    .get<{ last_snapshot_at: string }>(key.serverFingerprint, key.budgetSyncId);
  return row?.last_snapshot_at ?? null;
}

export function recordSnapshotUploaded(
  db: SqliteDatabase,
  key: { serverFingerprint: string; budgetSyncId: string },
  at: string
): void {
  db.prepare(
    `INSERT INTO budget_runtime_state (server_fingerprint, budget_sync_id, last_snapshot_at)
     VALUES (?, ?, ?)
     ON CONFLICT(server_fingerprint, budget_sync_id) DO UPDATE SET last_snapshot_at = excluded.last_snapshot_at`
  ).run(key.serverFingerprint, key.budgetSyncId, at);
}
