import { statSync } from "node:fs";
import { COMPACT_FREE_PAGE_FRACTION, getAppDb, resolveAppDbPath } from "./connection";
import { errorMessage } from "./errors";
import type { SqliteDatabase } from "./types";

/**
 * What Bench's own database is made of (on request, from App health).
 *
 * Answering "why is this file so large?" from outside the app means opening a
 * SQLite shell against a live database, which is exactly what someone running
 * Bench in a container cannot easily do. It is also the question that actually
 * comes up: run history is the only thing here that grows without being asked
 * to, and it grows per tick, so the first useful fact is always which table is
 * holding the rows.
 *
 * Deliberately not served with the rest of App health: counting rows across
 * every table is a scan, and this page polls. It is a button, not a field.
 *
 * Nothing here reads a single stored value - only names, counts and sizes - so
 * it reveals nothing about anyone's budgets or credentials.
 */

export type TableUsage = {
  name: string;
  rows: number;
};

export type AppDbStorageUsage = {
  path: string;
  /** Size of the database file itself. */
  fileBytes: number;
  /**
   * The write-ahead log, which is a real part of what the database occupies on
   * disk and is routinely larger than people expect between checkpoints.
   */
  walBytes: number;
  totalBytes: number;
  /**
   * What the data actually occupies: pages in use, ignoring both free pages and
   * the log. This is the number that matches a fresh copy of the database (a
   * backup is written with `VACUUM INTO`, which writes only these), and the one
   * people expect when they compare the two and find a 150 MB file holding 9 MB.
   */
  dataBytes: number;
  pageSize: number;
  pageCount: number;
  /**
   * Pages already freed by deleted rows and reusable, but not yet returned to
   * the filesystem. A large number here is the signature of a big delete that
   * `incremental_vacuum` has not caught up with, and explains a file that stays
   * large after a cleanup.
   */
  freePages: number;
  freeBytes: number;
  /**
   * Whether restarting would actually rebuild the file, rather than only
   * settling the log. Reported rather than inferred by the caller: the
   * threshold lives with the code that acts on it, so the page cannot promise
   * a reclaim that will not happen.
   */
  compactsOnRestart: boolean;
  autoVacuum: "none" | "full" | "incremental" | "unknown";
  /** Largest first, so the reason for the size is the first row. */
  tables: TableUsage[];
  checkedAt: string;
};

const AUTO_VACUUM_MODES = ["none", "full", "incremental"] as const;

function pragmaNumber(db: SqliteDatabase, name: string): number {
  const rows = db.pragma(name) as Array<Record<string, unknown>>;
  const value = rows[0]?.[name];
  return typeof value === "number" ? value : 0;
}

function fileBytesAt(path: string): number {
  try {
    return statSync(path).size;
  } catch {
    // A WAL only exists between checkpoints, and the database file itself is
    // gone in the in-memory fallback runtime. Absent means zero, not an error.
    return 0;
  }
}

function tableUsage(db: SqliteDatabase): TableUsage[] {
  const names = (
    db
      .prepare(
        `SELECT name FROM sqlite_schema
          WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
          ORDER BY name`
      )
      .all() as Array<{ name: string }>
  ).map((row) => row.name);

  const tables: TableUsage[] = [];
  for (const name of names) {
    // The name comes from sqlite_schema, so it is an existing identifier rather
    // than anything a caller supplied; quoted anyway so an odd one cannot
    // change the statement.
    const row = db.prepare(`SELECT COUNT(*) AS n FROM "${name.replace(/"/g, '""')}"`).get() as
      | { n: number }
      | undefined;
    tables.push({ name, rows: Number(row?.n ?? 0) });
  }

  return tables.sort((a, b) => b.rows - a.rows || a.name.localeCompare(b.name));
}

export function getAppDbStorageUsage(dbPath = resolveAppDbPath()): AppDbStorageUsage {
  const db = getAppDb(dbPath);

  const pageSize = pragmaNumber(db, "page_size");
  const pageCount = pragmaNumber(db, "page_count");
  const freePages = pragmaNumber(db, "freelist_count");
  const autoVacuumMode = pragmaNumber(db, "auto_vacuum");

  const fileBytes = fileBytesAt(dbPath);
  const walBytes = fileBytesAt(`${dbPath}-wal`);

  return {
    path: dbPath,
    fileBytes,
    walBytes,
    totalBytes: fileBytes + walBytes,
    dataBytes: Math.max(0, pageCount - freePages) * pageSize,
    pageSize,
    pageCount,
    freePages,
    freeBytes: freePages * pageSize,
    compactsOnRestart:
      autoVacuumMode !== 2 || (pageCount > 0 && freePages / pageCount > COMPACT_FREE_PAGE_FRACTION),
    autoVacuum: AUTO_VACUUM_MODES[autoVacuumMode] ?? "unknown",
    tables: tableUsage(db),
    checkedAt: new Date().toISOString(),
  };
}

export function describeStorageUsageError(error: unknown): string {
  return errorMessage(error);
}
