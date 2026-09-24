import type {
  SqliteDatabase,
  SyncCredential,
  SyncCredentialInput,
  SyncCredentialMeta,
} from "@/lib/app-db/types";
import { logger } from "@/lib/logger";
import { serverFingerprint } from "@/lib/sync/connectionRef";
import { vaultEnabled } from "@/lib/sync/vault";
import type { ConnectionMode } from "@/store/connection";
import {
  deleteSecret,
  getSecret,
  getSecretMeta,
  hasSecret,
  putSecret,
  secretRefs,
  type SecretAccess,
} from "./store";

/**
 * Unattended enrolment (RD-058; reshaped by F-195): the connections Bench may
 * act on with nobody present.
 *
 * An enrolment names one budget on one server (`unattended_connections`,
 * keyed by the connection fingerprint that automations, sync flows and backup
 * policies already point at). The secrets behind it live in the **operator**
 * domain of the credential store, sealed with `SYNC_VAULT_KEY`, and are shaped
 * the way the server actually authenticates:
 *
 *   * one server secret per server - an HTTP API key today, an Actual server
 *     password once Direct can be enrolled - shared by every budget enrolled on
 *     that server, so rotating it is one change, not one per budget;
 *   * an optional encryption password per budget.
 *
 * Before v35 each enrolment sealed its own `{ apiKey, encryptionPassword }`
 * blob. The migration cannot open those (it runs without the key), so it kept
 * them whole as `legacy` secrets; `upgradeLegacyUnattendedCredentials` splits
 * them once the key is available, at boot or on first use.
 *
 * Node-only; must never be imported into client code.
 */

const OPERATOR: SecretAccess = { domain: "operator" };

/**
 * The server half of an unattended credential: an actual-http-api key, or the
 * Actual server's own password for a Direct connection (RD-095). Direct stores
 * the password rather than a session token: every password-login client shares
 * one token, and it survives a password change (M0, Appendix B).
 */
export type UnattendedServerSecret =
  | { kind: "http-api"; apiKey: string }
  | { kind: "direct"; serverPassword: string };

export type UnattendedSecret = {
  server: UnattendedServerSecret;
  encryptionPassword?: string;
};

type ConnectionRow = {
  connection_fingerprint: string;
  server_fingerprint: string;
  mode: string;
  base_url: string;
  budget_sync_id: string;
  label: string;
  created_at: string;
  updated_at: string;
};

