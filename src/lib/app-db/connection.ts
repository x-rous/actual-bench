import Database from "better-sqlite3";
import { accessSync, constants, existsSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { AppDbUnavailableError, errorMessage } from "./errors";
import { LATEST_SCHEMA_VERSION, readMigrationMeta, runMigrations } from "./migrations";
import { logger } from "@/lib/logger";
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

/**
 * A full rebuild is worth its cost once this much of the file is dead space.
 * Below it, incremental vacuum on the engine tick keeps up on its own.
 */
const COMPACT_FREE_PAGE_FRACTION = 0.25;

/**
 * In WAL mode a `VACUUM` does not shrink anything by itself.
 *
 * It writes the compacted database into the *write-ahead log*; the main file is
 * only rewritten at a checkpoint, and only shrunk by a TRUNCATE one. This
 * process holds a single connection open for its whole life and nothing else
 * checkpoints, so without this the reclaimed space never lands: the file stays
 * at its high-water mark and the WAL grows to match it. Measured on a real
 * install - 150 MB of file holding 9 MB of data, alongside a 160 MB WAL.
 *
 * Safe to call at any time: a checkpoint that cannot run (a reader is active)
 * reports busy and changes nothing.
 */
function checkpointToDisk(db: SqliteDatabase): void {
  db.pragma("wal_checkpoint(TRUNCATE)");
}

/**
 * Keep the file roughly the size of the data in it.
 *
 * Two jobs, and the second is not a one-time migration. Switching `auto_vacuum`
 * to INCREMENTAL does need a `VACUUM` and only has to happen once - but a *bulk
 * delete after that point* (schema v33 purging six figures of run items, say)
 * leaves the pages behind, and the original version of this returned early
 * whenever the mode was already set, so exactly the deletes worth reclaiming
 * were the ones it skipped. Incremental vacuum on the tick does drain that, but
 * only a few MB at a time and never visibly, because nothing checkpointed.
 *
 * So: compact whenever a meaningful share of the file is dead space, whatever
 * the mode already is, and checkpoint afterwards so the result reaches the disk.
 */
function reclaimFreeSpace(db: SqliteDatabase): void {
  try {
    const mode = (db.pragma("auto_vacuum") as Array<{ auto_vacuum: number }>)[0]?.auto_vacuum;
    const pages = (db.pragma("page_count") as Array<{ page_count: number }>)[0]?.page_count ?? 0;
    const free = (db.pragma("freelist_count") as Array<{ freelist_count: number }>)[0]?.freelist_count ?? 0;

    const needsMode = mode !== 2;
    const worthCompacting = pages > 0 && free / pages > COMPACT_FREE_PAGE_FRACTION;
    if (!needsMode && !worthCompacting) {
      // Still worth settling the WAL: it is what grows without bound otherwise.
      checkpointToDisk(db);
      return;
    }

    if (needsMode) db.pragma("auto_vacuum = INCREMENTAL");
    db.exec("VACUUM");
    checkpointToDisk(db);
  } catch (error) {
    logger.warn(`[app-db] could not reclaim free space: ${errorMessage(error)}`);
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
    reclaimFreeSpace(db);
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
