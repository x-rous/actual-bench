import { randomBytes } from "node:crypto";
import {
  chmodSync,
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { resolveAppDbPath } from "@/lib/app-db/connection";
import { logger } from "@/lib/logger";

/**
 * Where the operator vault's key comes from (F-197).
 *
 * The operator domain of the credential store - unattended enrolments, S3 keys,
 * backup passphrases - is sealed with one key, found in this order:
 *
 *   1. `ACTUAL_BENCH_VAULT_KEY`
 *   2. `SYNC_VAULT_KEY`, its deprecated name, so an upgrade never locks anyone out
 *   3. `secrets/vault.key` beside the metadata database, which Bench generates on
 *      a fresh install (see `vaultState.ts` for when it may)
 *
 * Nothing here is cached. Route bundles, the instrumentation hook and worker
 * threads each hold their own copy of this module, and after a reset or a
 * restored key file all of them must agree at once; reading a 44-byte file per
 * seal is far cheaper than keeping caches in step.
 *
 * Never logs or returns key material other than to `vault.ts`, which derives
 * the AES key from it.
 */

export const VAULT_KEY_ENV = "ACTUAL_BENCH_VAULT_KEY";
export const LEGACY_VAULT_KEY_ENV = "SYNC_VAULT_KEY";

export type VaultKeySource = "environment" | "legacy-environment" | "file";

/** Something about the configuration worth telling the operator, never a failure. */
export type VaultKeyWarning = "legacy-name" | "both-names";

export type VaultKeyLookup =
  | { kind: "found"; secret: string; source: VaultKeySource; warning?: VaultKeyWarning }
  | { kind: "none" }
  /** The key file exists but gives no key: empty, unreadable, or not a file. */
  | { kind: "unreadable"; error: string };

function envValue(env: NodeJS.ProcessEnv, name: string): string | null {
  const value = env[name];
  return value && value.trim().length > 0 ? value : null;
}

/** The generated key's home: beside the metadata database, on the same volume. */
export function vaultKeyPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(dirname(resolveAppDbPath(env)), "secrets", "vault.key");
}

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code: unknown }).code)
    : undefined;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Look the key up without creating anything. */
export function findVaultKey(env: NodeJS.ProcessEnv = process.env): VaultKeyLookup {
  const current = envValue(env, VAULT_KEY_ENV);
  const legacy = envValue(env, LEGACY_VAULT_KEY_ENV);
  if (current) {
    // The old name still set, even to the same value, is worth a warning: it
    // will stop being read, and whoever set it should know before then.
    if (!legacy) return { kind: "found", secret: current, source: "environment" };
    const warning = legacy === current ? "legacy-name" : "both-names";
    return { kind: "found", secret: current, source: "environment", warning };
  }
  if (legacy) return { kind: "found", secret: legacy, source: "legacy-environment", warning: "legacy-name" };

  const path = vaultKeyPath(env);
  let content: string;
  try {
    content = readFileSync(path, "utf8");
  } catch (error) {
    // No file, or no folder to hold one (something else sits where the
    // folder should be): either way there is no key yet, and creating one will
    // say what is wrong with the path.
    const code = errorCode(error);
    if (code === "ENOENT" || code === "ENOTDIR") return { kind: "none" };
    return { kind: "unreadable", error: describeError(error) };
  }
  const secret = content.trim();
  if (!secret) return { kind: "unreadable", error: `${path} is empty` };
  return { kind: "found", secret, source: "file" };
}

function bestEffortChmod(path: string, mode: number): void {
  try {
    chmodSync(path, mode);
  } catch (error) {
    // Some mounts (SMB, certain bind mounts) have no POSIX modes. The key is
    // still written; the operator is told once why it may be wider than asked.
    logger.warn(`[vault] could not restrict permissions on ${path}: ${describeError(error)}`);
  }
}

/**
 * Generate a key and write it, first writer wins. Returns the key that ended up
 * in the file, which is another writer's when this one lost the race.
 *
 * One exclusive create (`wx`): it never replaces an existing key file. The
 * only gap is a crash between creating the file and writing it, which leaves
 * an empty file; that reads as `unreadable`, so nothing is ever sealed with it
 * and a vault reset moves it aside.
 *
 * Throws when the directory cannot be written. The caller decides what that
 * means; it must never carry on with a key that was not persisted.
 */
export function createVaultKeyFile(env: NodeJS.ProcessEnv = process.env): string {
  const path = vaultKeyPath(env);
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  bestEffortChmod(dir, 0o700);

  let fd: number | null = null;
  try {
    fd = openSync(path, "wx", 0o600);
  } catch (error) {
    // Another writer won. Theirs is the key.
    if (errorCode(error) !== "EEXIST") throw error;
  }
  if (fd !== null) {
    try {
      writeSync(fd, `${randomBytes(32).toString("base64url")}\n`);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    bestEffortChmod(path, 0o600);
  }

  // The file, not the lookup order: this reports what was persisted.
  const secret = readFileSync(path, "utf8").trim();
  if (!secret) throw new Error(`The vault key at ${path} is empty`);
  return secret;
}

/**
 * Move an unreadable key file aside so a reset can start again. Renamed, never
 * deleted: if it held something after all, it is still there to recover.
 */
export function moveUnreadableVaultKeyFile(env: NodeJS.ProcessEnv = process.env): string {
  const path = vaultKeyPath(env);
  const target = `${path}.unreadable-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  renameSync(path, target);
  return target;
}
