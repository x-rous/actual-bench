import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { getAppDb, resetAppDbForTests } from "./connection";
import { LATEST_SCHEMA_VERSION } from "./migrations";
import { getReconciliationSession } from "./reconciliationRepository";

/**
 * Upgrading a database that already holds real work.
 *
 * Every migration so far has been additive, and the tests assert that a *fresh*
 * database ends up at the latest version — which would still pass if an upgrade
 * path dropped a table on the way. A self-hosted install has months of sessions
 * in it, so the thing worth proving is that they survive.
 */

function olderDatabase(): { root: string; path: string } {
  const root = mkdtempSync(join(tmpdir(), "actual-bench-upgrade-"));
  const path = join(root, "metadata.sqlite");

  // A v14 database, built the way v14 built it: reconciliation_sessions with no
  // `tag` column, and a session already in it.
  const db = new Database(path);
  db.exec(`
    CREATE TABLE app_meta (key text PRIMARY KEY, value text NOT NULL, updated_at text NOT NULL);
    CREATE TABLE reconciliation_sessions (
      id text PRIMARY KEY,
      budget_sync_id text NOT NULL,
      account_id text NOT NULL,
      account_name text,
      profile_id text,
      status text NOT NULL,
      statement_name text,
      statement_start text,
      statement_end text,
      candidate_start text,
      candidate_end text,
      statement_fingerprint text,
      match_config_json text,
      totals_json text,
      apply_results_json text,
      apply_config_json text,
      created_at text NOT NULL,
      updated_at text NOT NULL,
      applied_at text
    );
  `);
  db.prepare("INSERT INTO app_meta (key, value, updated_at) VALUES (?, ?, ?)").run(
    "schema_version",
    "14",
    "2026-07-31T09:00:00.000Z"
  );
  db.prepare(
    `INSERT INTO reconciliation_sessions
       (id, budget_sync_id, account_id, account_name, status, statement_name, created_at, updated_at)
     VALUES ('sess-old', 'budget-1', 'acct-1', 'Global Money Credit Card', 'completed',
             'GMCC_JUL_2026.csv', '2026-07-31T09:00:00.000Z', '2026-07-31T09:30:00.000Z')`
  ).run();
  db.close();

  return { root, path };
}

describe("upgrading an existing database", () => {
  afterEach(() => {
    resetAppDbForTests();
  });

  it("brings a v14 database to the latest schema without losing its sessions", () => {
    const { root, path } = olderDatabase();
    try {
      const db = getAppDb(path);

      const version = db
        .prepare("SELECT value FROM app_meta WHERE key = ?")
        .get<{ value: string }>("schema_version");
      expect(Number(version?.value)).toBe(LATEST_SCHEMA_VERSION);

      const session = getReconciliationSession(db, "sess-old");
      expect(session).not.toBeNull();
      expect(session?.accountName).toBe("Global Money Credit Card");
      expect(session?.statementName).toBe("GMCC_JUL_2026.csv");
      expect(session?.status).toBe("completed");
      // The column the upgrade adds: absent before, and null rather than
      // missing afterwards, so reading a pre-existing session does not throw.
      expect(session?.tag).toBeNull();
    } finally {
      resetAppDbForTests();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("is safe to run twice", () => {
    const { root, path } = olderDatabase();
    try {
      getAppDb(path);
      resetAppDbForTests();
      // Reopening runs the migration check again; an additive step that is not
      // guarded would fail here with "duplicate column name".
      const db = getAppDb(path);
      expect(getReconciliationSession(db, "sess-old")?.tag).toBeNull();
    } finally {
      resetAppDbForTests();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
