import { AppDbValidationError } from "@/lib/app-db/errors";
import type { SqliteDatabase } from "@/lib/app-db/types";
import {
  deleteSecret,
  getSecret,
  getSecretMeta,
  hasSecret,
  listSecretMeta,
  putSecret,
  type SecretAccess,
  type SecretKind,
  type SecretMeta,
} from "./store";

/**
 * Sealed secrets for backups (RD-077 / PR-047b; stored through the credential
 * store since F-195).
 *
 * Destination credentials and backup passphrases, sealed in the **operator**
 * domain under `SYNC_VAULT_KEY`: a scheduled backup has to open them with
 * nobody present. They answer a different question from connection secrets -
 * what Bench needs to *write a copy*, not what it needs to reach a budget - so
 * a destination's keys are never entangled with a connection's lifecycle.
 *
 * Each secret keeps the ref its destination or policy already points at (the
 * destination or policy id), so nothing that references one had to change.
 *
 * Only this module decrypts backup secrets. Everything else works with a `ref`.
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

const OPERATOR: SecretAccess = { domain: "operator" };

/**
 * The store's kind for each backup kind. "passphrase" alone would be ambiguous
 * next to the passphrase key *domain*, so the store names it for what it is.
 */
const STORE_KIND: Record<BackupCredentialKind, SecretKind> = {
  s3: "s3",
  passphrase: "backup-passphrase",
};
const BACKUP_STORE_KINDS: readonly SecretKind[] = Object.values(STORE_KIND);

function isBackupSecret(meta: SecretMeta | null): meta is SecretMeta {
  return meta !== null && BACKUP_STORE_KINDS.includes(meta.kind);
}

function toMeta(meta: SecretMeta): BackupCredentialMeta {
  return {
    ref: meta.ref,
    kind: meta.kind === "backup-passphrase" ? "passphrase" : "s3",
    label: meta.label,
    createdAt: meta.createdAt,
    updatedAt: meta.updatedAt,
  };
}

export function upsertBackupCredential(
  db: SqliteDatabase,
  input: { ref: string; kind: BackupCredentialKind; label?: string; secret: BackupSecret }
): BackupCredentialMeta {
  if (!input.ref.trim()) throw new AppDbValidationError("ref is required");
  return toMeta(
    putSecret(db, OPERATOR, {
      ref: input.ref.trim(),
      kind: STORE_KIND[input.kind],
      plaintext: JSON.stringify(input.secret),
      label: input.label,
    })
  );
}

export function getBackupCredential(db: SqliteDatabase, ref: string): BackupSecret | null {
  if (!isBackupSecret(getSecretMeta(db, "operator", ref))) return null;
  const secret = getSecret(db, OPERATOR, ref);
  return secret ? (JSON.parse(secret.plaintext) as BackupSecret) : null;
}

export function getBackupCredentialMeta(db: SqliteDatabase, ref: string): BackupCredentialMeta | null {
  const meta = getSecretMeta(db, "operator", ref);
  return isBackupSecret(meta) ? toMeta(meta) : null;
}

export function hasBackupCredential(db: SqliteDatabase, ref: string): boolean {
  return hasSecret(db, "operator", ref) && isBackupSecret(getSecretMeta(db, "operator", ref));
}

export function listBackupCredentialMeta(db: SqliteDatabase): BackupCredentialMeta[] {
  return listSecretMeta(db, "operator", BACKUP_STORE_KINDS).map(toMeta);
}

export function deleteBackupCredential(db: SqliteDatabase, ref: string): void {
  if (isBackupSecret(getSecretMeta(db, "operator", ref))) deleteSecret(db, "operator", ref);
}
