import Database from "better-sqlite3";
import { accessSync, constants, existsSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { AppDbUnavailableError, errorMessage } from "./errors";
import { LATEST_SCHEMA_VERSION, readMigrationMeta, runMigrations } from "./migrations";
import type { AppDbHealth, SqliteDatabase } from "./types";

export const DEFAULT_APP_DB_PATH = "/data/actual-bench.sqlite";

type CachedDb = {
  path: string;
  db: SqliteDatabase;
};

type StorageCheck = {
  writable: boolean;
  error?: string;
};

let cachedDb: CachedDb | null = null;

function runtime(): "node" | "vercel" {
  return process.env.VERCEL ? "vercel" : "node";
}

export function resolveAppDbPath(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.ACTUAL_BENCH_DB_PATH?.trim();
  if (configured) return resolve(configured);
  // Vercel's serverless filesystem is read-only except for the OS temp dir, and
  // `/data` does not exist there. With no explicit override, fall back to a
  // writable (but non-durable) temp path so the metadata database can still
  // initialize instead of failing with `ENOENT ... stat '/data'`. App Health
  // already reports the Vercel runtime as non-durable.
  if (env.VERCEL) return resolve(tmpdir(), "actual-bench.sqlite");
  return DEFAULT_APP_DB_PATH;
}

export function hasAppDbPathOverride(env: NodeJS.ProcessEnv = process.env): boolean {
  return !!env.ACTUAL_BENCH_DB_PATH?.trim();
}

export function checkAppDbStorage(dbPath = resolveAppDbPath()): StorageCheck {
  const dir = dirname(dbPath);

  try {
    const dirStat = statSync(dir);
    if (!dirStat.isDirectory()) {
      return { writable: false, error: `Database parent path is not a directory: ${dir}` };
    }

    accessSync(dir, constants.R_OK | constants.W_OK | constants.X_OK);

    if (existsSync(dbPath)) {
      accessSync(dbPath, constants.R_OK | constants.W_OK);
    }

    return { writable: true };
  } catch (error) {
    return { writable: false, error: errorMessage(error) };
  }
}

function closeCachedDb(): void {
  if (cachedDb?.db.open) {
    cachedDb.db.close();
  }
  cachedDb = null;
}

export function getAppDb(dbPath = resolveAppDbPath()): SqliteDatabase {
  const storage = checkAppDbStorage(dbPath);
  if (!storage.writable) {
    throw new AppDbUnavailableError(storage.error ?? `App database path is not writable: ${dbPath}`);
  }

  if (cachedDb && cachedDb.path === dbPath && cachedDb.db.open) {
    return cachedDb.db;
  }

  closeCachedDb();

  const db = new Database(dbPath) as SqliteDatabase;
  try {
    db.pragma("foreign_keys = ON");
    db.pragma("journal_mode = WAL");
    // NORMAL is durable under WAL (only risks the last commit on OS crash, not
    // corruption) and avoids an fsync per write — a large win for the many small
    // writes a sync run makes.
    db.pragma("synchronous = NORMAL");
    runMigrations(db);
    cachedDb = { path: dbPath, db };
    return db;
  } catch (error) {
    if (db.open) db.close();
    throw error instanceof AppDbUnavailableError
      ? error
      : new AppDbUnavailableError(errorMessage(error));
  }
}

export function getAppDbHealth(dbPath = resolveAppDbPath()): AppDbHealth {
  const checkedAt = new Date().toISOString();
  const storage = checkAppDbStorage(dbPath);
  const base = {
    configuredPath: dbPath,
    defaultPath: DEFAULT_APP_DB_PATH,
    envOverride: hasAppDbPathOverride(),
    runtime: runtime(),
    durable: runtime() === "node",
    latestSchemaVersion: LATEST_SCHEMA_VERSION,
    checkedAt,
  } satisfies Omit<AppDbHealth, "status" | "ready" | "writable" | "schemaVersion" | "createdAt" | "lastMigratedAt" | "error">;

  if (!storage.writable) {
    return {
      ...base,
      status: "unavailable",
      ready: false,
      writable: false,
      schemaVersion: null,
      createdAt: null,
      lastMigratedAt: null,
      error: storage.error ?? "App database path is not writable",
    };
  }

  try {
    const db = getAppDb(dbPath);
    const meta = readMigrationMeta(db);
    return {
      ...base,
      status: "ready",
      ready: true,
      writable: true,
      schemaVersion: meta.schemaVersion,
      createdAt: meta.createdAt,
      lastMigratedAt: meta.lastMigratedAt,
    };
  } catch (error) {
    return {
      ...base,
      status: "unavailable",
      ready: false,
      writable: true,
      schemaVersion: null,
      createdAt: null,
      lastMigratedAt: null,
      error: errorMessage(error),
    };
  }
}

export function resetAppDbForTests(): void {
  closeCachedDb();
}
