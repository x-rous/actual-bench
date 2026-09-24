import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { DEFAULT_PDF_PARSER_GUIDANCE } from "@/lib/reconciliation/statement/pdf/model";
import { getAppDb, resetAppDbForTests } from "./connection";
import { getBackupCredential, upsertBackupCredential } from "./backupCredentialRepository";
import { LATEST_SCHEMA_VERSION, runMigrations } from "./migrations";
import {
  getReconciliationSession,
  listReconciliationProfiles,
  listStatementRows,
  updateReconciliationSession,
} from "./reconciliationRepository";
import {
  createPayeeCleanupSuppression,
  listPayeeCleanupSuppressions,
} from "./payeeCleanupSuppressionRepository";
import {
  claimAutomation,
  createAutomation,
  deleteAutomation,
  getAutomation,
  listAutomations,
} from "./automationRepository";
import { createAutomationRun, getAutomationRun, listAutomationRuns } from "./automationRunRepository";
import {
  createBackupArtifact,
  getBackupArtifact,
  createBackupDestination,
  listArtifactLocations,
  listBackupDestinations,
  recordArtifactLocation,
} from "./backupRepository";
import {
  deletePdfStatementLayout,
  listPdfStatementLayouts,
  savePdfStatementLayout,
} from "./pdfStatementLayoutRepository";
import { createPdfLayoutProfile, parsePdfStatementPages } from "@/lib/reconciliation/statement/pdf";
import { getSyncFlow } from "./syncFlowRepository";
import { getAllSyncMappingsForFlow } from "./syncMappingRepository";
import { listSyncFlowRuns } from "./syncRunRepository";

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

  it("adds the automation tables to an older database (v18)", () => {
    // Additive too, and nothing is migrated onto the engine yet (PR-043c does
    // that), so an upgraded install should gain empty automation storage while
    // keeping every session it already had.
    const { root, path } = olderDatabase();
    try {
      const db = getAppDb(path);

      expect(listAutomations(db)).toHaveLength(0);
      expect(listAutomationRuns(db)).toHaveLength(0);

      const automation = createAutomation(db, {
        type: "budget-file-sync",
        name: "Nightly sync",
        scheduleKind: "interval",
        intervalMinutes: 30,
        targetRef: { version: 1, data: { flowId: "flow-1" } },
        config: { version: 1, data: {} },
      });
      createAutomationRun(db, { automationId: automation.id, type: "budget-file-sync" });

      expect(listAutomations(db)).toHaveLength(1);
      expect(listAutomationRuns(db, { automationId: automation.id })).toHaveLength(1);

      // The pre-existing reconciliation work is untouched.
      expect(getReconciliationSession(db, "sess-old")).not.toBeNull();
    } finally {
      resetAppDbForTests();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("repairs a database that reached v18 from an intermediate branch build", () => {
    // The exact shape a dev server ended up in: v18 recorded, but the
    // automation tables created before `running_since` was added to them. Every
    // engine tick then failed with "no such column: running_since".
    const root = mkdtempSync(join(tmpdir(), "actual-bench-upgrade-v18-partial-"));
    const path = join(root, "metadata.sqlite");

    const seed = new Database(path);
    seed.exec(`
      CREATE TABLE app_meta (key text PRIMARY KEY, value text NOT NULL, updated_at text NOT NULL);
      CREATE TABLE automation_definitions (
        id text PRIMARY KEY,
        type text NOT NULL,
        name text NOT NULL,
        enabled integer NOT NULL DEFAULT 1,
        execution_mode text NOT NULL DEFAULT 'server',
        schedule_kind text NOT NULL DEFAULT 'interval',
        interval_minutes integer,
        cron_expression text,
        timezone text NOT NULL DEFAULT 'UTC',
        target_ref_json text NOT NULL,
        credential_ref text,
        config_json text NOT NULL,
        failure_policy_json text,
        consecutive_failures integer NOT NULL DEFAULT 0,
        auto_paused_at text,
        auto_pause_reason text,
        last_run_at text,
        last_success_at text,
        next_run_at text,
        created_at text NOT NULL,
        updated_at text NOT NULL
      );
      CREATE TABLE automation_runs (
        id text PRIMARY KEY,
        automation_id text REFERENCES automation_definitions(id) ON DELETE CASCADE,
        type text NOT NULL,
        status text NOT NULL,
        started_at text NOT NULL,
        finished_at text,
        trigger text NOT NULL DEFAULT 'schedule',
        attempt integer NOT NULL DEFAULT 1,
        execution_mode text NOT NULL DEFAULT 'server',
        result_json text,
        rollup_json text,
        error_json text
      );
    `);
    seed.prepare("INSERT INTO app_meta (key, value, updated_at) VALUES (?, ?, ?)").run(
      "schema_version",
      "18",
      "2026-08-25T18:30:55.405Z"
    );
    seed
      .prepare(
        `INSERT INTO automation_definitions
           (id, type, name, target_ref_json, config_json, created_at, updated_at)
         VALUES ('auto-1', 'budget-file-sync', 'Test 2', '{"version":1,"data":{}}',
                 '{"version":1,"data":{"flowId":"flow-1"}}', '2026-08-25T18:30:55.405Z',
                 '2026-08-25T18:30:55.405Z')`
      )
      .run();
    seed.close();

    try {
      const db = getAppDb(path);

      // The automation survives the repair, and the claim now works instead of
      // throwing on every tick.
      const [automation] = listAutomations(db);
      expect(automation.name).toBe("Test 2");
      expect(automation.runningSince).toBeNull();
      expect(claimAutomation(db, "auto-1", "2026-08-26T18:00:00.000Z")).toBe(true);
      expect(getAutomation(db, "auto-1")?.runningSince).toBe("2026-08-26T18:00:00.000Z");
    } finally {
      resetAppDbForTests();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("repairs automation_runs' CASCADE delete on an older database (v30)", () => {
    // The exact shape every database had before this fix: automation_id
    // cascades away its runs on delete, contradicting the column's own
    // "denormalized so a run stays readable after its definition is deleted"
    // comment. Deleting the automation should orphan the run, not erase it.
    const root = mkdtempSync(join(tmpdir(), "actual-bench-upgrade-v29-cascade-"));
    const path = join(root, "metadata.sqlite");

    const seed = new Database(path);
    seed.exec(`
      CREATE TABLE app_meta (key text PRIMARY KEY, value text NOT NULL, updated_at text NOT NULL);
      CREATE TABLE automation_definitions (
        id text PRIMARY KEY,
        type text NOT NULL,
        name text NOT NULL,
        enabled integer NOT NULL DEFAULT 1,
        execution_mode text NOT NULL DEFAULT 'server',
        schedule_kind text NOT NULL DEFAULT 'interval',
        interval_minutes integer,
        cron_expression text,
        timezone text NOT NULL DEFAULT 'UTC',
        target_ref_json text NOT NULL,
        credential_ref text,
        config_json text NOT NULL,
        failure_policy_json text,
        consecutive_failures integer NOT NULL DEFAULT 0,
        auto_paused_at text,
        auto_pause_reason text,
        running_since text,
        last_run_at text,
        last_success_at text,
        next_run_at text,
        created_at text NOT NULL,
        updated_at text NOT NULL
      );
      CREATE TABLE automation_runs (
        id text PRIMARY KEY,
        automation_id text REFERENCES automation_definitions(id) ON DELETE CASCADE,
        type text NOT NULL,
        status text NOT NULL,
        started_at text NOT NULL,
        finished_at text,
        trigger text NOT NULL DEFAULT 'schedule',
        attempt integer NOT NULL DEFAULT 1,
        execution_mode text NOT NULL DEFAULT 'server',
        result_json text,
        rollup_json text,
        error_json text
      );
    `);
    const now = "2026-08-25T18:30:55.405Z";
    seed.prepare("INSERT INTO app_meta (key, value, updated_at) VALUES (?, ?, ?)").run("schema_version", "29", now);
    seed
      .prepare(
        `INSERT INTO automation_definitions
           (id, type, name, target_ref_json, config_json, created_at, updated_at)
         VALUES ('auto-1', 'budget-file-sync', 'Nightly sync', '{"version":1,"data":{}}',
                 '{"version":1,"data":{"flowId":"flow-1"}}', ?, ?)`
      )
      .run(now, now);
    seed
      .prepare(
        `INSERT INTO automation_runs (id, automation_id, type, status, started_at)
         VALUES ('run-1', 'auto-1', 'budget-file-sync', 'succeeded', ?)`
      )
      .run(now);
    seed.close();

    try {
      const db = getAppDb(path);

      expect(getAutomationRun(db, "run-1")?.automationId).toBe("auto-1");

      deleteAutomation(db, "auto-1");

      // The run survives, orphaned rather than cascaded away.
      const run = getAutomationRun(db, "run-1");
      expect(run).not.toBeNull();
      expect(run?.automationId).toBeNull();
      expect(run?.type).toBe("budget-file-sync");
    } finally {
      resetAppDbForTests();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("adds backup storage to an older database (v20)", () => {
    // Additive, and nothing reads these tables yet, so an install carrying real
    // work should gain them without losing any of it.
    const { root, path } = olderDatabase();
    try {
      const db = getAppDb(path);

      const destination = createBackupDestination(db, {
        name: "NAS volume",
        kind: "local",
        config: { version: 1, data: { path: "/mnt/backups" } },
      });
      const artifact = createBackupArtifact(db, {
        kind: "budget",
        checksumSha256: "c".repeat(64),
        sizeBytes: 1024,
      });
      recordArtifactLocation(db, {
        artifactId: artifact.id,
        destinationId: destination.id,
        objectKey: "/mnt/backups/a.zip",
      });

      expect(listBackupDestinations(db)).toHaveLength(1);
      expect(listArtifactLocations(db, artifact.id)).toHaveLength(1);

      // The pre-existing reconciliation work is untouched.
      expect(getReconciliationSession(db, "sess-old")).not.toBeNull();
    } finally {
      resetAppDbForTests();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("adds sealed backup credentials to an older database (v21)", () => {
    const { root, path } = olderDatabase();
    const previousKey = process.env.SYNC_VAULT_KEY;
    process.env.SYNC_VAULT_KEY = "test-vault-key";
    try {
      const db = getAppDb(path);

      upsertBackupCredential(db, {
        ref: "dest-1",
        kind: "s3",
        secret: { accessKeyId: "AKIA", secretAccessKey: "shh" },
      });

      expect(getBackupCredential(db, "dest-1")).toEqual({
        accessKeyId: "AKIA",
        secretAccessKey: "shh",
      });
      expect(getReconciliationSession(db, "sess-old")).not.toBeNull();
    } finally {
      resetAppDbForTests();
      rmSync(root, { recursive: true, force: true });
      if (previousKey === undefined) delete process.env.SYNC_VAULT_KEY;
      else process.env.SYNC_VAULT_KEY = previousKey;
    }
  });

  it("gives encrypted backups their own key reference (v23)", () => {
    // The reference cannot be derived from the rule, because deleting a rule
    // nulls the artifact's policy link — which is exactly when an old encrypted
    // copy needs to stay openable.
    const { root, path } = olderDatabase();
    try {
      const db = getAppDb(path);
      const artifact = createBackupArtifact(db, {
        kind: "budget",
        checksumSha256: "e".repeat(64),
        sizeBytes: 2048,
        encrypted: true,
        encryptionCredentialRef: "pol-1",
      });

      expect(getBackupArtifact(db, artifact.id)?.encryptionCredentialRef).toBe("pol-1");
      expect(getReconciliationSession(db, "sess-old")).not.toBeNull();
    } finally {
      resetAppDbForTests();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("adds the statement format to an older database (v24)", () => {
    // Additive and nullable: a session imported before the column existed has
    // no answer, and deriving one from its filename would record a guess.
    const { root, path } = olderDatabase();
    try {
      const db = getAppDb(path);

      const existing = getReconciliationSession(db, "sess-old");
      expect(existing).not.toBeNull();
      expect(existing?.statementFormat).toBeNull();

      const updated = updateReconciliationSession(db, "sess-old", { statementFormat: "ofx" });
      expect(updated?.statementFormat).toBe("ofx");
    } finally {
      resetAppDbForTests();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("replaces the PDF detection tables with statement layouts (v29)", () => {
    const db = new Database(":memory:");
    try {
      db.pragma("foreign_keys = ON");
      // The shape before: a bank as a row of its own, layouts hanging off it,
      // and two association tables between accounts and either.
      db.exec(`
        CREATE TABLE app_meta (key text PRIMARY KEY, value text NOT NULL, updated_at text NOT NULL);
        CREATE TABLE pdf_detection_banks (
          id text PRIMARY KEY,
          name text NOT NULL,
          default_profile_id text,
          created_at text NOT NULL,
          updated_at text NOT NULL
        );
        CREATE TABLE pdf_detection_profiles (
          id text PRIMARY KEY,
          bank_id text NOT NULL REFERENCES pdf_detection_banks(id) ON DELETE CASCADE,
          name text NOT NULL,
          profile_json text NOT NULL,
          created_at text NOT NULL,
          updated_at text NOT NULL
        );
        CREATE TABLE pdf_detection_account_profiles (
          budget_sync_id text NOT NULL,
          account_id text NOT NULL,
          profile_id text NOT NULL REFERENCES pdf_detection_profiles(id) ON DELETE CASCADE,
          updated_at text NOT NULL,
          PRIMARY KEY(budget_sync_id, account_id)
        );
        INSERT INTO app_meta VALUES ('schema_version', '28', '2026-09-19T00:00:00.000Z');
        INSERT INTO pdf_detection_banks VALUES ('bank', 'HSBC Bank', NULL, '2026-09-19T00:00:00.000Z', '2026-09-19T00:00:00.000Z');
        INSERT INTO pdf_detection_profiles VALUES ('card', 'bank', 'Credit card', '{}', '2026-09-19T00:00:00.000Z', '2026-09-19T00:00:00.000Z');
        INSERT INTO pdf_detection_account_profiles VALUES ('budget-a', 'card-account', 'card', '2026-09-19T00:00:00.000Z');
      `);

      runMigrations(db);

      const tables = db.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'pdf_%' ORDER BY name"
      ).all() as { name: string }[];
      expect(tables.map((table) => table.name)).toEqual([
        "pdf_statement_layout_accounts",
        "pdf_statement_layouts",
      ]);

      // The layouts themselves do not survive: they stored a statement period
      // and page-indexed areas, and the feature is unreleased, so they are
      // saved again from a statement rather than carried across.
      expect(db.prepare("SELECT COUNT(*) AS count FROM pdf_statement_layouts").get())
        .toEqual({ count: 0 });
    } finally {
      db.close();
    }
  });

  it("takes an account's assignment with the layout it points at (v29)", () => {
    const { root, path } = olderDatabase();
    try {
      const db = getAppDb(path);
      const layout = createPdfLayoutProfile({
        id: "layout-1",
        name: "Credit card",
        result: parsePdfStatementPages([{
          pageNumber: 1,
          width: 700,
          height: 800,
          items: [
            ["Transaction Date", 20, 740], ["Description", 120, 740], ["Amount", 480, 740],
            ["08/15/2026", 20, 700], ["ANON SHOP", 120, 700], ["USD -12.50", 480, 700],
          ].map(([text, x, y], index) => ({
            id: `item-${index}`,
            str: String(text),
            transform: [10, 0, 0, 10, Number(x), Number(y)],
            width: String(text).length * 6,
            height: 10,
          })),
        }], { guidance: { ...DEFAULT_PDF_PARSER_GUIDANCE, currency: "USD", dateFormat: "mdy" } }),
      });
      savePdfStatementLayout(db, {
        budgetSyncId: "budget-1",
        accountId: "acct-1",
        bankName: "HSBC Bank",
        layoutName: "Credit card",
        layout: { kind: "pdf-layout-v3", profile: layout },
        assignToAccount: true,
      });

      const catalog = listPdfStatementLayouts(db, "budget-1", "acct-1");
      expect(catalog.layouts).toHaveLength(1);
      expect(catalog.accountLayoutId).toBe(catalog.layouts[0]?.id);
      expect(getReconciliationSession(db, "sess-old")).not.toBeNull();

      // The assignment is a foreign key, so deleting the layout takes it.
      deletePdfStatementLayout(db, catalog.layouts[0]!.id);
      expect(listPdfStatementLayouts(db, "budget-1", "acct-1")).toEqual({
        layouts: [],
        accountLayoutId: null,
      });
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

  it("collapses sync_flow_legs into sync_flows without touching mappings or run history (v31)", () => {
    // The exact shape every database had before the collapse: a flow's route
    // lived in a separate sync_flow_legs row, and sync_mappings/sync_flow_runs
    // both hold a live FK to sync_flows. This is the scenario the migration's
    // own comment warns about: naively rebuilding sync_flows by renaming it
    // would make SQLite repoint those FKs at the renamed-away table, and
    // dropping that table would then CASCADE-delete every mapping. This test
    // proves that doesn't happen.
    const root = mkdtempSync(join(tmpdir(), "actual-bench-upgrade-v29-legs-"));
    const path = join(root, "metadata.sqlite");

    const seed = new Database(path);
    seed.pragma("foreign_keys = ON");
    seed.exec(`
      CREATE TABLE app_meta (key text PRIMARY KEY, value text NOT NULL, updated_at text NOT NULL);
      CREATE TABLE sync_flows (
        id text PRIMARY KEY,
        name text NOT NULL,
        enabled integer NOT NULL DEFAULT 1,
        flow_type text NOT NULL DEFAULT 'transaction_sync',
        description text,
        created_at text NOT NULL,
        updated_at text NOT NULL
      );
      CREATE TABLE sync_flow_legs (
        id text PRIMARY KEY,
        flow_id text NOT NULL REFERENCES sync_flows(id) ON DELETE CASCADE,
        position integer NOT NULL,
        source_ref_json text NOT NULL,
        target_ref_json text NOT NULL,
        filter_json text NOT NULL,
        transform_json text NOT NULL,
        options_json text NOT NULL,
        created_at text NOT NULL,
        updated_at text NOT NULL
      );
      CREATE TABLE sync_flow_runs (
        id text PRIMARY KEY,
        flow_id text REFERENCES sync_flows(id) ON DELETE SET NULL,
        status text NOT NULL,
        started_at text NOT NULL,
        finished_at text,
        summary_json text NOT NULL,
        error_json text,
        created_by_trigger text,
        source_snapshot_summary_json text,
        target_snapshot_summary_json text,
        counts_json text
      );
      CREATE TABLE sync_flow_run_items (
        id text PRIMARY KEY,
        run_id text NOT NULL REFERENCES sync_flow_runs(id) ON DELETE CASCADE,
        leg_id text REFERENCES sync_flow_legs(id) ON DELETE SET NULL,
        source_item_ref_json text NOT NULL,
        target_item_ref_json text,
        status text NOT NULL,
        message text,
        created_at text NOT NULL,
        flow_id text
      );
      CREATE TABLE sync_mappings (
        id text PRIMARY KEY,
        flow_id text NOT NULL REFERENCES sync_flows(id) ON DELETE CASCADE,
        source_connection_fingerprint text NOT NULL,
        source_budget_id text NOT NULL,
        source_account_id text,
        source_entity_type text NOT NULL,
        source_transaction_id text,
        source_split_id text,
        source_item_key text NOT NULL,
        source_fingerprint text NOT NULL,
        target_connection_fingerprint text NOT NULL,
        target_budget_id text NOT NULL,
        target_account_id text,
        target_entity_type text NOT NULL,
        target_transaction_id text,
        target_item_key text,
        target_fingerprint text,
        target_marker text,
        created_run_id text REFERENCES sync_flow_runs(id) ON DELETE SET NULL,
        status text NOT NULL,
        last_seen_at text,
        last_applied_at text,
        created_at text NOT NULL,
        updated_at text NOT NULL,
        UNIQUE(flow_id, source_item_key)
      );
    `);
    const now = "2026-08-25T18:30:55.405Z";
    seed.prepare("INSERT INTO app_meta (key, value, updated_at) VALUES (?, ?, ?)").run("schema_version", "29", now);
    seed
      .prepare(
        `INSERT INTO sync_flows (id, name, enabled, flow_type, description, created_at, updated_at)
         VALUES ('flow-1', 'Card sync', 1, 'transaction_sync', NULL, ?, ?)`
      )
      .run(now, now);
    seed
      .prepare(
        `INSERT INTO sync_flow_legs
           (id, flow_id, position, source_ref_json, target_ref_json, filter_json, transform_json, options_json, created_at, updated_at)
         VALUES ('leg-1', 'flow-1', 0, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        '{"version":1,"data":{"accountId":"acct-src"}}',
        '{"version":1,"data":{"accountId":"acct-tgt"}}',
        '{"version":1,"data":{}}',
        '{"version":1,"data":{"amountDirection":"same"}}',
        '{"version":1,"data":{"reviewPolicy":"manual_preview_required"}}',
        now,
        now
      );
    seed
      .prepare(
        `INSERT INTO sync_flow_runs (id, flow_id, status, started_at, summary_json)
         VALUES ('run-1', 'flow-1', 'applied', ?, '{"version":1,"data":{}}')`
      )
      .run(now);
    seed
      .prepare(
        `INSERT INTO sync_mappings
           (id, flow_id, source_connection_fingerprint, source_budget_id, source_entity_type,
            source_item_key, source_fingerprint, target_connection_fingerprint, target_budget_id,
            target_entity_type, target_transaction_id, status, created_at, updated_at)
         VALUES ('map-1', 'flow-1', 'src-fp', 'budget-src', 'transaction',
                 'txn:t1', 'fp1', 'tgt-fp', 'budget-tgt',
                 'transaction', 'target-1', 'active', ?, ?)`
      )
      .run(now, now);
    seed.close();

    try {
      const db = getAppDb(path);

      // The flow's route survived, backfilled from its one leg.
      const flow = getSyncFlow(db, "flow-1");
      expect(flow?.sourceRef.data).toMatchObject({ accountId: "acct-src" });
      expect(flow?.targetRef.data).toMatchObject({ accountId: "acct-tgt" });
      expect(flow?.transform.data).toMatchObject({ amountDirection: "same" });
      expect(flow?.options.data).toMatchObject({ reviewPolicy: "manual_preview_required" });

      // The mapping and run survive intact - not cascaded away.
      const mappings = getAllSyncMappingsForFlow(db, "flow-1");
      expect(mappings).toHaveLength(1);
      expect(mappings[0]?.targetTransactionId).toBe("target-1");

      const runs = listSyncFlowRuns(db, { flowId: "flow-1" });
      expect(runs).toHaveLength(1);
      expect(runs[0]?.flowId).toBe("flow-1");

      // sync_flow_legs is gone, and nothing has a dangling FK to it or to
      // anything else.
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'sync_flow_legs'")
        .all();
      expect(tables).toHaveLength(0);
      expect(db.pragma("foreign_key_check")).toEqual([]);
    } finally {
      resetAppDbForTests();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses to silently drop a flow with more than one leg (v31)", () => {
    // The UI never created a second leg, but createSyncFlow's old validation
    // never enforced that - a direct API call could have. The migration must
    // fail loudly rather than quietly keep only one and discard the other.
    const root = mkdtempSync(join(tmpdir(), "actual-bench-upgrade-v29-multileg-"));
    const path = join(root, "metadata.sqlite");

    const seed = new Database(path);
    seed.exec(`
      CREATE TABLE app_meta (key text PRIMARY KEY, value text NOT NULL, updated_at text NOT NULL);
      CREATE TABLE sync_flows (
        id text PRIMARY KEY, name text NOT NULL, enabled integer NOT NULL DEFAULT 1,
        flow_type text NOT NULL DEFAULT 'transaction_sync', description text,
        created_at text NOT NULL, updated_at text NOT NULL
      );
      CREATE TABLE sync_flow_legs (
        id text PRIMARY KEY, flow_id text NOT NULL, position integer NOT NULL,
        source_ref_json text NOT NULL, target_ref_json text NOT NULL, filter_json text NOT NULL,
        transform_json text NOT NULL, options_json text NOT NULL,
        created_at text NOT NULL, updated_at text NOT NULL
      );
      CREATE TABLE sync_flow_runs (id text PRIMARY KEY, flow_id text, status text NOT NULL, started_at text NOT NULL, summary_json text NOT NULL);
      CREATE TABLE sync_flow_run_items (id text PRIMARY KEY, run_id text NOT NULL, leg_id text, source_item_ref_json text NOT NULL, status text NOT NULL, created_at text NOT NULL);
      CREATE TABLE sync_mappings (id text PRIMARY KEY, flow_id text NOT NULL);
    `);
    const now = "2026-08-25T18:30:55.405Z";
    seed.prepare("INSERT INTO app_meta (key, value, updated_at) VALUES (?, ?, ?)").run("schema_version", "29", now);
    seed
      .prepare(`INSERT INTO sync_flows (id, name, created_at, updated_at) VALUES ('flow-1', 'Two-leg flow', ?, ?)`)
      .run(now, now);
    for (const position of [0, 1]) {
      seed
        .prepare(
          `INSERT INTO sync_flow_legs
             (id, flow_id, position, source_ref_json, target_ref_json, filter_json, transform_json, options_json, created_at, updated_at)
           VALUES (?, 'flow-1', ?, '{"version":1,"data":{}}', '{"version":1,"data":{}}', '{"version":1,"data":{}}', '{"version":1,"data":{}}', '{"version":1,"data":{}}', ?, ?)`
        )
        .run(`leg-${position}`, position, now, now);
    }
    seed.close();

    try {
      expect(() => getAppDb(path)).toThrow(/more than one leg/);
    } finally {
      resetAppDbForTests();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("clears out the already_synced run items an install has accumulated (v33)", () => {
    // What a real install looks like after an unattended flow has been ticking
    // for a while: the overwhelming majority of run items are already_synced,
    // re-persisted every run, and nothing ever reads them back.
    const root = mkdtempSync(join(tmpdir(), "actual-bench-upgrade-v33-already-synced-"));
    const path = join(root, "metadata.sqlite");

    const seed = new Database(path);
    seed.exec(`
      CREATE TABLE app_meta (key text PRIMARY KEY, value text NOT NULL, updated_at text NOT NULL);
      CREATE TABLE sync_flows (
        id text PRIMARY KEY, name text NOT NULL, enabled integer NOT NULL DEFAULT 1,
        flow_type text NOT NULL DEFAULT 'transaction_sync', description text,
        source_ref_json text NOT NULL DEFAULT '{"version":1,"data":{}}',
        target_ref_json text NOT NULL DEFAULT '{"version":1,"data":{}}',
        filter_json text NOT NULL DEFAULT '{"version":1,"data":{}}',
        transform_json text NOT NULL DEFAULT '{"version":1,"data":{}}',
        options_json text NOT NULL DEFAULT '{"version":1,"data":{}}',
        created_at text NOT NULL, updated_at text NOT NULL
      );
      CREATE TABLE sync_flow_runs (
        id text PRIMARY KEY, flow_id text REFERENCES sync_flows(id) ON DELETE SET NULL,
        status text NOT NULL, started_at text NOT NULL, finished_at text,
        summary_json text NOT NULL, error_json text, created_by_trigger text,
        source_snapshot_summary_json text, target_snapshot_summary_json text, counts_json text
      );
      CREATE TABLE sync_flow_run_items (
        id text PRIMARY KEY,
        run_id text NOT NULL REFERENCES sync_flow_runs(id) ON DELETE CASCADE,
        source_item_ref_json text NOT NULL, target_item_ref_json text,
        status text NOT NULL, message text, created_at text NOT NULL,
        flow_id text, classification text
      );
    `);
    const now = "2026-09-01T00:00:00.000Z";
    seed.prepare("INSERT INTO app_meta (key, value, updated_at) VALUES (?, ?, ?)").run("schema_version", "32", now);
    seed
      .prepare(`INSERT INTO sync_flows (id, name, created_at, updated_at) VALUES ('flow-1', 'Card sync', ?, ?)`)
      .run(now, now);
    seed
      .prepare(
        `INSERT INTO sync_flow_runs (id, flow_id, status, started_at, summary_json)
         VALUES ('run-1', 'flow-1', 'applied', ?, '{"version":1,"data":{}}')`
      )
      .run(now);
    const insertItem = seed.prepare(
      `INSERT INTO sync_flow_run_items (id, run_id, flow_id, source_item_ref_json, status, created_at, classification)
       VALUES (?, 'run-1', 'flow-1', '{}', 'planned', ?, ?)`
    );
    for (let i = 0; i < 50; i += 1) insertItem.run(`synced-${i}`, now, "already_synced");
    insertItem.run("new-1", now, "new");
    insertItem.run("blocked-1", now, "blocked");
    seed.close();

    try {
      const db = getAppDb(path);

      const remaining = db
        .prepare("SELECT classification FROM sync_flow_run_items ORDER BY id")
        .all() as Array<{ classification: string }>;
      // Only the already_synced backlog goes; everything someone might still
      // act on or look at stays exactly where it was.
      expect(remaining.map((row) => row.classification)).toEqual(["blocked", "new"]);
      // The run itself is untouched - its counts envelope, not these rows, is
      // what the UI reports.
      expect(db.prepare("SELECT COUNT(*) AS n FROM sync_flow_runs").get<{ n: number }>()?.n).toBe(1);
    } finally {
      resetAppDbForTests();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("adds per-server request leases and run input to a v33 database, keeping its run history (v34)", () => {
    const root = mkdtempSync(join(tmpdir(), "actual-bench-upgrade-v34-"));
    const path = join(root, "metadata.sqlite");

    const seed = new Database(path);
    seed.exec(`
      CREATE TABLE app_meta (key text PRIMARY KEY, value text NOT NULL, updated_at text NOT NULL);
      CREATE TABLE automation_runs (
        id text PRIMARY KEY, automation_id text, type text NOT NULL, status text NOT NULL,
        started_at text NOT NULL, finished_at text, trigger text NOT NULL DEFAULT 'schedule',
        attempt integer NOT NULL DEFAULT 1, execution_mode text NOT NULL DEFAULT 'server',
        result_json text, rollup_json text, error_json text
      );
    `);
    const now = "2026-09-20T00:00:00.000Z";
    seed.prepare("INSERT INTO app_meta (key, value, updated_at) VALUES (?, ?, ?)").run("schema_version", "33", now);
    seed
      .prepare(
        `INSERT INTO automation_runs (id, automation_id, type, status, started_at, finished_at)
         VALUES ('run-old', NULL, 'backup', 'succeeded', ?, ?)`
      )
      .run(now, now);
    seed.close();

    try {
      const db = getAppDb(path);

      // The run from before the upgrade reads back unchanged, with no input.
      expect(getAutomationRun(db, "run-old")).toMatchObject({ status: "succeeded", input: null });
      // A new run can carry one.
      const run = createAutomationRun(db, {
        type: "backup",
        input: { version: 1, data: { eventId: "evt-1" } },
      });
      expect(getAutomationRun(db, run.id)?.input).toEqual({ version: 1, data: { eventId: "evt-1" } });
      // The lease table exists and works.
      db.prepare(
        "INSERT INTO server_request_leases (server_key, holder, acquired_at, expires_at_ms) VALUES (?, ?, ?, ?)"
      ).run("http://api.test", "holder", now, 1);
      expect(db.prepare("SELECT COUNT(*) AS n FROM server_request_leases").get<{ n: number }>()?.n).toBe(1);

      // Idempotent: running the migrations again changes nothing.
      expect(runMigrations(db).schemaVersion).toBe(LATEST_SCHEMA_VERSION);
    } finally {
      resetAppDbForTests();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("repairs a database an earlier v31 build left with a dangling leg_id FK (v32)", () => {
    // Reproduces a real bad state: an earlier build of the legs-collapse
    // migration dropped sync_flow_legs before also dropping
    // sync_flow_run_items.leg_id, then recorded schema_version 31. That
    // database is stuck forever with a column whose FK target table doesn't
    // exist, which SQLite rejects inserting into (even NULL) once
    // foreign_keys is on - this is exactly the "no such table: sync_flow_legs"
    // error a real sync run hit.
    const root = mkdtempSync(join(tmpdir(), "actual-bench-upgrade-v31-dangling-leg-"));
    const path = join(root, "metadata.sqlite");

    const seed = new Database(path);
    seed.exec(`
      CREATE TABLE app_meta (key text PRIMARY KEY, value text NOT NULL, updated_at text NOT NULL);
      CREATE TABLE sync_flows (
        id text PRIMARY KEY, name text NOT NULL, enabled integer NOT NULL DEFAULT 1,
        flow_type text NOT NULL DEFAULT 'transaction_sync', description text,
        source_ref_json text NOT NULL DEFAULT '{"version":1,"data":{}}',
        target_ref_json text NOT NULL DEFAULT '{"version":1,"data":{}}',
        filter_json text NOT NULL DEFAULT '{"version":1,"data":{}}',
        transform_json text NOT NULL DEFAULT '{"version":1,"data":{}}',
        options_json text NOT NULL DEFAULT '{"version":1,"data":{}}',
        created_at text NOT NULL, updated_at text NOT NULL
      );
      CREATE TABLE sync_flow_runs (
        id text PRIMARY KEY, flow_id text REFERENCES sync_flows(id) ON DELETE SET NULL,
        status text NOT NULL, started_at text NOT NULL, finished_at text,
        summary_json text NOT NULL, error_json text,
        created_by_trigger text, source_snapshot_summary_json text,
        target_snapshot_summary_json text, counts_json text
      );
      CREATE TABLE sync_flow_run_items (
        id text PRIMARY KEY,
        run_id text NOT NULL REFERENCES sync_flow_runs(id) ON DELETE CASCADE,
        leg_id text REFERENCES sync_flow_legs(id) ON DELETE SET NULL,
        source_item_ref_json text NOT NULL,
        target_item_ref_json text,
        status text NOT NULL,
        message text,
        created_at text NOT NULL,
        flow_id text
      );
    `);
    const now = "2026-08-25T18:30:55.405Z";
    // sync_flow_legs was already dropped by the buggy build - never recreated here.
    seed.prepare("INSERT INTO app_meta (key, value, updated_at) VALUES (?, ?, ?)").run("schema_version", "31", now);
    seed
      .prepare(
        `INSERT INTO sync_flows (id, name, created_at, updated_at) VALUES ('flow-1', 'Card sync', ?, ?)`
      )
      .run(now, now);
    seed
      .prepare(
        `INSERT INTO sync_flow_runs (id, flow_id, status, started_at, summary_json)
         VALUES ('run-1', 'flow-1', 'applied', ?, '{"version":1,"data":{}}')`
      )
      .run(now);
    seed.close();

    try {
      const db = getAppDb(path);

      expect(db.pragma("table_info(sync_flow_run_items)")).not.toContainEqual(
        expect.objectContaining({ name: "leg_id" })
      );
      expect(db.pragma("foreign_key_check")).toEqual([]);

      // The exact failure mode this reproduces: inserting a new run item
      // (even with no leg_id ever set) used to throw "no such table:
      // sync_flow_legs" once the referenced table was gone.
      db.pragma("foreign_keys = ON");
      expect(() =>
        db
          .prepare(
            `INSERT INTO sync_flow_run_items (id, run_id, source_item_ref_json, status, created_at)
             VALUES ('item-1', 'run-1', '{}', 'planned', ?)`
          )
          .run(now)
      ).not.toThrow();
    } finally {
      resetAppDbForTests();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
