import { openSecret, sealSecret } from "@/lib/sync/vault";
import { AppDbValidationError } from "./errors";
import type { SqliteDatabase } from "./types";

/**
 * Sealed secrets for backups (RD-077 / PR-047b).
 *
 * Destination credentials and backup passphrases, encrypted at rest under
 * `SYNC_VAULT_KEY` exactly as the sync vault does. Kept in their own table
 * because they answer a different question — what Bench needs to *write a copy*
 * rather than what it needs to reach a budget — and because a destination's
 * keys should not be entangled with a connection's lifecycle.
 *
 * Only this module decrypts. Everything else works with a `ref`.
 */

export type BackupCredentialKind = "s3" | "passphrase";

export type S3Credentials = {
  accessKeyId: string;
  secretAccessKey: string;
  /** Some providers (temporary credentials) need this too. */
  sessionToken?: string;
};

export type PassphraseCredential = { passphrase: string };

export type BackupSecret = S3Credentials | PassphraseCredential;

export type BackupCredentialMeta = {
  ref: string;
  kind: BackupCredentialKind;
  label: string;
  createdAt: string;
  updatedAt: string;
};

type Row = {
  ref: string;
  kind: string;
  label: string;
  ciphertext: string;
  iv: string;
  auth_tag: string;
  created_at: string;
  updated_at: string;
};

function toMeta(row: Row): BackupCredentialMeta {
  return {
    ref: row.ref,
    kind: row.kind as BackupCredentialKind,
    label: row.label,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Seal and store. Requires an enabled vault; fails closed if there is none. */
export function upsertBackupCredential(
  db: SqliteDatabase,
  input: { ref: string; kind: BackupCredentialKind; label?: string; secret: BackupSecret }
): BackupCredentialMeta {
  if (!input.ref.trim()) throw new AppDbValidationError("ref is required");
  const now = new Date().toISOString();
  const sealed = sealSecret(JSON.stringify(input.secret));

  db.prepare(
    `INSERT INTO backup_credentials (ref, kind, label, ciphertext, iv, auth_tag, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(ref) DO UPDATE SET
       kind = excluded.kind,
       label = excluded.label,
       ciphertext = excluded.ciphertext,
       iv = excluded.iv,
       auth_tag = excluded.auth_tag,
       updated_at = excluded.updated_at`
  ).run(
    input.ref.trim(),
    input.kind,
    input.label ?? "",
    sealed.ciphertext,
    sealed.iv,
    sealed.authTag,
    now,
    now
  );

  const meta = getBackupCredentialMeta(db, input.ref.trim());
  if (!meta) throw new AppDbValidationError("Failed to store backup credential");
  return meta;
}

/** Read + decrypt (server-only). Null when absent; throws if the vault cannot open it. */
export function getBackupCredential(db: SqliteDatabase, ref: string): BackupSecret | null {
  const row = db.prepare("SELECT * FROM backup_credentials WHERE ref = ?").get<Row>(ref);
  if (!row) return null;
  return JSON.parse(
    openSecret({ ciphertext: row.ciphertext, iv: row.iv, authTag: row.auth_tag })
  ) as BackupSecret;
}

/** Non-secret metadata — safe to return to the browser. */
export function getBackupCredentialMeta(db: SqliteDatabase, ref: string): BackupCredentialMeta | null {
  const row = db.prepare("SELECT * FROM backup_credentials WHERE ref = ?").get<Row>(ref);
  return row ? toMeta(row) : null;
}

export function hasBackupCredential(db: SqliteDatabase, ref: string): boolean {
  return !!db.prepare("SELECT 1 AS ok FROM backup_credentials WHERE ref = ?").get<{ ok: number }>(ref);
}

export function listBackupCredentialMeta(db: SqliteDatabase): BackupCredentialMeta[] {
  return db
    .prepare("SELECT * FROM backup_credentials ORDER BY updated_at DESC")
    .all<Row>()
    .map(toMeta);
}

export function deleteBackupCredential(db: SqliteDatabase, ref: string): void {
  db.prepare("DELETE FROM backup_credentials WHERE ref = ?").run(ref);
}