function toMeta(row: ConnectionRow): SyncCredentialMeta {
  return {
    connectionFingerprint: row.connection_fingerprint,
    mode: row.mode,
    baseUrl: row.base_url,
    budgetSyncId: row.budget_sync_id,
    label: row.label,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function getConnectionRow(db: SqliteDatabase, connectionFingerprint: string): ConnectionRow | undefined {
  return db
    .prepare("SELECT * FROM unattended_connections WHERE connection_fingerprint = ?")
    .get<ConnectionRow>(connectionFingerprint);
}

function serverSecretFor(input: SyncCredentialInput): UnattendedServerSecret {
  if (input.mode === "http-api" && input.secret.apiKey) {
    return { kind: "http-api", apiKey: input.secret.apiKey };
  }
  if (input.mode === "browser-api" && input.secret.serverPassword) {
    return { kind: "direct", serverPassword: input.secret.serverPassword };
  }
  throw new Error(
    input.mode === "browser-api"
      ? "A Direct connection is enrolled with its server password."
      : "An HTTP API connection is enrolled with its API key."
  );
}

/** Enrol (insert or replace) a connection and seal its secrets. Requires an enabled vault. */
export function upsertSyncCredential(db: SqliteDatabase, input: SyncCredentialInput): SyncCredentialMeta {
  const now = new Date().toISOString();
  const serverFp = serverFingerprint({ mode: input.mode as ConnectionMode, baseUrl: input.baseUrl });
  const label = input.label ?? "";
  const server = serverSecretFor(input);

  const enrol = db.transaction(() => {
    const row = db
      .prepare(
        `INSERT INTO unattended_connections (
           connection_fingerprint, server_fingerprint, mode, base_url, budget_sync_id, label, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(connection_fingerprint) DO UPDATE SET
           server_fingerprint = excluded.server_fingerprint,
           mode = excluded.mode,
           base_url = excluded.base_url,
           budget_sync_id = excluded.budget_sync_id,
           label = excluded.label,
           updated_at = excluded.updated_at
         RETURNING created_at`
      )
      .get<{ created_at: string }>(
        input.connectionFingerprint,
        serverFp,
        input.mode,
        input.baseUrl,
        input.budgetSyncId,
        label,
        now,
        now
      );

    putSecret(db, OPERATOR, {
      ref: secretRefs.server(serverFp),
      kind: "server-login",
      plaintext: JSON.stringify(server),
      label,
    });

    const budgetRef = secretRefs.budget(serverFp, input.budgetSyncId);
    if (input.secret.encryptionPassword) {
      putSecret(db, OPERATOR, {
        ref: budgetRef,
        kind: "budget-encryption-password",
        plaintext: input.secret.encryptionPassword,
        label,
      });
    } else {
      // Enrolling without a password replaces one stored before, exactly as
      // replacing the whole blob did.
      deleteSecret(db, "operator", budgetRef);
    }
    // Anything left from before v35 is superseded by what was just written.
    deleteSecret(db, "operator", secretRefs.legacyConnection(input.connectionFingerprint));

    return row?.created_at ?? now;
  });
  const createdAt = enrol() as string;

  return {
    connectionFingerprint: input.connectionFingerprint,
    mode: input.mode,
    baseUrl: input.baseUrl,
    budgetSyncId: input.budgetSyncId,
    label,
    createdAt,
    updatedAt: now,
  };
}

/**
 * The secrets for an enrolled connection, in the shape the server
 * authenticates with. Null when not enrolled. Throws when the vault is
 * disabled or its key cannot open them - callers pause, never guess.
 */
export function resolveUnattendedSecret(db: SqliteDatabase, connectionFingerprint: string): UnattendedSecret | null {
  const row = getConnectionRow(db, connectionFingerprint);
  if (!row) return null;

  // Every pre-v35 secret on this server, not just this connection's: which
  // one wins depends on the order they are applied in.
  if (hasSecret(db, "operator", secretRefs.legacyConnection(connectionFingerprint))) {
    upgradeLegacyRows(db, legacyRowsOfServer(db, row.server_fingerprint), { throwOnFailure: true });
  }

  const server = getSecret(db, OPERATOR, secretRefs.server(row.server_fingerprint));
  if (!server) return null;
  const encryptionPassword = getSecret(db, OPERATOR, secretRefs.budget(row.server_fingerprint, row.budget_sync_id))
    ?.plaintext;

  return {
    server: JSON.parse(server.plaintext) as UnattendedServerSecret,
    ...(encryptionPassword ? { encryptionPassword } : {}),
  };
}

/** Read + decrypt a credential (server-only). Null when absent. Throws if the
 *  vault is locked or the ciphertext can't be opened - callers pause the flow. */
export function getSyncCredential(db: SqliteDatabase, connectionFingerprint: string): SyncCredential | null {
  const row = getConnectionRow(db, connectionFingerprint);
  if (!row) return null;
  const secret = resolveUnattendedSecret(db, connectionFingerprint);
  if (!secret) return null;
  return {
    ...toMeta(row),
    secret: {
      ...(secret.server.kind === "http-api"
        ? { apiKey: secret.server.apiKey }
        : { serverPassword: secret.server.serverPassword }),
      ...(secret.encryptionPassword ? { encryptionPassword: secret.encryptionPassword } : {}),
    },
  };
}

/** True when a credential is enrolled for the fingerprint (no decryption). */
export function hasSyncCredential(db: SqliteDatabase, connectionFingerprint: string): boolean {
  const row = getConnectionRow(db, connectionFingerprint);
  if (!row) return false;
  return (
    hasSecret(db, "operator", secretRefs.server(row.server_fingerprint)) ||
    hasSecret(db, "operator", secretRefs.legacyConnection(connectionFingerprint))
  );
}

/** All enrolled credentials as metadata only - safe to return to the client. */
export function listSyncCredentialMeta(db: SqliteDatabase): SyncCredentialMeta[] {
  return db
    .prepare("SELECT * FROM unattended_connections ORDER BY updated_at DESC")
    .all<ConnectionRow>()
    .map(toMeta);
}

/**
 * Withdraw an enrolment. The server secret goes too once no other budget on
 * that server is still enrolled; remembered credentials are never touched.
 */
export function deleteSyncCredential(db: SqliteDatabase, connectionFingerprint: string): void {
  const withdraw = db.transaction(() => {
    const row = getConnectionRow(db, connectionFingerprint);
    db.prepare("DELETE FROM unattended_connections WHERE connection_fingerprint = ?").run(connectionFingerprint);
    deleteSecret(db, "operator", secretRefs.legacyConnection(connectionFingerprint));
    if (!row) return;

    deleteSecret(db, "operator", secretRefs.budget(row.server_fingerprint, row.budget_sync_id));
    const stillEnrolled = db
      .prepare("SELECT 1 AS ok FROM unattended_connections WHERE server_fingerprint = ? LIMIT 1")
      .get<{ ok: number }>(row.server_fingerprint);
    if (!stillEnrolled) deleteSecret(db, "operator", secretRefs.server(row.server_fingerprint));
  });
  withdraw();
}

// ── Pre-v35 secrets ─────────────────────────────────────────────────────────

type LegacySecret = { apiKey: string; encryptionPassword?: string };

/**
 * Split one pre-v35 secret into its server and budget parts, then drop it.
 *
 * The server secret is written only when nothing newer is already there: a
 * credential enrolled after the upgrade always wins, and among legacy secrets
 * for one server the most recently updated wins (callers go newest first).
 * Two enrolled budgets on one server can disagree only after a key rotation,
 * so the newest is the one that works; the disagreement is logged.
 */
function upgradeLegacyConnection(db: SqliteDatabase, row: ConnectionRow): boolean {
  const legacyRef = secretRefs.legacyConnection(row.connection_fingerprint);
  const legacy = getSecret(db, OPERATOR, legacyRef);
  if (!legacy) return false;
  const parsed = JSON.parse(legacy.plaintext) as LegacySecret;

  const upgrade = db.transaction(() => {
    const serverRef = secretRefs.server(row.server_fingerprint);
    const existing = getSecretMeta(db, "operator", serverRef);
    if (!existing || existing.updatedAt < legacy.meta.updatedAt) {
      putSecret(db, OPERATOR, {
        ref: serverRef,
        kind: "server-login",
        plaintext: JSON.stringify({ kind: "http-api", apiKey: parsed.apiKey } satisfies UnattendedServerSecret),
        label: row.label,
      });
    } else {
      const current = JSON.parse(getSecret(db, OPERATOR, serverRef)?.plaintext ?? "{}") as { apiKey?: string };
      if (current.apiKey !== parsed.apiKey) {
        logger.warn(
          `[credentials] enrolments on ${row.base_url} held different API keys; keeping the most recently updated one`
        );
      }
    }

    const budgetRef = secretRefs.budget(row.server_fingerprint, row.budget_sync_id);
    if (parsed.encryptionPassword && !getSecretMeta(db, "operator", budgetRef)) {
      putSecret(db, OPERATOR, {
        ref: budgetRef,
        kind: "budget-encryption-password",
        plaintext: parsed.encryptionPassword,
        label: row.label,
      });
    }

    deleteSecret(db, "operator", legacyRef);
  });
  upgrade();
  return true;
}

function legacyRowsOfServer(db: SqliteDatabase, serverFp: string): ConnectionRow[] {
  return db
    .prepare("SELECT * FROM unattended_connections WHERE server_fingerprint = ?")
    .all<ConnectionRow>(serverFp);
}

/**
 * Apply pre-v35 secrets newest first: the first write for a server is its
 * newest key, and every older one then finds something newer already there.
 */
function upgradeLegacyRows(
  db: SqliteDatabase,
  rows: ConnectionRow[],
  options: { throwOnFailure: boolean }
): { upgraded: number; failed: number } {
  const pending = rows
    .flatMap((row) => {
      const meta = getSecretMeta(db, "operator", secretRefs.legacyConnection(row.connection_fingerprint));
      return meta ? [{ row, updatedAt: meta.updatedAt }] : [];
    })
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));

  let upgraded = 0;
  let failed = 0;
  for (const { row } of pending) {
    try {
      if (upgradeLegacyConnection(db, row)) upgraded += 1;
    } catch (error) {
      if (options.throwOnFailure) throw error;
      failed += 1;
      logger.warn(
        `[credentials] could not upgrade the unattended credential for ${row.base_url}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
  return { upgraded, failed };
}

/**
 * Split every pre-v35 unattended secret, newest first. Run at boot; the same
 * happens per server on first use. A no-op without the vault key, and when
 * there is nothing left to split. A secret the key cannot open is left exactly
 * as it was, and reported.
 */
export function upgradeLegacyUnattendedCredentials(db: SqliteDatabase): { upgraded: number; failed: number } {
  if (!vaultEnabled()) return { upgraded: 0, failed: 0 };
  const result = upgradeLegacyRows(db, db.prepare("SELECT * FROM unattended_connections").all<ConnectionRow>(), {
    throwOnFailure: false,
  });
  if (result.upgraded > 0) {
    logger.info(`[credentials] split ${result.upgraded} unattended credential(s) into server and budget secrets`);
  }
  return result;
}
