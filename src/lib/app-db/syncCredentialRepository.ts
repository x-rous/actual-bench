import { openSecret, sealSecret } from "@/lib/sync/vault";
import type {
  SqliteDatabase,
  SyncCredential,
  SyncCredentialInput,
  SyncCredentialMeta,
} from "./types";

/**
 * App-DB repository for the encrypted credential vault (RD-058 / PR-024a).
 *
 * The secret blob is sealed by `vault.ts` before it touches the DB and opened
 * only here, server-side. Callers that need metadata (the UI, health) use
 * `listSyncCredentialMeta` / `hasSyncCredential`, which never decrypt.
 */

type CredentialRow = {
  connection_fingerprint: string;
  mode: string;
  base_url: string;
  budget_sync_id: string;
  label: string;
  ciphertext: string;
  iv: string;
  auth_tag: string;
  created_at: string;
  updated_at: string;
};

function toMeta(row: CredentialRow): SyncCredentialMeta {
  return {
    connectionFingerprint: row.connection_fingerprint,
    mode: row.mode,
    baseUrl: row.base_url,
    budgetSyncId: row.budget_sync_id,
    label: row.label,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Seal and store (insert or replace) a credential. Requires an enabled vault. */
export function upsertSyncCredential(db: SqliteDatabase, input: SyncCredentialInput): SyncCredentialMeta {
  const now = new Date().toISOString();
  const sealed = sealSecret(JSON.stringify(input.secret));

  // ON CONFLICT DO UPDATE never touches created_at, so an existing row keeps its
  // original value; RETURNING gives us the effective created_at without a
  // separate pre-SELECT.
  const row = db
    .prepare(
      `INSERT INTO sync_credentials (
         connection_fingerprint, mode, base_url, budget_sync_id, label,
         ciphertext, iv, auth_tag, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(connection_fingerprint) DO UPDATE SET
         mode = excluded.mode,
         base_url = excluded.base_url,
         budget_sync_id = excluded.budget_sync_id,
         label = excluded.label,
         ciphertext = excluded.ciphertext,
         iv = excluded.iv,
         auth_tag = excluded.auth_tag,
         updated_at = excluded.updated_at
       RETURNING created_at`
    )
    .get<{ created_at: string }>(
      input.connectionFingerprint,
      input.mode,
      input.baseUrl,
      input.budgetSyncId,
      input.label ?? "",
      sealed.ciphertext,
      sealed.iv,
      sealed.authTag,
      now,
      now
    );

  return {
    connectionFingerprint: input.connectionFingerprint,
    mode: input.mode,
    baseUrl: input.baseUrl,
    budgetSyncId: input.budgetSyncId,
    label: input.label ?? "",
    createdAt: row?.created_at ?? now,
    updatedAt: now,
  };
}

/** Read + decrypt a credential (server-only). Null when absent. Throws if the
 *  vault is locked or the ciphertext can't be opened - callers pause the flow. */
export function getSyncCredential(db: SqliteDatabase, connectionFingerprint: string): SyncCredential | null {
  const row = db
    .prepare("SELECT * FROM sync_credentials WHERE connection_fingerprint = ?")
    .get<CredentialRow>(connectionFingerprint);
  if (!row) return null;
  const secret = JSON.parse(openSecret({ ciphertext: row.ciphertext, iv: row.iv, authTag: row.auth_tag }));
  return { ...toMeta(row), secret };
}

/** True when a credential is enrolled for the fingerprint (no decryption). */
export function hasSyncCredential(db: SqliteDatabase, connectionFingerprint: string): boolean {
  const row = db
    .prepare("SELECT 1 AS ok FROM sync_credentials WHERE connection_fingerprint = ?")
    .get<{ ok: number }>(connectionFingerprint);
  return !!row;
}

/** All enrolled credentials as metadata only - safe to return to the client. */
export function listSyncCredentialMeta(db: SqliteDatabase): SyncCredentialMeta[] {
  return db
    .prepare("SELECT * FROM sync_credentials ORDER BY updated_at DESC")
    .all<CredentialRow>()
    .map(toMeta);
}

/** Remove an enrolled credential. */
export function deleteSyncCredential(db: SqliteDatabase, connectionFingerprint: string): void {
  db.prepare("DELETE FROM sync_credentials WHERE connection_fingerprint = ?").run(connectionFingerprint);
}
