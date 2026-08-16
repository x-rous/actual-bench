import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { getAppDb, resetAppDbForTests } from "./connection";
import { LATEST_SCHEMA_VERSION } from "./migrations";
import {
  getReconciliationSession,
  listReconciliationProfiles,
  listStatementRows,
} from "./reconciliationRepository";
import {
  createPayeeCleanupSuppression,
  listPayeeCleanupSuppressions,
} from "./payeeCleanupSuppressionRepository";

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

/**
 * A v15 database holding a reconciliation done under the old import model:
 * statement rows with a single `description`, a saved column mapping, and an
 * apply config that made payee and notes an either/or choice.
 */
function v15Database(): { root: string; path: string } {
  const root = mkdtempSync(join(tmpdir(), "actual-bench-upgrade-v15-"));
  const path = join(root, "metadata.sqlite");

  const db = new Database(path);
  db.exec(`
    CREATE TABLE app_meta (key text PRIMARY KEY, value text NOT NULL, updated_at text NOT NULL);
    CREATE TABLE reconciliation_profiles (
      id text PRIMARY KEY,
      budget_sync_id text NOT NULL,
      account_id text NOT NULL,
      name text NOT NULL,
      mapping_json text NOT NULL,
      match_config_json text NOT NULL,
      created_at text NOT NULL,
      updated_at text NOT NULL
    );
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
      tag text,
      created_at text NOT NULL,
      updated_at text NOT NULL,
      applied_at text
    );
    CREATE TABLE reconciliation_statement_rows (
      id text PRIMARY KEY,
      session_id text NOT NULL REFERENCES reconciliation_sessions(id) ON DELETE CASCADE,
      source_row_number integer NOT NULL,
      posted_date text NOT NULL,
      amount integer NOT NULL,
      description text NOT NULL,
      reference text,
      transaction_date text,
      original_amount integer,
      original_currency text,
      fingerprint text NOT NULL,
      raw_json text NOT NULL
    );
  `);
  db.prepare("INSERT INTO app_meta (key, value, updated_at) VALUES (?, ?, ?)").run(
    "schema_version",
    "15",
    "2026-08-11T09:00:00.000Z"
  );
  db.prepare(
    `INSERT INTO reconciliation_sessions
       (id, budget_sync_id, account_id, status, apply_config_json, created_at, updated_at)
     VALUES ('sess-v15', 'budget-1', 'acct-1', 'reviewing',
             '{"descriptionTarget":"notes","clearedTarget":"created"}',
             '2026-08-11T09:00:00.000Z', '2026-08-11T09:30:00.000Z')`
  ).run();
  db.prepare(
    `INSERT INTO reconciliation_statement_rows
       (id, session_id, source_row_number, posted_date, amount, description, reference,
        original_amount, original_currency, fingerprint, raw_json)
     VALUES ('row-1', 'sess-v15', 2, '2026-08-01', -12550, 'AMZN Mktp AE*23981', '88721',
             -2450, 'USD', 'fp-1', '{"Date":"2026-08-01"}')`
  ).run();
  db.prepare(
    `INSERT INTO reconciliation_profiles
       (id, budget_sync_id, account_id, name, mapping_json, match_config_json, created_at, updated_at)
     VALUES ('prof-1', 'budget-1', 'acct-1', 'GMCC statement',
             '{"date":0,"description":1,"amount":2,"reference":3,"dateFormat":"dmy","signConvention":"signed","decimalSeparator":".","minorUnitDigits":2,"detectOriginalCurrencyAmount":true}',
             '{}', '2026-08-11T09:00:00.000Z', '2026-08-11T09:00:00.000Z')`
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

  it("moves a v15 reconciliation onto the canonical import model (RD-072)", () => {
    const { root, path } = v15Database();
    try {
      const db = getAppDb(path);

      // The statement row keeps everything it had, under the names that say
      // where each value goes in Actual.
      const [row] = listStatementRows(db, "sess-v15");
      expect(row).toMatchObject({
        sourceRowNumber: 2,
        postedDate: "2026-08-01",
        amount: -12550,
        importedPayee: "AMZN Mktp AE*23981",
        bankReference: "88721",
        originalAmount: -2450,
        originalCurrency: "USD",
        fingerprint: "fp-1",
      });
      expect(row.bankNotes).toBeNull();
      expect(row.raw).toEqual({ Date: "2026-08-01" });

      // The either/or setting becomes the two independent strategies that mean
      // the same thing — plus the provenance write it could not express.
      const session = getReconciliationSession(db, "sess-v15");
      expect(session?.applyConfig).toEqual({
        payeeStrategy: "leave-unset",
        notesStrategy: "imported-payee",
        clearedTarget: "created",
        enrichImportedPayee: true,
      });

      const [profile] = listReconciliationProfiles(db, "budget-1", "acct-1");
      expect(profile.mapping).toMatchObject({
        format: "delimited",
        dateFormat: "dmy",
        columns: { date: 0, importedPayee: 1, amount: 2, reference: 3 },
      });
    } finally {
      resetAppDbForTests();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("adds the payee-cleanup suppression table to an older database (v17)", () => {
    // Purely additive, so the thing worth proving is that an install carrying
    // real reconciliation work gains the table without losing any of it.
    const { root, path } = olderDatabase();
    try {
      const db = getAppDb(path);

      const created = createPayeeCleanupSuppression(db, {
        budgetSyncId: "budget-1",
        kind: "not-duplicates",
        payeeIds: ["p1", "p2"],
        normalizedNames: ["EMIRATES", "EMIRATES NBD"],
        detectorIds: ["fuzzy-similarity"],
      });
      expect(listPayeeCleanupSuppressions(db, "budget-1")).toHaveLength(1);
      expect(created.budgetSyncId).toBe("budget-1");

      // The pre-existing session is still there.
      expect(getReconciliationSession(db, "sess-old")).not.toBeNull();
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
