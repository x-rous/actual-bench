import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * Server-side credential vault primitives (RD-058 / PR-024a).
 *
 * Secrets needed for unattended sync are sealed with AES-256-GCM. The key is
 * derived from the operator-provided `SYNC_VAULT_KEY` env var and is NEVER stored
 * beside the ciphertext. With the env var unset the vault is disabled: nothing
 * can be sealed or opened, and the whole unattended feature stays off.
 *
 * Node-only (uses `node:crypto`); must never be imported into client code.
 */

const ALGORITHM = "aes-256-gcm";

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

/** Seal plaintext with the vault key. Throws VaultDisabledError if unset. */
export function sealSecret(plaintext: string): SealedSecret {
  const key = vaultKey();
  if (!key) throw new VaultDisabledError();
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
 * Open a sealed value. Throws VaultDisabledError if the key is unset, and a
 * plain Error if the ciphertext was tampered with or the key changed (GCM auth
 * tag mismatch) - callers treat any failure as "cannot decrypt → pause".
 */
export function openSecret(sealed: SealedSecret): string {
  const key = vaultKey();
  if (!key) throw new VaultDisabledError();
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(sealed.iv, "base64"));
  decipher.setAuthTag(Buffer.from(sealed.authTag, "base64"));
  const dec = Buffer.concat([decipher.update(Buffer.from(sealed.ciphertext, "base64")), decipher.final()]);
  return dec.toString("utf8");
}
