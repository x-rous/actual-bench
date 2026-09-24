import type {
  BudgetEncryptionCredentialInput,
  RememberedBudget,
  RememberedBudgetInput,
  ServerCredential,
  ServerCredentialMeta,
  ServerCredentialInput,
  SqliteDatabase,
} from "@/lib/app-db/types";
import { serverFingerprint } from "@/lib/sync/connectionRef";
import type { ConnectionMode } from "@/store/connection";
import {
  deleteAllSecrets,
  deleteSecret,
  deleteSecretsWithPrefix,
  getSecret,
  hasSecret,
  putSecret,
  resealPassphraseDomain,
  secretRefs,
  type SecretAccess,
} from "./store";

/**
 * Remembered credentials (RD-063 / PR-028a): the servers and budgets you saved
 * for one-click reconnect.
 *
 * Credentials authenticate you to a server (mode + URL), so one saved server
 * opens any of its budgets; budget encryption passwords stay per-budget. The
 * secrets are sealed in the **passphrase** domain of the credential store, with
 * the key derived from your unlock passphrase (`passphraseVaultKey.ts`); the
 * non-secret parts live in `remembered_servers` and `remembered_budgets`.
 * Nothing here can reach the operator domain - see `store.ts`.
 *
 * Node-only; must never be imported into client code.
 */

function passphrase(key: Buffer): SecretAccess {
  return { domain: "passphrase", key };
}

// ── Remembered servers ──────────────────────────────────────────────────────

type ServerRow = {
  server_fingerprint: string;
  mode: string;
  base_url: string;
  label: string;
  created_at: string;
  updated_at: string;
};

function toServerMeta(row: ServerRow): ServerCredentialMeta {
  return {
    serverFingerprint: row.server_fingerprint,
    // DB column is untyped text; rows only ever hold a valid mode.
    mode: row.mode as ConnectionMode,
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
  const fingerprint = serverFingerprint({ mode: input.mode, baseUrl: input.baseUrl });
  const label = input.label ?? "";

  const store = db.transaction(() => {
    const row = db
      .prepare(
        `INSERT INTO remembered_servers (server_fingerprint, mode, base_url, label, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(server_fingerprint) DO UPDATE SET
           mode = excluded.mode,
           base_url = excluded.base_url,
           label = excluded.label,
           updated_at = excluded.updated_at
         RETURNING created_at`
      )
      .get<{ created_at: string }>(fingerprint, input.mode, input.baseUrl, label, now, now);
    putSecret(db, passphrase(key), {
      ref: secretRefs.server(fingerprint),
      kind: "server-login",
      plaintext: JSON.stringify(input.secret),
      label,
    });
    return row?.created_at ?? now;
  });
  const createdAt = store() as string;

  return {
    serverFingerprint: fingerprint,
    mode: input.mode,
    baseUrl: input.baseUrl,
    label,
    createdAt,
    updatedAt: now,
  };
}

function getServerRow(db: SqliteDatabase, serverFp: string): ServerRow | undefined {
  return db.prepare("SELECT * FROM remembered_servers WHERE server_fingerprint = ?").get<ServerRow>(serverFp);
}

/** Read + decrypt a server credential (server-only). Null when absent. Throws on a wrong key. */
export function getServerCredential(
  db: SqliteDatabase,
  serverFp: string,
  key: Buffer
): ServerCredential | null {
  const row = getServerRow(db, serverFp);
  if (!row) return null;
  const secret = getSecret(db, passphrase(key), secretRefs.server(serverFp));
  if (!secret) return null;
  return { ...toServerMeta(row), secret: JSON.parse(secret.plaintext) };
}

/** True when a server credential is remembered (no decryption). */
export function hasServerCredential(db: SqliteDatabase, serverFp: string): boolean {
  return !!getServerRow(db, serverFp) && hasSecret(db, "passphrase", secretRefs.server(serverFp));
}

/** All remembered servers as metadata only - safe to return to the client. */
export function listServerCredentialMeta(db: SqliteDatabase): ServerCredentialMeta[] {
  return db
    .prepare("SELECT * FROM remembered_servers ORDER BY updated_at DESC")
    .all<ServerRow>()
    .map(toServerMeta);
}

/** Forget a server + all its remembered budgets and budget encryption passwords. */
export function deleteServerCredential(db: SqliteDatabase, serverFp: string): void {
  const remove = db.transaction(() => {
    db.prepare("DELETE FROM remembered_servers WHERE server_fingerprint = ?").run(serverFp);
    deleteSecret(db, "passphrase", secretRefs.server(serverFp));
    deleteSecretsWithPrefix(db, "passphrase", secretRefs.budgetsOfServer(serverFp));
    db.prepare("DELETE FROM remembered_budgets WHERE server_fingerprint = ?").run(serverFp);
  });
  remove();
}

// ── Budget encryption passwords (per-budget, opt-in) ─────────────────────────

/** Seal + store a budget's encryption password under `key`. */
export function upsertBudgetEncryptionCredential(
  db: SqliteDatabase,
  input: BudgetEncryptionCredentialInput,
  key: Buffer
): void {
  putSecret(db, passphrase(key), {
    ref: secretRefs.budget(input.serverFingerprint, input.budgetSyncId),
    kind: "budget-encryption-password",
    plaintext: input.encryptionPassword,
    label: input.label ?? "",
  });
}

/** Read + decrypt a budget's encryption password, or null when not remembered. Throws on a wrong key. */
export function getBudgetEncryptionPassword(
  db: SqliteDatabase,
  serverFp: string,
  budgetSyncId: string,
  key: Buffer
): string | null {
  return getSecret(db, passphrase(key), secretRefs.budget(serverFp, budgetSyncId))?.plaintext ?? null;
}

/** Remove a budget's remembered encryption password. */
export function deleteBudgetEncryptionCredential(db: SqliteDatabase, serverFp: string, budgetSyncId: string): void {
  deleteSecret(db, "passphrase", secretRefs.budget(serverFp, budgetSyncId));
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
    db.prepare("DELETE FROM remembered_budgets WHERE server_fingerprint = ? AND budget_sync_id = ?").run(
      serverFp,
      budgetSyncId
    );
    deleteSecret(db, "passphrase", secretRefs.budget(serverFp, budgetSyncId));
  });
  remove();
}

// ── Vault-wide re-key + reset ────────────────────────────────────────────────

/**
 * Re-seal every remembered secret from `oldKey` to `newKey` (passphrase
 * change), in one transaction. Returns the count re-sealed; rolls back if any
 * secret fails to open under `oldKey`.
 */
export function resealServerVault(db: SqliteDatabase, oldKey: Buffer, newKey: Buffer): number {
  return resealPassphraseDomain(db, oldKey, newKey);
}

/**
 * Remove every remembered server, budget and passphrase-domain secret (full
 * vault reset). Unattended enrolments and backup secrets live in the operator
 * domain and are untouched.
 */
export function deleteAllServerVaultCredentials(db: SqliteDatabase): void {
  const clear = db.transaction(() => {
    db.prepare("DELETE FROM remembered_servers").run();
    db.prepare("DELETE FROM remembered_budgets").run();
    deleteAllSecrets(db, "passphrase");
  });
  clear();
}
