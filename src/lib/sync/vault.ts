import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from "node:crypto";

/**
 * Server-side credential vault primitives (RD-058 / PR-024a; generalized in
 * RD-061 / PR-026a).
 *
 * Secrets are sealed with AES-256-GCM. Two keying paths share the same
 * primitives:
 *  - **Env key** (`sealSecret`/`openSecret`): derived from the operator
 *    `SYNC_VAULT_KEY` env var, for unattended server-side sync.
 *  - **Explicit key** (`sealWithKey`/`openWithKey`): a caller-supplied 32-byte
 *    key, e.g. one derived from a user unlock passphrase for remembered
 *    connection credentials.
 * In both cases the key is NEVER stored beside the ciphertext.
 *
 * Node-only (uses `node:crypto`); must never be imported into client code.
 */

const ALGORITHM = "aes-256-gcm";
const DERIVED_KEY_BYTES = 32;

/** Thrown when a vault operation is attempted without `SYNC_VAULT_KEY` set. */
export class VaultDisabledError extends Error {
  constructor() {
    super("Credential vault is disabled: set the SYNC_VAULT_KEY environment variable to enable unattended sync.");
    this.name = "VaultDisabledError";
  }
}

/** Derive a stable 32-byte key from the operator secret, or null if unset. */
function vaultKey(): Buffer | null {
  const secret = process.env.SYNC_VAULT_KEY;
  if (!secret || secret.trim().length === 0) return null;
  return createHash("sha256").update(secret, "utf8").digest();
}

/** True when the vault is configured (env key present). */
export function vaultEnabled(): boolean {
  return vaultKey() !== null;
}

/** An AES-256-GCM sealed value; all fields base64. */
export type SealedSecret = { ciphertext: string; iv: string; authTag: string };

/** Seal plaintext with an explicit 32-byte key. */
export function sealWithKey(plaintext: string, key: Buffer): SealedSecret {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    ciphertext: enc.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
  };
}

/**
 * Open a sealed value with an explicit key. Throws a plain Error if the
 * ciphertext was tampered with or the key is wrong (GCM auth-tag mismatch) -
 * callers treat any failure as "cannot decrypt".
 */
export function openWithKey(sealed: SealedSecret, key: Buffer): string {
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(sealed.iv, "base64"));
  decipher.setAuthTag(Buffer.from(sealed.authTag, "base64"));
  const dec = Buffer.concat([decipher.update(Buffer.from(sealed.ciphertext, "base64")), decipher.final()]);
  return dec.toString("utf8");
}

/**
 * Derive a 32-byte key from a user passphrase and a per-install salt (scrypt).
 * The passphrase and derived key must never be persisted. Used by the
 * remembered-connection vault (RD-061); unrelated to `SYNC_VAULT_KEY`.
 */
export function deriveKeyFromPassphrase(passphrase: string, salt: Buffer): Buffer {
  return scryptSync(passphrase, salt, DERIVED_KEY_BYTES);
}

/** Seal plaintext with the env (`SYNC_VAULT_KEY`) key. Throws VaultDisabledError if unset. */
export function sealSecret(plaintext: string): SealedSecret {
  const key = vaultKey();
  if (!key) throw new VaultDisabledError();
  return sealWithKey(plaintext, key);
}

/**
 * Open a sealed value with the env key. Throws VaultDisabledError if unset, and
 * a plain Error if the ciphertext was tampered with or the key changed (GCM auth
 * tag mismatch) - callers treat any failure as "cannot decrypt → pause".
 */
export function openSecret(sealed: SealedSecret): string {
  const key = vaultKey();
  if (!key) throw new VaultDisabledError();
  return openWithKey(sealed, key);
}
