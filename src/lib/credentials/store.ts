import { openSecret, openWithKey, sealSecret, sealWithKey, VaultLockedError, type SealedSecret } from "@/lib/sync/vault";
import { AppDbValidationError } from "@/lib/app-db/errors";
import type { SqliteDatabase } from "@/lib/app-db/types";
import { getVaultState } from "./vaultState";
import { vaultLockedError } from "./vaultSummary";

/**
 * The one place secrets are stored (F-195).
 *
 * Every secret Bench keeps - a remembered server's password, an unattended
 * connection's API key, a budget's encryption password, an S3 key, a backup
 * passphrase - is a row in `credentials`, sealed with AES-256-GCM. The feature
 * modules on top (`rememberedCredentials`, `unattendedCredentials`,
 * `backupSecrets`) own their own non-secret records and decide *what* to store;
 * this module decides *how*, once.
 *
 * **Two key domains, never mixed.** Each row belongs to exactly one:
 *
 *   * `passphrase` - sealed with a key derived from the user's unlock
 *     passphrase. Remembered credentials. Readable only while the user has the
 *     vault unlocked.
 *   * `operator` - sealed with the vault key (`ACTUAL_BENCH_VAULT_KEY` or the
 *     generated key file, see `vaultKey.ts`). Unattended enrolment and backup
 *     secrets. Readable by the server on its own.
 *
 * RD-061 chose the passphrase for remembered credentials *because* Bench has no
 * login: a server that could open them unattended would hand them to anyone
 * who reaches it. So the domain is part of every row's identity, every call
 * names it, and there is deliberately no function here that reads a secret in
 * one domain and writes it in the other. Moving a secret across domains means
 * the user supplying it again.
 *
 * Node-only; must never be imported into client code.
 */

export type SecretDomain = "passphrase" | "operator";

/** What a secret is. Stored for listing and filtering; the payload is opaque here. */
export type SecretKind =
  | "server-login"
  | "budget-encryption-password"
  | "s3"
  | "backup-passphrase"
  /** An unattended secret from before v35, not yet split into server + budget parts. */
  | "legacy-http-connection";

/**
 * How a call reaches its domain's key. The operator key comes from the vault
 * key source; a passphrase key only ever comes from the caller, who holds it
 * because the user unlocked the vault.
 */
export type SecretAccess = { domain: "operator" } | { domain: "passphrase"; key: Buffer };

/** The key id new rows are sealed under. Rotation will add others; rows record theirs. */
export const CURRENT_KEY_ID = "v1";

/**
 * Refs name what a secret belongs to. Built only here, and never parsed: two
 * refs are the same secret or they are not. Backup secrets keep the opaque ids
 * their destinations and policies already point at, so they need no builder.
 */
export const secretRefs = {
  server: (serverFingerprint: string) => `server:${serverFingerprint}`,
  budget: (serverFingerprint: string, budgetSyncId: string) => `budget:${serverFingerprint}:${budgetSyncId}`,
  /** Every budget secret under one server, for cascades. */
  budgetsOfServer: (serverFingerprint: string) => `budget:${serverFingerprint}:`,
  legacyConnection: (connectionFingerprint: string) => `legacy:${connectionFingerprint}`,
} as const;

export type SecretMeta = {
  domain: SecretDomain;
  ref: string;
  kind: SecretKind;
  label: string;
  keyId: string;
  createdAt: string;
  updatedAt: string;
};

type SecretRow = {
  domain: string;
  ref: string;
  kind: string;
  label: string;
  ciphertext: string;
  iv: string;
  auth_tag: string;
  key_id: string;
  created_at: string;
  updated_at: string;
};

