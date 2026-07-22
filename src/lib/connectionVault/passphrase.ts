import { deleteAppMeta, getAppMeta, setAppMeta } from "@/lib/app-db/appMetaRepository";
import {
  deriveConnectionVaultKey,
  getConnectionVaultSalt,
  KDF_VERSION_META_KEY,
  SALT_META_KEY,
} from "@/lib/app-db/connectionCredentialRepository";
import { deleteAllServerVaultCredentials, resealServerVault } from "@/lib/app-db/serverCredentialRepository";
import { openWithKey, sealWithKey, type SealedSecret } from "@/lib/sync/vault";
import type { SqliteDatabase } from "@/lib/app-db/types";

/**
 * Passphrase lifecycle for the remembered-connection vault (RD-061 / PR-026b).
 *
 * A passphrase is validated against a sealed **verifier** blob — a known
 * constant sealed with the passphrase-derived key — so we can check a passphrase
 * without decrypting any real credential and without a decryption oracle on user
 * data. Only the salt + verifier blob are stored; the passphrase and derived key
 * are never persisted.
 *
 * Node-only; must never be imported into client code.
 */

const VERIFIER_META_KEY = "connection_vault_verifier";
const VERIFIER_PLAINTEXT = "actual-bench:connection-vault:v1";

/** True once a passphrase has been set (a verifier exists). */
export function isPassphraseSet(db: SqliteDatabase): boolean {
  return getAppMeta(db, VERIFIER_META_KEY) !== null && getConnectionVaultSalt(db) !== null;
}

function readVerifier(db: SqliteDatabase): SealedSecret | null {
  const raw = getAppMeta(db, VERIFIER_META_KEY);
  if (!raw) return null;
  return JSON.parse(raw) as SealedSecret;
}

function writeVerifier(db: SqliteDatabase, key: Buffer): void {
  setAppMeta(db, VERIFIER_META_KEY, JSON.stringify(sealWithKey(VERIFIER_PLAINTEXT, key)));
}

/**
 * Establish the passphrase for the first time. Creates the salt (via key
 * derivation) and stores the verifier. Throws if a passphrase is already set.
 */
export function setPassphrase(db: SqliteDatabase, passphrase: string): void {
  if (isPassphraseSet(db)) {
    throw new Error("A vault passphrase is already set; use change instead.");
  }
  const key = deriveConnectionVaultKey(db, passphrase); // creates the salt on first use
  writeVerifier(db, key);
}

/**
 * Verify a passphrase. Returns the derived key on success, or null on failure
 * (wrong passphrase / no passphrase set) — success/failure only, no oracle.
 */
export function verifyPassphrase(db: SqliteDatabase, passphrase: string): Buffer | null {
  const verifier = readVerifier(db);
  const salt = getConnectionVaultSalt(db);
  if (!verifier || !salt) return null;
  const key = deriveConnectionVaultKey(db, passphrase);
  try {
    if (openWithKey(verifier, key) !== VERIFIER_PLAINTEXT) return null;
    return key;
  } catch {
    return null; // GCM auth-tag failure = wrong passphrase
  }
}

/**
 * Change the passphrase: verify the current one, re-seal every remembered
 * credential and the verifier under the new key, atomically. Returns false when
 * the current passphrase is wrong. Salt is unchanged (a new passphrase yields a
 * new key regardless).
 */
export function changePassphrase(db: SqliteDatabase, currentPassphrase: string, newPassphrase: string): boolean {
  const oldKey = verifyPassphrase(db, currentPassphrase);
  if (!oldKey) return false;
  const newKey = deriveConnectionVaultKey(db, newPassphrase);
  const apply = db.transaction(() => {
    resealServerVault(db, oldKey, newKey);
    writeVerifier(db, newKey);
  });
  apply();
  return true;
}

/**
 * Reset the vault when the passphrase is forgotten (RD-063). Since the key is
 * never stored, sealed secrets can't be recovered — so we drop them along with
 * the salt, KDF version, and verifier. Afterwards `isPassphraseSet` is false and
 * the user starts fresh with a new passphrase. Runs in one transaction.
 */
export function resetVault(db: SqliteDatabase): void {
  const apply = db.transaction(() => {
    deleteAllServerVaultCredentials(db);
    deleteAppMeta(db, VERIFIER_META_KEY);
    deleteAppMeta(db, SALT_META_KEY);
    deleteAppMeta(db, KDF_VERSION_META_KEY);
  });
  apply();
}
