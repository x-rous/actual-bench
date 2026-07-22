import { openWithKey, sealWithKey } from "@/lib/sync/vault";
import type {
  BudgetEncryptionCredentialInput,
  RememberedBudget,
  RememberedBudgetInput,
  ServerCredential,
  ServerCredentialInput,
  ServerCredentialMeta,
  SqliteDatabase,
} from "./types";
import { serverFingerprint } from "@/lib/sync/connectionRef";

/**
 * App-DB repository for **server-scoped** remembered credentials (RD-063 / PR-028a).
 *
 * Credentials authenticate you to a server (mode + URL), so one saved server
 * opens any of its budgets. Budget encryption passwords stay per-budget. Both are
 * sealed with the passphrase-derived vault key (shared salt/KDF live in
 * `connectionCredentialRepository` during the transition and are re-exported
 * from there). Only AES-256-GCM blobs are persisted; the key is never stored.
 *
 * Node-only; must never be imported into client code.
 */

// ── Server credentials ───────────────────────────────────────────────────────

type ServerRow = {
  server_fingerprint: string;
  mode: string;
  base_url: string;
  label: string;
  ciphertext: string;
  iv: string;
  auth_tag: string;
  created_at: string;
  updated_at: string;
};

function toServerMeta(row: ServerRow): ServerCredentialMeta {
  return {
    serverFingerprint: row.server_fingerprint,
    mode: row.mode,
    baseUrl: row.base_url,
    label: row.label,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Seal and store (insert or replace) a server's credential under `key`. */
export function upsertServerCredential(
  db: SqliteDatabase,
  input: ServerCredentialInput,
  key: Buffer
): ServerCredentialMeta {
  const now = new Date().toISOString();
  const fingerprint = serverFingerprint({ mode: input.mode as never, baseUrl: input.baseUrl });
  const sealed = sealWithKey(JSON.stringify(input.secret), key);

  const row = db
    .prepare(
      `INSERT INTO server_credentials (
         server_fingerprint, mode, base_url, label, ciphertext, iv, auth_tag, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(server_fingerprint) DO UPDATE SET
         mode = excluded.mode,
         base_url = excluded.base_url,
         label = excluded.label,
         ciphertext = excluded.ciphertext,
         iv = excluded.iv,
         auth_tag = excluded.auth_tag,
         updated_at = excluded.updated_at
       RETURNING created_at`
    )
    .get<{ created_at: string }>(
      fingerprint,
      input.mode,
      input.baseUrl,
      input.label ?? "",
      sealed.ciphertext,
      sealed.iv,
      sealed.authTag,
      now,
      now
    );

  return {
    serverFingerprint: fingerprint,
    mode: input.mode,
    baseUrl: input.baseUrl,
    label: input.label ?? "",
    createdAt: row?.created_at ?? now,
    updatedAt: now,
  };
}

/** Read + decrypt a server credential (server-only). Null when absent. Throws on a wrong key. */
export function getServerCredential(
  db: SqliteDatabase,
  serverFp: string,
  key: Buffer
): ServerCredential | null {
  const row = db
    .prepare("SELECT * FROM server_credentials WHERE server_fingerprint = ?")
    .get<ServerRow>(serverFp);
  if (!row) return null;
  const secret = JSON.parse(openWithKey({ ciphertext: row.ciphertext, iv: row.iv, authTag: row.auth_tag }, key));
  return { ...toServerMeta(row), secret };
}

/** True when a server credential is remembered (no decryption). */
export function hasServerCredential(db: SqliteDatabase, serverFp: string): boolean {
  const row = db.prepare("SELECT 1 AS ok FROM server_credentials WHERE server_fingerprint = ?").get<{ ok: number }>(serverFp);
  return !!row;
}

/** All remembered servers as metadata only - safe to return to the client. */
export function listServerCredentialMeta(db: SqliteDatabase): ServerCredentialMeta[] {
  return db.prepare("SELECT * FROM server_credentials ORDER BY updated_at DESC").all<ServerRow>().map(toServerMeta);
}

/** Forget a server + all its remembered budgets and budget encryption passwords. */
export function deleteServerCredential(db: SqliteDatabase, serverFp: string): void {
  const remove = db.transaction(() => {
    db.prepare("DELETE FROM server_credentials WHERE server_fingerprint = ?").run(serverFp);
    db.prepare("DELETE FROM budget_encryption_credentials WHERE server_fingerprint = ?").run(serverFp);
    db.prepare("DELETE FROM remembered_budgets WHERE server_fingerprint = ?").run(serverFp);
  });
  remove();
}

// ── Budget encryption passwords (per-budget, opt-in) ─────────────────────────

type BudgetEncRow = {
  server_fingerprint: string;
  budget_sync_id: string;
  label: string;
  ciphertext: string;
  iv: string;
  auth_tag: string;
  created_at: string;
  updated_at: string;
};

/** Seal + store a budget's encryption password under `key`. */
export function upsertBudgetEncryptionCredential(
  db: SqliteDatabase,
  input: BudgetEncryptionCredentialInput,
  key: Buffer
): void {
  const now = new Date().toISOString();
  const sealed = sealWithKey(input.encryptionPassword, key);
  db.prepare(
    `INSERT INTO budget_encryption_credentials (
       server_fingerprint, budget_sync_id, label, ciphertext, iv, auth_tag, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(server_fingerprint, budget_sync_id) DO UPDATE SET
       label = excluded.label,
       ciphertext = excluded.ciphertext,
       iv = excluded.iv,
       auth_tag = excluded.auth_tag,
       updated_at = excluded.updated_at`
  ).run(input.serverFingerprint, input.budgetSyncId, input.label ?? "", sealed.ciphertext, sealed.iv, sealed.authTag, now, now);
}

/** Read + decrypt a budget's encryption password, or null when not remembered. Throws on a wrong key. */
export function getBudgetEncryptionPassword(
  db: SqliteDatabase,
  serverFp: string,
  budgetSyncId: string,
  key: Buffer
): string | null {
  const row = db
    .prepare("SELECT * FROM budget_encryption_credentials WHERE server_fingerprint = ? AND budget_sync_id = ?")
    .get<BudgetEncRow>(serverFp, budgetSyncId);
  if (!row) return null;
  return openWithKey({ ciphertext: row.ciphertext, iv: row.iv, authTag: row.auth_tag }, key);
}

/** Remove a budget's remembered encryption password. */
export function deleteBudgetEncryptionCredential(db: SqliteDatabase, serverFp: string, budgetSyncId: string): void {
  db.prepare("DELETE FROM budget_encryption_credentials WHERE server_fingerprint = ? AND budget_sync_id = ?").run(serverFp, budgetSyncId);
}

// ── Remembered budgets (non-secret; one-click reconnect) ─────────────────────

type RememberedBudgetRow = {
  server_fingerprint: string;
  budget_sync_id: string;
  name: string;
  created_at: string;
  last_opened_at: string;
};

function toRememberedBudget(row: RememberedBudgetRow): RememberedBudget {
  return {
    serverFingerprint: row.server_fingerprint,
    budgetSyncId: row.budget_sync_id,
    name: row.name,
    createdAt: row.created_at,
    lastOpenedAt: row.last_opened_at,
  };
}

/** Record (or refresh) a budget opened on a remembered server. Holds no secret. */
export function upsertRememberedBudget(db: SqliteDatabase, input: RememberedBudgetInput): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO remembered_budgets (server_fingerprint, budget_sync_id, name, created_at, last_opened_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(server_fingerprint, budget_sync_id) DO UPDATE SET
       name = excluded.name,
       last_opened_at = excluded.last_opened_at`
  ).run(input.serverFingerprint, input.budgetSyncId, input.name ?? "", now, now);
}

/** All remembered budgets (metadata only), most-recently-opened first. */
export function listRememberedBudgets(db: SqliteDatabase): RememberedBudget[] {
  return db
    .prepare("SELECT * FROM remembered_budgets ORDER BY last_opened_at DESC")
    .all<RememberedBudgetRow>()
    .map(toRememberedBudget);
}

/** Forget a remembered budget and any encryption password stored for it. */
export function deleteRememberedBudget(db: SqliteDatabase, serverFp: string, budgetSyncId: string): void {
  const remove = db.transaction(() => {
    db.prepare("DELETE FROM remembered_budgets WHERE server_fingerprint = ? AND budget_sync_id = ?").run(serverFp, budgetSyncId);
    db.prepare("DELETE FROM budget_encryption_credentials WHERE server_fingerprint = ? AND budget_sync_id = ?").run(serverFp, budgetSyncId);
  });
  remove();
}

// ── Vault-wide re-key + reset ────────────────────────────────────────────────

/**
 * Re-seal every server credential + budget encryption password from `oldKey` to
 * `newKey` (passphrase change), in one transaction. Returns the count re-sealed;
 * rolls back if any blob fails to open under `oldKey`.
 */
export function resealServerVault(db: SqliteDatabase, oldKey: Buffer, newKey: Buffer): number {
  const servers = db.prepare("SELECT * FROM server_credentials").all<ServerRow>();
  const budgets = db.prepare("SELECT * FROM budget_encryption_credentials").all<BudgetEncRow>();
  const reseal = db.transaction(() => {
    for (const row of servers) {
      const plaintext = openWithKey({ ciphertext: row.ciphertext, iv: row.iv, authTag: row.auth_tag }, oldKey);
      const sealed = sealWithKey(plaintext, newKey);
      db.prepare("UPDATE server_credentials SET ciphertext=?, iv=?, auth_tag=?, updated_at=? WHERE server_fingerprint=?")
        .run(sealed.ciphertext, sealed.iv, sealed.authTag, new Date().toISOString(), row.server_fingerprint);
    }
    for (const row of budgets) {
      const plaintext = openWithKey({ ciphertext: row.ciphertext, iv: row.iv, authTag: row.auth_tag }, oldKey);
      const sealed = sealWithKey(plaintext, newKey);
      db.prepare(
        "UPDATE budget_encryption_credentials SET ciphertext=?, iv=?, auth_tag=?, updated_at=? WHERE server_fingerprint=? AND budget_sync_id=?"
      ).run(sealed.ciphertext, sealed.iv, sealed.authTag, new Date().toISOString(), row.server_fingerprint, row.budget_sync_id);
    }
    return servers.length + budgets.length;
  });
  return reseal();
}

/** Remove all server credentials, budget encryption passwords, and remembered budgets (full vault reset). */
export function deleteAllServerVaultCredentials(db: SqliteDatabase): void {
  const clear = db.transaction(() => {
    db.prepare("DELETE FROM server_credentials").run();
    db.prepare("DELETE FROM budget_encryption_credentials").run();
    db.prepare("DELETE FROM remembered_budgets").run();
  });
  clear();
}
