import { randomBytes } from "node:crypto";
import { deriveKeyFromPassphrase, openWithKey, sealWithKey } from "@/lib/sync/vault";
import { getAppMeta, setAppMeta } from "./appMetaRepository";
import { getAppDbHealth } from "./connection";
import type {
  ConnectionCredential,
  ConnectionCredentialInput,
  ConnectionCredentialMeta,
  SqliteDatabase,
} from "./types";

/**
 * App-DB repository for remembered connection credentials (RD-061 / PR-026a).
 *
 * Secrets are sealed with a key the caller supplies — derived from the user's
 * unlock passphrase and the per-install salt — so the server cannot decrypt on
 * its own (there is no app auth). Only the salt and AES-256-GCM blobs are
 * persisted; the passphrase and derived key are never stored. Kept entirely
 * separate from the `sync_credentials` (unattended `SYNC_VAULT_KEY`) vault.
 *
 * Node-only; must never be imported into client code.
 */

const SALT_META_KEY = "connection_vault_salt";
const SALT_BYTES = 16;

/**
 * The remembered-credentials feature is only available when the metadata DB is
 * durable. On an ephemeral runtime (e.g. Vercel's `/tmp`) the sealed blobs would
 * not survive a restart, so we neither offer nor accept enrollment there.
 */
export function rememberedCredentialsSupported(): boolean {
  return getAppDbHealth().durable;
}

/** The per-install salt as base64, or null when no passphrase has been set yet. */
export function getConnectionVaultSalt(db: SqliteDatabase): Buffer | null {
  const raw = getAppMeta(db, SALT_META_KEY);
  return raw ? Buffer.from(raw, "base64") : null;
}

/** Read the per-install salt, creating it on first use. */
export function getOrCreateConnectionVaultSalt(db: SqliteDatabase): Buffer {
  const existing = getConnectionVaultSalt(db);
  if (existing) return existing;
  const salt = randomBytes(SALT_BYTES);
  setAppMeta(db, SALT_META_KEY, salt.toString("base64"));
  return salt;
}

/** True once a passphrase (and therefore a salt) has been established. */
export function hasConnectionPassphrase(db: SqliteDatabase): boolean {
  return getConnectionVaultSalt(db) !== null;
}

/** Derive the vault key from a passphrase using the stored per-install salt. */
export function deriveConnectionVaultKey(db: SqliteDatabase, passphrase: string): Buffer {
  return deriveKeyFromPassphrase(passphrase, getOrCreateConnectionVaultSalt(db));
}

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

function toMeta(row: CredentialRow): ConnectionCredentialMeta {
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

/** Seal and store (insert or replace) a remembered credential under `key`. */
export function upsertConnectionCredential(
  db: SqliteDatabase,
  input: ConnectionCredentialInput,
  key: Buffer
): ConnectionCredentialMeta {
  const now = new Date().toISOString();
  const sealed = sealWithKey(JSON.stringify(input.secret), key);

  const row = db
    .prepare(
      `INSERT INTO connection_credentials (
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

/**
 * Read + decrypt a remembered credential (server-only). Null when absent. Throws
 * if `key` is wrong or the ciphertext was tampered with (GCM auth-tag mismatch).
 */
export function getConnectionCredential(
  db: SqliteDatabase,
  connectionFingerprint: string,
  key: Buffer
): ConnectionCredential | null {
  const row = db
    .prepare("SELECT * FROM connection_credentials WHERE connection_fingerprint = ?")
    .get<CredentialRow>(connectionFingerprint);
  if (!row) return null;
  const secret = JSON.parse(openWithKey({ ciphertext: row.ciphertext, iv: row.iv, authTag: row.auth_tag }, key));
  return { ...toMeta(row), secret };
}

/** True when a credential is remembered for the fingerprint (no decryption). */
export function hasConnectionCredential(db: SqliteDatabase, connectionFingerprint: string): boolean {
  const row = db
    .prepare("SELECT 1 AS ok FROM connection_credentials WHERE connection_fingerprint = ?")
    .get<{ ok: number }>(connectionFingerprint);
  return !!row;
}

/** All remembered credentials as metadata only - safe to return to the client. */
export function listConnectionCredentialMeta(db: SqliteDatabase): ConnectionCredentialMeta[] {
  return db
    .prepare("SELECT * FROM connection_credentials ORDER BY updated_at DESC")
    .all<CredentialRow>()
    .map(toMeta);
}

/** Remove a remembered credential. */
export function deleteConnectionCredential(db: SqliteDatabase, connectionFingerprint: string): void {
  db.prepare("DELETE FROM connection_credentials WHERE connection_fingerprint = ?").run(connectionFingerprint);
}

/**
 * Re-seal every remembered credential from `oldKey` to `newKey` (passphrase
 * change). Runs in one transaction; if any blob fails to open under `oldKey`
 * the whole change is rolled back so the store never ends up half re-keyed.
 */
export function resealConnectionCredentials(db: SqliteDatabase, oldKey: Buffer, newKey: Buffer): number {
  const rows = db.prepare("SELECT * FROM connection_credentials").all<CredentialRow>();
  const reseal = db.transaction(() => {
    for (const row of rows) {
      const plaintext = openWithKey({ ciphertext: row.ciphertext, iv: row.iv, authTag: row.auth_tag }, oldKey);
      const sealed = sealWithKey(plaintext, newKey);
      db.prepare(
        `UPDATE connection_credentials
           SET ciphertext = ?, iv = ?, auth_tag = ?, updated_at = ?
         WHERE connection_fingerprint = ?`
      ).run(sealed.ciphertext, sealed.iv, sealed.authTag, new Date().toISOString(), row.connection_fingerprint);
    }
    return rows.length;
  });
  return reseal();
}