function toMeta(row: SecretRow): SecretMeta {
  return {
    domain: row.domain as SecretDomain,
    ref: row.ref,
    kind: row.kind as SecretKind,
    label: row.label,
    keyId: row.key_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function seal(access: SecretAccess, plaintext: string): SealedSecret {
  return access.domain === "operator" ? sealSecret(plaintext) : sealWithKey(plaintext, access.key);
}

function open(access: SecretAccess, sealed: SealedSecret): string {
  return access.domain === "operator" ? openSecret(sealed) : openWithKey(sealed, access.key);
}

function requireRef(ref: string): string {
  const trimmed = ref.trim();
  if (!trimmed) throw new AppDbValidationError("A secret needs a ref");
  return trimmed;
}

/**
 * Seal and store (insert or replace) a secret in `access.domain`.
 *
 * Replacing is only ever replacing *the same kind* of secret. Every feature
 * shares one ref space per domain - backup secrets and unattended server keys
 * both live in the operator domain - so a write whose ref happened to match
 * another feature's secret would otherwise silently turn, say, a server's API
 * key into an S3 key. It is refused instead.
 */
export function putSecret(
  db: SqliteDatabase,
  access: SecretAccess,
  input: { ref: string; kind: SecretKind; plaintext: string; label?: string }
): SecretMeta {
  const ref = requireRef(input.ref);
  if (access.domain === "operator") {
    // Never seal a new secret under a key that does not open the ones already
    // stored: the vault would then hold two keys' worth of secrets, and no key
    // could open them all. This is also where a fresh install gets its key.
    const state = getVaultState(db);
    if (state.status !== "ready") {
      throw new VaultLockedError(vaultLockedError({ status: "locked", reason: state.reason ?? "missing" }));
    }
  }
  const now = new Date().toISOString();
  const sealed = seal(access, input.plaintext);

  const result = db.prepare(
    `INSERT INTO credentials (
       domain, ref, kind, label, ciphertext, iv, auth_tag, key_id, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(domain, ref) DO UPDATE SET
       label = excluded.label,
       ciphertext = excluded.ciphertext,
       iv = excluded.iv,
       auth_tag = excluded.auth_tag,
       key_id = excluded.key_id,
       updated_at = excluded.updated_at
     WHERE credentials.kind = excluded.kind`
  ).run(
    access.domain,
    ref,
    input.kind,
    input.label ?? "",
    sealed.ciphertext,
    sealed.iv,
    sealed.authTag,
    CURRENT_KEY_ID,
    now,
    now
  );
  if (result.changes === 0) {
    throw new AppDbValidationError("A different kind of secret is already stored under this ref");
  }

  const meta = getSecretMeta(db, access.domain, ref);
  if (!meta) throw new AppDbValidationError("Failed to store the secret");
  return meta;
}

/**
 * Open a secret, or null when there is none. Throws when the key is wrong or
 * missing - never returns a guess, and never touches the stored ciphertext.
 */
export function getSecret(
  db: SqliteDatabase,
  access: SecretAccess,
  ref: string
): { meta: SecretMeta; plaintext: string } | null {
  const row = db
    .prepare("SELECT * FROM credentials WHERE domain = ? AND ref = ?")
    .get<SecretRow>(access.domain, ref);
  if (!row) return null;
  const plaintext = open(access, { ciphertext: row.ciphertext, iv: row.iv, authTag: row.auth_tag });
  return { meta: toMeta(row), plaintext };
}

/** Metadata only, no decryption. */
export function getSecretMeta(db: SqliteDatabase, domain: SecretDomain, ref: string): SecretMeta | null {
  const row = db.prepare("SELECT * FROM credentials WHERE domain = ? AND ref = ?").get<SecretRow>(domain, ref);
  return row ? toMeta(row) : null;
}

export function hasSecret(db: SqliteDatabase, domain: SecretDomain, ref: string): boolean {
  return !!db
    .prepare("SELECT 1 AS ok FROM credentials WHERE domain = ? AND ref = ?")
    .get<{ ok: number }>(domain, ref);
}

/** Metadata for every secret of the given kinds in a domain, newest first. */
export function listSecretMeta(
  db: SqliteDatabase,
  domain: SecretDomain,
  kinds: readonly SecretKind[]
): SecretMeta[] {
  if (kinds.length === 0) return [];
  const placeholders = kinds.map(() => "?").join(", ");
  return db
    .prepare(
      `SELECT * FROM credentials WHERE domain = ? AND kind IN (${placeholders}) ORDER BY updated_at DESC`
    )
    .all<SecretRow>(domain, ...kinds)
    .map(toMeta);
}

export function deleteSecret(db: SqliteDatabase, domain: SecretDomain, ref: string): void {
  db.prepare("DELETE FROM credentials WHERE domain = ? AND ref = ?").run(domain, ref);
}

/** Delete every secret in a domain whose ref starts with `prefix` (a cascade). */
export function deleteSecretsWithPrefix(db: SqliteDatabase, domain: SecretDomain, prefix: string): void {
  // Escaped so a ref can never widen the match: the prefix is literal text.
  const escaped = prefix.replace(/[\\%_]/g, (character) => `\\${character}`);
  db.prepare("DELETE FROM credentials WHERE domain = ? AND ref LIKE ? ESCAPE '\\'").run(domain, `${escaped}%`);
}

/** Delete every secret in one domain. The other domain is untouched by construction. */
export function deleteAllSecrets(db: SqliteDatabase, domain: SecretDomain): void {
  db.prepare("DELETE FROM credentials WHERE domain = ?").run(domain);
}

/**
 * Re-seal every passphrase-domain secret from `oldKey` to `newKey`, in one
 * transaction: a passphrase change. Rolls back, leaving every row as it was,
 * if any secret fails to open under `oldKey`. Returns how many were re-sealed.
 *
 * Passphrase domain only. The operator key is the vault key, and rotating it is
 * a separate, deliberate operation (key ids exist for it).
 */
export function resealPassphraseDomain(db: SqliteDatabase, oldKey: Buffer, newKey: Buffer): number {
  const rows = db.prepare("SELECT * FROM credentials WHERE domain = 'passphrase'").all<SecretRow>();
  const reseal = db.transaction(() => {
    const update = db.prepare(
      "UPDATE credentials SET ciphertext = ?, iv = ?, auth_tag = ?, key_id = ?, updated_at = ? WHERE domain = 'passphrase' AND ref = ?"
    );
    for (const row of rows) {
      const plaintext = openWithKey({ ciphertext: row.ciphertext, iv: row.iv, authTag: row.auth_tag }, oldKey);
      const sealed = sealWithKey(plaintext, newKey);
      update.run(sealed.ciphertext, sealed.iv, sealed.authTag, CURRENT_KEY_ID, new Date().toISOString(), row.ref);
    }
    return rows.length;
  });
  return reseal() as number;
}
