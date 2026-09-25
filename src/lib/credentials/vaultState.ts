import type { SqliteDatabase } from "@/lib/app-db/types";
import { logger } from "@/lib/logger";
import { deriveOperatorKey, openWithKey, VaultLockedError } from "@/lib/sync/vault";
import {
  createVaultKeyFile,
  findVaultKey,
  moveUnreadableVaultKeyFile,
  vaultKeyPath,
  type VaultKeySource,
  type VaultKeyWarning,
} from "./vaultKey";
import type { VaultLockReason, VaultSummary } from "./vaultSummary";

/**
 * Whether the operator vault can be used, decided from the data itself (F-197).
 *
 * The vault always exists. Its key is found (see `vaultKey.ts`) or, on a fresh
 * install, generated. The one rule that matters: **a key is generated only
 * when no operator secret is stored.** A missing key file is not proof there
 * never was a key - a volume recreated with a restored database, or an
 * environment variable dropped during an upgrade, look exactly like that - so
 * whenever sealed secrets exist, the only acceptable key is one that opens
 * them. Testing the candidate against a stored secret answers that directly,
 * with nothing extra stored.
 *
 * Server-only.
 */

type VaultStateBase = {
  /** Where Bench keeps (or would keep) a generated key. Not secret. */
  keyPath: string;
  /** How many operator-domain secrets are stored. */
  storedSecrets: number;
  /** Where the key came from, when one was found. */
  source?: VaultKeySource;
  warning?: VaultKeyWarning;
};

export type VaultState =
  | (VaultStateBase & {
      status: "ready";
      source: VaultKeySource;
      /** True when this call created the key file. */
      generated?: boolean;
    })
  | (VaultStateBase & {
      status: "locked";
      reason: VaultLockReason;
      /** The underlying error for `unreadable` / `cannot-create`. Never key material. */
      detail?: string;
    });

/** Reasons a reset can fix. `cannot-create` is a storage problem; there is nothing to clear. */
const RESETTABLE: readonly VaultLockReason[] = ["missing", "wrong-key", "unreadable"];

export class VaultResetRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VaultResetRefusedError";
  }
}

type SealedRow = { ciphertext: string; iv: string; auth_tag: string };

function operatorRows(db: SqliteDatabase): SealedRow[] {
  return db
    .prepare("SELECT ciphertext, iv, auth_tag FROM credentials WHERE domain = 'operator'")
    .all<SealedRow>();
}

/** True when the key opens at least one stored secret. GCM means one success is proof. */
function opensAny(secret: string, rows: SealedRow[]): boolean {
  const key = deriveOperatorKey(secret);
  for (const row of rows) {
    try {
      openWithKey({ ciphertext: row.ciphertext, iv: row.iv, authTag: row.auth_tag }, key);
      return true;
    } catch {
      // Try the next one: a single damaged row must not lock the whole vault.
    }
  }
  return false;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The vault's state, generating its key first if this is a fresh install.
 * Safe to call from anywhere, as often as needed: it only ever creates a key
 * when nothing is stored, and creation is first-writer-wins.
 */
export function getVaultState(db: SqliteDatabase, env: NodeJS.ProcessEnv = process.env): VaultState {
  const keyPath = vaultKeyPath(env);
  const rows = operatorRows(db);
  const base = { keyPath, storedSecrets: rows.length };
  const lookup = findVaultKey(env);

  if (lookup.kind === "unreadable") {
    return { ...base, status: "locked", reason: "unreadable", detail: lookup.error };
  }

  if (lookup.kind === "found") {
    const found = { ...base, source: lookup.source, ...(lookup.warning ? { warning: lookup.warning } : {}) };
    if (rows.length > 0 && !opensAny(lookup.secret, rows)) {
      return { ...found, status: "locked", reason: "wrong-key" };
    }
    return { ...found, status: "ready" };
  }

  if (rows.length > 0) return { ...base, status: "locked", reason: "missing" };

  try {
    createVaultKeyFile(env);
  } catch (error) {
    return { ...base, status: "locked", reason: "cannot-create", detail: describeError(error) };
  }
  logger.info(`[vault] generated a new vault key at ${keyPath}`);
  return { ...base, status: "ready", source: "file", generated: true };
}

/** Just what the browser may see. */
export function summarizeVault(state: VaultState): VaultSummary {
  return state.status === "ready" ? { status: "ready" } : { status: "locked", reason: state.reason };
}

export function getVaultSummary(db: SqliteDatabase): VaultSummary {
  return summarizeVault(getVaultState(db));
}

/**
 * For anything that is about to need the vault: throws `VaultLockedError`
 * (a 409 from any route, through `appDbErrorResponse`) unless it is ready.
 */
export function requireReadyVault(db: SqliteDatabase): void {
  const state = getVaultState(db);
  if (state.status !== "ready") throw new VaultLockedError(state.reason);
}

/**
 * Clear a locked vault so it can start again: every operator-domain secret and
 * every unattended enrolment goes, in one transaction. Remembered credentials
 * (the passphrase domain) are never touched.
 *
 * Refused unless the vault is locked for a reason a reset fixes. Bench has no
 * login, so this route is reachable by anyone who reaches the server; refusing
 * on a working vault means one request cannot wipe it.
 */
export function resetVault(db: SqliteDatabase, env: NodeJS.ProcessEnv = process.env): VaultState {
  const before = getVaultState(db, env);
  if (before.status !== "locked" || !RESETTABLE.includes(before.reason)) {
    throw new VaultResetRefusedError(
      before.status === "ready"
        ? "The vault is working, so there is nothing to reset."
        : "A reset can't fix this. Bench needs a writable data folder to create its vault key."
    );
  }

  const clear = db.transaction(() => {
    db.prepare("DELETE FROM credentials WHERE domain = 'operator'").run();
    db.prepare("DELETE FROM unattended_connections").run();
  });
  clear();

  if (before.reason === "unreadable") {
    try {
      const movedTo = moveUnreadableVaultKeyFile(env);
      logger.warn(`[vault] moved the unreadable key file aside to ${movedTo}`);
    } catch (error) {
      logger.warn(`[vault] could not move the unreadable key file aside: ${describeError(error)}`);
    }
  }

  logger.warn(`[vault] reset: cleared ${before.storedSecrets} stored secret(s) and every unattended enrolment`);
  return getVaultState(db, env);
}

/** One startup line, so the operator can see where the key came from. Never the key. */
export function logVaultState(state: VaultState): void {
  if (state.warning === "legacy-name") {
    logger.warn("[vault] SYNC_VAULT_KEY is deprecated; rename it to ACTUAL_BENCH_VAULT_KEY");
  } else if (state.warning === "both-names") {
    logger.warn(
      "[vault] ACTUAL_BENCH_VAULT_KEY and SYNC_VAULT_KEY are both set and differ; using ACTUAL_BENCH_VAULT_KEY"
    );
  }
  if (state.status === "locked") {
    logger.warn(
      `[vault] locked (${state.reason})${state.detail ? `: ${state.detail}` : ""}. Automations that need stored credentials will pause; see App Health.`
    );
    return;
  }
  if (state.generated) return; // getVaultState already said so.
  const from =
    state.source === "file"
      ? `key file ${state.keyPath}`
      : state.source === "legacy-environment"
        ? "SYNC_VAULT_KEY"
        : "ACTUAL_BENCH_VAULT_KEY";
  logger.info(`[vault] ready (key from ${from})`);
}
