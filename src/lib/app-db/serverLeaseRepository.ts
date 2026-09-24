import type { SqliteDatabase } from "./types";

/**
 * Per-server request leases (F-189).
 *
 * `actual-http-api` keeps one budget open per server instance, and two
 * concurrent requests against it can wedge that budget until it recovers (see
 * agents/knowledge.md, "The proxy's per-server serialization must stay"). The
 * in-memory queue in `src/lib/http/serverQueue.ts` keeps requests in order
 * inside one JavaScript realm; this row is what keeps two *realms* apart - a
 * worker thread and the web server, or two module instances that do not share
 * the queue's memory.
 *
 * A lease always expires on its own. The holder sets the expiry from its own
 * request timeout, so a holder that crashed mid-request frees the server as
 * soon as that request could no longer be running anyway.
 */

/**
 * Take the lease for `serverKey`, or take it over if the current one has
 * expired. Returns whether `holder` now owns it.
 *
 * One statement, so there is no gap between "is it free?" and "it is mine"
 * for another connection to fall into: the upsert's `WHERE` only lets the
 * update through when the existing row has expired, and a conflict that does
 * not update reports zero changes.
 */
export function tryAcquireServerLease(
  db: SqliteDatabase,
  input: { serverKey: string; holder: string; ttlMs: number; nowMs: number }
): boolean {
  const result = db
    .prepare(
      `INSERT INTO server_request_leases (server_key, holder, acquired_at, expires_at_ms)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(server_key) DO UPDATE SET
         holder = excluded.holder,
         acquired_at = excluded.acquired_at,
         expires_at_ms = excluded.expires_at_ms
       WHERE server_request_leases.expires_at_ms <= ?`
    )
    .run(
      input.serverKey,
      input.holder,
      new Date(input.nowMs).toISOString(),
      input.nowMs + input.ttlMs,
      input.nowMs
    );
  return result.changes === 1;
}

/** Give the lease back. A no-op when `holder` no longer owns it (it expired and was taken over). */
export function releaseServerLease(db: SqliteDatabase, input: { serverKey: string; holder: string }): void {
  db.prepare("DELETE FROM server_request_leases WHERE server_key = ? AND holder = ?").run(
    input.serverKey,
    input.holder
  );
}
