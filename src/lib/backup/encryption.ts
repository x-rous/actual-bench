import { createCipheriv, createDecipheriv, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { BackupEncryptionInfo } from "./manifest";

/**
 * Optional at-rest encryption for backup artifacts (RD-077 / PR-047c).
 *
 * Off by default and per policy, because for most self-hosters the backup lands
 * on a volume they already control and encryption only adds a way to lose the
 * data permanently. It matters the moment a copy goes somewhere they do not
 * control — a bucket, a friend's NAS — and that is exactly when it must be
 * airtight.
 *
 * The encrypted file is **self-describing**: an eight-byte magic, the KDF
 * parameters, salt, IV and auth tag all precede the ciphertext. The manifest
 * carries the same values, but a backup whose recovery depends on a second file
 * being present is not a backup. Given the passphrase, `bench-restore` — or a
 * dozen lines of Node — can decrypt an artifact with nothing else at hand.
 *
 * What is never written anywhere: the passphrase, and the key derived from it.
 */

const MAGIC = Buffer.from("BENCHBK1", "ascii");
const FORMAT_VERSION = 1;
const KEY_BYTES = 32;
const SALT_BYTES = 16;
const IV_BYTES = 12;

/**
 * scrypt cost. N=2^15 takes roughly a tenth of a second on a small VPS — slow
 * enough to make a stolen artifact expensive to attack, fast enough that a
 * nightly backup does not notice.
 */
const SCRYPT_PARAMS = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export class BackupDecryptionError extends Error {
  constructor(message: string, options: { cause?: unknown } = {}) {
    super(message);
    this.name = "BackupDecryptionError";
    if (options.cause !== undefined) this.cause = options.cause;
  }
}

function deriveKey(passphrase: string, salt: Buffer): Buffer {
  return scryptSync(passphrase.normalize("NFKC"), salt, KEY_BYTES, SCRYPT_PARAMS);
}

export type EncryptedArchive = {
  bytes: Buffer;
  info: BackupEncryptionInfo;
};

export function encryptArchive(plaintext: Uint8Array, passphrase: string): EncryptedArchive {
  if (!passphrase.trim()) {
    throw new Error("A passphrase is required to encrypt a backup.");
  }

  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const key = deriveKey(passphrase, salt);

  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();

  const header = Buffer.concat([
    MAGIC,
    Buffer.from([FORMAT_VERSION, SALT_BYTES, IV_BYTES, authTag.length]),
    salt,
    iv,
    authTag,
  ]);

  return {
    bytes: Buffer.concat([header, ciphertext]),
    info: {
      algorithm: "aes-256-gcm",
      kdf: "scrypt",
      salt: salt.toString("base64"),
      iv: iv.toString("base64"),
      authTag: authTag.toString("base64"),
    },
  };
}

/** True when these bytes carry Bench's encrypted-artifact header. */
export function isEncryptedArchive(bytes: Uint8Array): boolean {
  if (bytes.byteLength < MAGIC.length) return false;
  const head = Buffer.from(bytes.subarray(0, MAGIC.length));
  return head.length === MAGIC.length && timingSafeEqual(head, MAGIC);
}

/**
 * Decrypt an artifact using only the artifact itself.
 *
 * Failure messages distinguish "this is not one of ours" from "the passphrase
 * is wrong", because a wrong passphrase is a thing the user can fix and a
 * corrupt file is not, and telling them apart at 3am matters.
 */
export function decryptArchive(bytes: Uint8Array, passphrase: string): Buffer {
  const buffer = Buffer.from(bytes);
  if (!isEncryptedArchive(buffer)) {
    throw new BackupDecryptionError("This file is not an encrypted Bench backup.");
  }

  let offset = MAGIC.length;
  const version = buffer[offset];
  const saltLength = buffer[offset + 1];
  const ivLength = buffer[offset + 2];
  const tagLength = buffer[offset + 3];
  offset += 4;

  if (version !== FORMAT_VERSION) {
    throw new BackupDecryptionError(
      `This backup was written in encryption format ${version}, which this version of Bench cannot read.`
    );
  }

  const salt = buffer.subarray(offset, offset + saltLength);
  offset += saltLength;
  const iv = buffer.subarray(offset, offset + ivLength);
  offset += ivLength;
  const authTag = buffer.subarray(offset, offset + tagLength);
  offset += tagLength;
  const ciphertext = buffer.subarray(offset);

  if (salt.length !== saltLength || iv.length !== ivLength || authTag.length !== tagLength) {
    throw new BackupDecryptionError("This backup's encryption header is truncated or corrupt.");
  }

  try {
    const decipher = createDecipheriv("aes-256-gcm", deriveKey(passphrase, Buffer.from(salt)), iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch (error) {
    // GCM cannot tell a wrong key from tampered bytes, so say both.
    throw new BackupDecryptionError(
      "Could not decrypt this backup. Either the passphrase is wrong or the file has been altered.",
      { cause: error }
    );
  }
}
