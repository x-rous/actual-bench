import { randomBytes } from "node:crypto";
import { CONNECTION_KDF_PARAMS, CURRENT_KDF_VERSION, deriveKeyFromPassphrase } from "@/lib/sync/vault";
import { getAppMeta, setAppMeta } from "./appMetaRepository";
import { getAppDbHealth } from "./connection";
import type { SqliteDatabase } from "./types";

/**
 * Shared vault key material for the remembered-credentials feature (RD-061,
 * RD-063). The per-install salt + KDF version live here and are used by both the
 * passphrase lifecycle and the server-scoped credential store to derive the
 * AES-256-GCM key from the user's unlock passphrase. Only the salt and KDF
 * version are persisted; the passphrase and derived key are never stored. Kept
 * entirely separate from the `sync_credentials` (unattended `SYNC_VAULT_KEY`)
 * vault.
 *
 * Node-only; must never be imported into client code.
 */

export const SALT_META_KEY = "connection_vault_salt";
export const KDF_VERSION_META_KEY = "connection_vault_kdf_version";
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

/** Read the per-install salt, creating it (and stamping the KDF version) on first use. */
export function getOrCreateConnectionVaultSalt(db: SqliteDatabase): Buffer {
  const existing = getConnectionVaultSalt(db);
  if (existing) return existing;
  const salt = randomBytes(SALT_BYTES);
  setAppMeta(db, SALT_META_KEY, salt.toString("base64"));
  setAppMeta(db, KDF_VERSION_META_KEY, String(CURRENT_KDF_VERSION));
  return salt;
}

/** KDF params for this install's stored version (defaults to current if unset). */
function connectionKdfParams(db: SqliteDatabase) {
  const version = Number(getAppMeta(db, KDF_VERSION_META_KEY) ?? CURRENT_KDF_VERSION);
  return CONNECTION_KDF_PARAMS[version] ?? CONNECTION_KDF_PARAMS[CURRENT_KDF_VERSION];
}

/** True once a passphrase (and therefore a salt) has been established. */
export function hasConnectionPassphrase(db: SqliteDatabase): boolean {
  return getConnectionVaultSalt(db) !== null;
}

/** Derive the vault key from a passphrase using the stored per-install salt + KDF version. */
export function deriveConnectionVaultKey(db: SqliteDatabase, passphrase: string): Buffer {
  return deriveKeyFromPassphrase(passphrase, getOrCreateConnectionVaultSalt(db), connectionKdfParams(db));
}
