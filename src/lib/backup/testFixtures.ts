import Database from "better-sqlite3";
import { zipSync } from "fflate";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * A miniature but real Actual export, for tests (RD-077 / PR-047).
 *
 * Real rather than a recorded fixture: verification opens the database and runs
 * SQLite's own integrity check, so a hand-made byte blob would prove nothing.
 * This builds an actual SQLite file with Actual's table names, zips it the way
 * an export is zipped, and hands back the bytes.
 *
 * Lives here rather than in each test file so the ZIP dependency stays inside
 * `src/lib/backup/`, which the bundle-isolation guard allows because everything
 * in this directory is server-only by construction.
 */
export function buildBudgetArchive(
  options: { transactions?: number; budgetName?: string } = {}
): Uint8Array {
  const root = mkdtempSync(join(tmpdir(), "bench-fixture-"));
  const path = join(root, "db.sqlite");
  const db = new Database(path);

  db.exec(`
    CREATE TABLE accounts (id TEXT PRIMARY KEY, name TEXT, tombstone INTEGER DEFAULT 0);
    CREATE TABLE payees (id TEXT PRIMARY KEY, name TEXT, tombstone INTEGER DEFAULT 0);
    CREATE TABLE categories (id TEXT PRIMARY KEY, name TEXT, tombstone INTEGER DEFAULT 0);
    CREATE TABLE transactions (id TEXT PRIMARY KEY, acct TEXT, date INTEGER, amount INTEGER);
    INSERT INTO accounts VALUES ('a1', 'Current', 0);
    INSERT INTO payees VALUES ('p1', 'Grocer', 0);
    INSERT INTO categories VALUES ('c1', 'Food', 0);
  `);

  const insert = db.prepare("INSERT INTO transactions VALUES (?, 'a1', ?, -1250)");
  for (let index = 0; index < (options.transactions ?? 1); index += 1) {
    insert.run(`t${index}`, 20260101 + index);
  }
  db.close();

  const bytes = readFileSync(path);
  rmSync(root, { recursive: true, force: true });

  return zipSync({
    "db.sqlite": bytes,
    "metadata.json": Buffer.from(
      JSON.stringify({ budgetName: options.budgetName ?? "Household", id: "budget-1" })
    ),
  });
}
