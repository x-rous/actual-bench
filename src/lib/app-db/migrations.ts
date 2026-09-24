import type { SqliteDatabase } from "./types";
import type { ConnectionMode } from "@/store/connection";
import { serverFingerprint } from "@/lib/sync/connectionRef";
import {
  APP_META_TABLE_SQL,
  BACKUP_ARTIFACT_LOCATION_TABLE_SQL,
  BACKUP_ARTIFACT_TABLE_SQL,
  BACKUP_CREDENTIAL_TABLE_SQL,
  BACKUP_DESTINATION_TABLE_SQL,
  BACKUP_INDEX_SQL,
  BACKUP_POLICY_TABLE_SQL,
  AUTOMATION_DEFINITION_TABLE_SQL,
  AUTOMATION_INDEX_SQL,
  AUTOMATION_RUN_TABLE_SQL,
  BUDGET_ENCRYPTION_CREDENTIAL_TABLE_SQL,
  CONNECTION_CREDENTIAL_TABLE_SQL,
  RECONCILIATION_INDEX_SQL,
  RECONCILIATION_ITEM_TABLE_SQL,
  RECONCILIATION_PROFILE_TABLE_SQL,
  RECONCILIATION_SESSION_TABLE_SQL,
  RECONCILIATION_STATEMENT_ROW_TABLE_SQL,
  REMEMBERED_BUDGET_TABLE_SQL,
  PAYEE_CLEANUP_SUPPRESSION_INDEX_SQL,
  PAYEE_CLEANUP_SUPPRESSION_TABLE_SQL,
  PDF_DETECTION_ACCOUNT_BANK_TABLE_SQL,
  PDF_DETECTION_ACCOUNT_PROFILE_TABLE_SQL,
  PDF_DETECTION_BANK_TABLE_SQL,
  PDF_DETECTION_PROFILE_INDEX_SQL,
  PDF_DETECTION_PROFILE_TABLE_SQL,
  PDF_STATEMENT_LAYOUT_ACCOUNT_TABLE_SQL,
  PDF_STATEMENT_LAYOUT_INDEX_SQL,
  PDF_STATEMENT_LAYOUT_TABLE_SQL,
  RULE_DIAGNOSTICS_DISMISSAL_INDEX_SQL,
  RULE_DIAGNOSTICS_DISMISSAL_TABLE_SQL,
  SAVED_QUERY_TABLE_SQL,
  SERVER_CREDENTIAL_TABLE_SQL,
  FX_INDEX_SQL,
  FX_RATES_TABLE_SQL,
  FX_RATE_IMPORT_BATCH_TABLE_SQL,
  SYNC_CREDENTIAL_TABLE_SQL,
  SYNC_FLOW_INDEX_SQL,
  SYNC_FLOW_LEG_TABLE_SQL,
  SYNC_FLOW_RUN_ITEM_TABLE_SQL,
  SYNC_FLOW_RUN_TABLE_SQL,
  SYNC_FLOW_TABLE_SQL,
  SYNC_MAPPING_TABLE_SQL,
  SYNC_PLATFORM_V2_INDEX_SQL,
  SYNC_PLATFORM_V3_INDEX_SQL,
  TRANSACTION_FX_TABLE_SQL,
} from "./schema";
import { KDF_VERSION_META_KEY, SALT_META_KEY, VERIFIER_META_KEY } from "./vaultMetaKeys";
import { AppDbUnavailableError } from "./errors";

export const LATEST_SCHEMA_VERSION = 37;

type Migration = {
  version: number;
  statements?: readonly string[];
  apply?: (db: SqliteDatabase) => void;
};

export type AppDbMigrationMeta = {
  schemaVersion: number;
  createdAt: string | null;
  lastMigratedAt: string | null;
};

function columnExists(db: SqliteDatabase, tableName: string, columnName: string): boolean {
  const rows = db.pragma(`table_info(${tableName})`) as Array<{ name: string }>;
  return rows.some((row) => row.name === columnName);
}

function addColumnIfMissing(
  db: SqliteDatabase,
  tableName: string,
  columnName: string,
  definition: string
): void {
  if (!columnExists(db, tableName, columnName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
}

function applySyncPlatformV2(db: SqliteDatabase): void {
  addColumnIfMissing(db, "sync_flows", "flow_type", "text NOT NULL DEFAULT 'transaction_sync'");

  addColumnIfMissing(db, "sync_flow_runs", "created_by_trigger", "text NOT NULL DEFAULT 'manual_preview'");
  addColumnIfMissing(db, "sync_flow_runs", "source_snapshot_summary_json", "text");
  addColumnIfMissing(db, "sync_flow_runs", "target_snapshot_summary_json", "text");
  addColumnIfMissing(db, "sync_flow_runs", "counts_json", "text");

  addColumnIfMissing(db, "sync_flow_run_items", "flow_id", "text REFERENCES sync_flows(id) ON DELETE SET NULL");
  addColumnIfMissing(db, "sync_flow_run_items", "source_entity_type", "text");
  addColumnIfMissing(db, "sync_flow_run_items", "source_item_key", "text");
  addColumnIfMissing(db, "sync_flow_run_items", "source_transaction_id", "text");
  addColumnIfMissing(db, "sync_flow_run_items", "source_split_id", "text");
  addColumnIfMissing(db, "sync_flow_run_items", "source_fingerprint", "text");
  addColumnIfMissing(db, "sync_flow_run_items", "planned_action", "text");
  addColumnIfMissing(db, "sync_flow_run_items", "planned_target_payload_json", "text");
  addColumnIfMissing(db, "sync_flow_run_items", "classification", "text");
  addColumnIfMissing(db, "sync_flow_run_items", "duplicate_confidence", "text");
  addColumnIfMissing(db, "sync_flow_run_items", "warnings_json", "text");
  addColumnIfMissing(db, "sync_flow_run_items", "errors_json", "text");
  addColumnIfMissing(db, "sync_flow_run_items", "selected_for_apply", "integer NOT NULL DEFAULT 0");
  addColumnIfMissing(db, "sync_flow_run_items", "apply_state", "text");
  addColumnIfMissing(db, "sync_flow_run_items", "created_target_transaction_id", "text");
  addColumnIfMissing(db, "sync_flow_run_items", "created_target_marker", "text");
  addColumnIfMissing(db, "sync_flow_run_items", "updated_at", "text");

  db.exec(SYNC_MAPPING_TABLE_SQL);
  for (const statement of SYNC_PLATFORM_V2_INDEX_SQL) db.exec(statement);
}

function applySyncPlatformV3(db: SqliteDatabase): void {
  // Stable preview ordering: planner output order persisted per run item.
  addColumnIfMissing(db, "sync_flow_run_items", "sequence", "integer");
  for (const statement of SYNC_PLATFORM_V3_INDEX_SQL) db.exec(statement);
}

// v8 (RD-063 / PR-028e): switch remembered credentials from per-budget to
// per-server. Drop the superseded `connection_credentials` table, and wipe the
// vault (salt, KDF version, verifier, and any sealed server blobs). The
// passphrase-derived key can't be re-derived at boot to migrate old blobs, and a
// v1.2.5 KDF-versioning bug can leave the stored verifier unverifiable — so the
// user re-sets a passphrase cleanly on the server-scoped model.
function applyServerVaultCutover(db: SqliteDatabase): void {
  db.exec("DROP TABLE IF EXISTS connection_credentials");
  db.exec("DELETE FROM server_credentials");
  db.exec("DELETE FROM budget_encryption_credentials");
  for (const key of [VERIFIER_META_KEY, SALT_META_KEY, KDF_VERSION_META_KEY]) {
    db.prepare("DELETE FROM app_meta WHERE key = ?").run(key);
  }
}

const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    statements: [
      APP_META_TABLE_SQL,
      SYNC_FLOW_TABLE_SQL,
      SYNC_FLOW_LEG_TABLE_SQL,
      SYNC_FLOW_RUN_TABLE_SQL,
      SYNC_FLOW_RUN_ITEM_TABLE_SQL,
      ...SYNC_FLOW_INDEX_SQL,
    ],
  },
  {
    version: 2,
    apply: applySyncPlatformV2,
  },
  {
    version: 3,
    apply: applySyncPlatformV3,
  },
  {
    version: 4,
    statements: [SYNC_CREDENTIAL_TABLE_SQL],
  },
  {
    version: 5,
    // FX registry (RD-056 / PR-025a). Batches first: fx_rates references it.
    statements: [FX_RATE_IMPORT_BATCH_TABLE_SQL, FX_RATES_TABLE_SQL, TRANSACTION_FX_TABLE_SQL, ...FX_INDEX_SQL],
  },
  {
    version: 6,
    // Remembered connection credentials (RD-061 / PR-026a).
    statements: [CONNECTION_CREDENTIAL_TABLE_SQL],
  },
  {
    version: 7,
    // Server-scoped remembered credentials (RD-063 / PR-028a). Additive: the
    // per-budget `connection_credentials` table + vault meta are cleared by the
    // v8 switch-over below.
    statements: [SERVER_CREDENTIAL_TABLE_SQL, BUDGET_ENCRYPTION_CREDENTIAL_TABLE_SQL],
  },
  {
    version: 8,
    apply: applyServerVaultCutover,
  },
  {
    version: 9,
    // Remembered budgets (RD-063 / PR-028f): one-click reconnect into a budget.
    statements: [REMEMBERED_BUDGET_TABLE_SQL],
  },
  {
    version: 10,
    // Persistent, cross-budget saved ActualQL queries (RD-064 / PR-029).
    statements: [SAVED_QUERY_TABLE_SQL],
  },
  {
    version: 11,
    // Bank statement reconciliation sessions (RD-071 / PR-034a).
    statements: [
      RECONCILIATION_PROFILE_TABLE_SQL,
      RECONCILIATION_SESSION_TABLE_SQL,
      RECONCILIATION_STATEMENT_ROW_TABLE_SQL,
      RECONCILIATION_ITEM_TABLE_SQL,
      ...RECONCILIATION_INDEX_SQL,
    ],
  },
  {
    version: 12,
    // Statement rows keep their original-currency amount (RD-071). Without it a
    // resumed session stops matching foreign purchases, because the converted
    // amount the statement posts never equals the amount recorded in Actual.
    apply: applyReconciliationOriginalAmounts,
  },
  {
    version: 13,
    // Per-operation apply outcomes (RD-071 / PR-034b), so a partial apply is
    // resumable without repeating writes that already succeeded.
    apply: applyReconciliationApplyResults,
  },
  {
    version: 14,
    // How writes are shaped, as distinct from how rows are matched (RD-071).
    apply: applyReconciliationApplyConfig,
  },
  {
    version: 15,
    // A user-supplied label per session (RD-071), for telling a month's reruns
    // and corrections apart in the list.
    apply: applyReconciliationSessionTag,
  },
  {
    version: 16,
    // The canonical statement model (RD-072): a statement row's two text
    // channels become the two Actual fields they belong to, and the write
    // configuration stops framing payee and notes as an either/or.
    apply: applyReconciliationImportSemantics,
  },
  {
    version: 17,
    // Payee Cleanup's "not duplicates" decisions (RD-078). Purely additive: a
    // new table and its index, nothing existing is touched.
    statements: [
      PAYEE_CLEANUP_SUPPRESSION_TABLE_SQL,
      PAYEE_CLEANUP_SUPPRESSION_INDEX_SQL,
    ],
  },
  {
    version: 18,
    // Automation engine storage (RD-079 / PR-043a). Purely additive: two new
    // tables and their indexes. No data is moved — Budget File Sync keeps
    // running on its own scheduler until PR-043c migrates it — so this upgrade
    // is reversible by dropping the tables.
    statements: [
      AUTOMATION_DEFINITION_TABLE_SQL,
      AUTOMATION_RUN_TABLE_SQL,
      ...AUTOMATION_INDEX_SQL,
    ],
  },
  {
    version: 19,
    // Repair for a database that reached v18 from an *intermediate* build of the
    // automation branch.
    //
    // `running_since` was added to the v18 table definition during review, while
    // v18 was still unreleased — which is safe for anyone who had never run the
    // branch, and wrong for anyone who had. A database migrated by the earlier
    // build records schema_version 18, so the corrected v18 is skipped and the
    // column never appears: every engine tick then fails with "no such column:
    // running_since", and no automation runs at all.
    //
    // `CREATE TABLE IF NOT EXISTS` cannot fix this — the table already exists —
    // so the column is added on its own, guarded, and is a no-op on a database
    // that got the corrected v18.
    apply: applyAutomationClaimColumn,
  },
  {
    version: 20,
    // Verified backup storage (RD-077 / PR-047a). Additive: four new tables and
    // their indexes, read by nothing yet, so the upgrade is reversible by
    // dropping them.
    statements: [
      BACKUP_DESTINATION_TABLE_SQL,
      BACKUP_POLICY_TABLE_SQL,
      BACKUP_ARTIFACT_TABLE_SQL,
      BACKUP_ARTIFACT_LOCATION_TABLE_SQL,
      ...BACKUP_INDEX_SQL,
    ],
  },
  {
    version: 21,
    // Sealed credentials for backup destinations and backup encryption
    // (RD-077 / PR-047b). Additive.
    statements: [BACKUP_CREDENTIAL_TABLE_SQL],
  },
  {
    version: 22,
    // A backup rule owns its own schedule (RD-077 / PR-047d): people think
    // "back up nightly at 2am" as part of the rule, not as a separate object.
    // The automation engine mirrors these into automations. Additive.
    apply(db) {
      addColumnIfMissing(db, "backup_policies", "schedule_kind", "text NOT NULL DEFAULT 'cron'");
      addColumnIfMissing(db, "backup_policies", "cron_expression", "text");
      addColumnIfMissing(db, "backup_policies", "interval_minutes", "integer");
      addColumnIfMissing(db, "backup_policies", "timezone", "text NOT NULL DEFAULT 'UTC'");
      addColumnIfMissing(db, "backup_policies", "scrub_enabled", "integer NOT NULL DEFAULT 1");
    },
  },
  {
    version: 23,
    // An encrypted artifact remembers which sealed passphrase opens it (RD-077
    // / PR-047). It cannot be derived from the rule: deleting a rule nulls the
    // artifact's policy reference by design, which is exactly the moment the
    // link matters most. Additive.
    apply(db) {
      addColumnIfMissing(db, "backup_artifacts", "encryption_credential_ref", "text");
      // Backfill from the rules that still exist, so copies taken before this
      // migration stay openable.
      db.exec(
        `UPDATE backup_artifacts
            SET encryption_credential_ref = (
              SELECT encryption_credential_ref FROM backup_policies
               WHERE backup_policies.id = backup_artifacts.policy_id
            )
          WHERE encrypted = 1 AND encryption_credential_ref IS NULL`
      );
    },
  },
  {
    version: 24,
    // Rule Diagnostics dismissals (F-103 / PR-049). Additive: one table and its
    // index, read by nothing before this release, so the upgrade is reversible
    // by dropping them.
    statements: [
      RULE_DIAGNOSTICS_DISMISSAL_TABLE_SQL,
      RULE_DIAGNOSTICS_DISMISSAL_INDEX_SQL,
    ],
  },
  {
    version: 25,
    // The statement's format on the session (F-136 / PR-052). Additive and
    // nullable: a session created before this has no answer, and deriving one
    // from the filename would record a guess as if it were read from the file.
    //
    // `CREATE TABLE IF NOT EXISTS` cannot add a column to a table that already
    // exists, so this goes through the guarded ALTER rather than the table SQL.
    apply: applyReconciliationStatementFormatColumn,
  },
  {
    version: 26,
    // PDF parser guidance belongs to a bank/layout rather than one Actual
    // account. These additive tables keep the global catalog separate from
    // account-scoped reconciliation and matching profiles.
    statements: [
      PDF_DETECTION_BANK_TABLE_SQL,
      PDF_DETECTION_PROFILE_TABLE_SQL,
      PDF_DETECTION_ACCOUNT_BANK_TABLE_SQL,
      ...PDF_DETECTION_PROFILE_INDEX_SQL,
    ],
  },
  {
    version: 27,
    // An account may prefer one layout within its bank. The bank default is a
    // fallback for accounts without an explicit preference, not a replacement
    // for the account-level credit-card/checking distinction.
    apply: applyPdfDetectionPreferredProfileColumn,
  },
  {
    version: 28,
    // Bank names group layouts but Actual accounts do not identify their bank.
    // Freeze any old bank-default association to the concrete profile it used,
    // then make all future assignments directly account-to-profile.
    apply: applyPdfDetectionDirectProfileAssignments,
  },
  {
    version: 29,
    // Layouts describe a bank's table, not one statement and not a bank
    // entity. The old shape kept a statement period, page-indexed transaction
    // areas, and a bank as a row of its own with two association tables around
    // it; none of that survives re-reading next month's statement. The feature
    // is unreleased, so the tables are replaced rather than migrated.
    apply: applyPdfStatementLayouts,
  },
  {
    version: 30,
    // The FK was CASCADE despite the column comment saying a run stays
    // readable after its definition is deleted - deleting an automation
    // silently erased all its history, the opposite of what that comment
    // promises. `automation_id` was already nullable, so this only changes
    // delete behavior; every other column is untouched.
    apply: applyAutomationRunsDeleteSetNull,
  },
  {
    version: 31,
    // A flow is one source -> one target, not a multi-leg pipeline; nothing
    // ever created more than one leg per flow, and the UI never exposed a way
    // to. The single leg's fields move onto the flow row directly.
    apply: applySyncFlowLegsCollapse,
  },
  {
    version: 32,
    // Repairs a real bad state an earlier build of v31 could leave behind: it
    // dropped `sync_flow_legs` before this file also dropped
    // `sync_flow_run_items.leg_id`, so a database that already recorded
    // schema_version 31 from that build is stuck with a column whose FK
    // target table no longer exists - which breaks every future insert into
    // sync_flow_run_items, even NULL ones, once foreign_keys is on. v31 itself
    // can't be edited to fix this (AGENTS.md: never rewrite a migration that
    // may have shipped, and it wouldn't rerun for a DB already at 31 anyway).
    apply: applySyncFlowRunItemsLegIdRepair,
  },
  {
    version: 33,
    // Clears out the `already_synced` run items real installs have already
    // accumulated - six figures of them on an unattended flow that has been
    // ticking for a while. Nothing reads them back: apply never revisits an
    // already-synced item, and the count the UI shows comes from the run's own
    // `counts` envelope, not from these rows. New runs no longer write them
    // (see buildEphemeralSyncFlowRunItem in syncRunRepository.ts); this is the
    // backlog that predates that.
    apply: applyAlreadySyncedRunItemPurge,
  },
  {
    version: 34,
    // Two additions the unattended worker platform builds on (F-189, RD-095):
    // a per-server request lease, so requests to one actual-http-api stay
    // serialized across module instances and worker threads rather than only
    // within one in-memory queue; and an optional input on each automation run,
    // so a run can say what it was started for (an event id, later) without
    // another schema change.
    apply: applyServerLeasesAndRunInput,
  },
  {
    version: 35,
    // One secret store (F-195). Four credential tables, each with its own
    // repository, become one `credentials` table whose key domain -
    // `passphrase` (remembered, opened only after the user unlocks) or
    // `operator` (unattended, opened with SYNC_VAULT_KEY) - is part of every
    // row's identity. Non-secret records move to tables of their own. Every
    // ciphertext is copied byte for byte: this migration never decrypts, so it
    // runs without either key.
    apply: applyCredentialStore,
  },
  {
    version: 36,
    // No structural change. Automation runs gain a status, `indeterminate`
    // (RD-095): a run stopped after it may already have changed something.
    // The status is a plain string read back with a cast, so an older Actual
    // Bench would misread it; bumping the version is what makes an older build
    // refuse this database instead (agents/knowledge.md: a new stored enum
    // value ships with a schema-version bump).
    statements: [],
  },
  {
    version: 37,
    // When Bench last uploaded a fresh snapshot of a Direct budget it opens
    // unattended (RD-095 M3). A download replays every change since the
    // server's last snapshot, and only a client that uploads one refreshes it;
    // Actual's own clients do so weekly, a headless one never does. Without
    // this, a budget only Bench touches opens slower each week until it runs
    // out of memory (M0, Appendix B.2).
    statements: [
      `CREATE TABLE IF NOT EXISTS budget_runtime_state (
         server_fingerprint TEXT NOT NULL,
         budget_sync_id TEXT NOT NULL,
         last_snapshot_at TEXT NOT NULL,
         PRIMARY KEY (server_fingerprint, budget_sync_id)
       )`,
    ],
  },
];

function applyCredentialStore(db: SqliteDatabase): void {
  db.exec(`
CREATE TABLE IF NOT EXISTS credentials (
  domain text NOT NULL CHECK (domain IN ('passphrase', 'operator')),
  ref text NOT NULL,
  kind text NOT NULL,
  label text NOT NULL DEFAULT '',
  ciphertext text NOT NULL,
  iv text NOT NULL,
  auth_tag text NOT NULL,
  key_id text NOT NULL DEFAULT 'v1',
  created_at text NOT NULL,
  updated_at text NOT NULL,
  PRIMARY KEY (domain, ref)
);
CREATE TABLE IF NOT EXISTS remembered_servers (
  server_fingerprint text PRIMARY KEY,
  mode text NOT NULL,
  base_url text NOT NULL,
  label text NOT NULL DEFAULT '',
  created_at text NOT NULL,
  updated_at text NOT NULL
);
CREATE TABLE IF NOT EXISTS unattended_connections (
  connection_fingerprint text PRIMARY KEY,
  server_fingerprint text NOT NULL,
  mode text NOT NULL,
  base_url text NOT NULL,
  budget_sync_id text NOT NULL,
  label text NOT NULL DEFAULT '',
  created_at text NOT NULL,
  updated_at text NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_unattended_connections_server ON unattended_connections(server_fingerprint);
`);

  // Remembered servers: metadata to its own table, the sealed secret to the
  // passphrase domain under the server's ref.
  if (tableExists(db, "server_credentials")) {
    db.exec(`
INSERT OR IGNORE INTO remembered_servers (server_fingerprint, mode, base_url, label, created_at, updated_at)
  SELECT server_fingerprint, mode, base_url, label, created_at, updated_at FROM server_credentials;
INSERT OR IGNORE INTO credentials (domain, ref, kind, label, ciphertext, iv, auth_tag, created_at, updated_at)
  SELECT 'passphrase', 'server:' || server_fingerprint, 'server-login', label, ciphertext, iv, auth_tag, created_at, updated_at
  FROM server_credentials;
DROP TABLE server_credentials;
`);
  }

  if (tableExists(db, "budget_encryption_credentials")) {
    db.exec(`
INSERT OR IGNORE INTO credentials (domain, ref, kind, label, ciphertext, iv, auth_tag, created_at, updated_at)
  SELECT 'passphrase', 'budget:' || server_fingerprint || ':' || budget_sync_id, 'budget-encryption-password',
         label, ciphertext, iv, auth_tag, created_at, updated_at
  FROM budget_encryption_credentials;
DROP TABLE budget_encryption_credentials;
`);
  }

  // Backup secrets keep the refs their destinations and policies point at.
  if (tableExists(db, "backup_credentials")) {
    db.exec(`
INSERT OR IGNORE INTO credentials (domain, ref, kind, label, ciphertext, iv, auth_tag, created_at, updated_at)
  SELECT 'operator', ref, CASE kind WHEN 'passphrase' THEN 'backup-passphrase' ELSE kind END,
         label, ciphertext, iv, auth_tag, created_at, updated_at
  FROM backup_credentials;
DROP TABLE backup_credentials;
`);
  }

  // Unattended connections were stored one secret per budget. Their sealed
  // `{ apiKey, encryptionPassword }` blobs are kept whole as legacy rows,
  // because splitting them into one server secret and a per-budget password
  // needs the key; `unattendedCredentials` does that once the key is present.
  // The server fingerprint is computed here, by the app's own function - it is
  // a hash, so SQL cannot derive it.
  if (tableExists(db, "sync_credentials")) {
    const rows = db
      .prepare(
        "SELECT connection_fingerprint, mode, base_url, budget_sync_id, label, ciphertext, iv, auth_tag, created_at, updated_at FROM sync_credentials"
      )
      .all<{
        connection_fingerprint: string;
        mode: string;
        base_url: string;
        budget_sync_id: string;
        label: string;
        ciphertext: string;
        iv: string;
        auth_tag: string;
        created_at: string;
        updated_at: string;
      }>();
    const insertConnection = db.prepare(
      `INSERT OR IGNORE INTO unattended_connections (
         connection_fingerprint, server_fingerprint, mode, base_url, budget_sync_id, label, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const insertLegacySecret = db.prepare(
      `INSERT OR IGNORE INTO credentials (domain, ref, kind, label, ciphertext, iv, auth_tag, created_at, updated_at)
       VALUES ('operator', ?, 'legacy-http-connection', ?, ?, ?, ?, ?, ?)`
    );
    for (const row of rows) {
      insertConnection.run(
        row.connection_fingerprint,
        serverFingerprint({ mode: row.mode as ConnectionMode, baseUrl: row.base_url }),
        row.mode,
        row.base_url,
        row.budget_sync_id,
        row.label,
        row.created_at,
        row.updated_at
      );
      insertLegacySecret.run(
        `legacy:${row.connection_fingerprint}`,
        row.label,
        row.ciphertext,
        row.iv,
        row.auth_tag,
        row.created_at,
        row.updated_at
      );
    }
    db.exec("DROP TABLE sync_credentials");
  }
}

function applyServerLeasesAndRunInput(db: SqliteDatabase): void {
  db.exec(`
CREATE TABLE IF NOT EXISTS server_request_leases (
  server_key text PRIMARY KEY,
  holder text NOT NULL,
  acquired_at text NOT NULL,
  expires_at_ms integer NOT NULL
);
`);
  if (tableExists(db, "automation_runs")) {
    addColumnIfMissing(db, "automation_runs", "input_json", "text");
  }
}

function applyAlreadySyncedRunItemPurge(db: SqliteDatabase): void {
  if (!tableExists(db, "sync_flow_run_items")) return;
  if (!columnExists(db, "sync_flow_run_items", "classification")) return;
  db.exec("DELETE FROM sync_flow_run_items WHERE classification = 'already_synced'");
}

function applySyncFlowRunItemsLegIdRepair(db: SqliteDatabase): void {
  if (!tableExists(db, "sync_flow_run_items")) return;
  // Only unsafe to keep when the table it points to is actually gone; if
  // sync_flow_legs still exists here, v31 hasn't run yet and will handle it.
  if (tableExists(db, "sync_flow_legs")) return;
  if (columnExists(db, "sync_flow_run_items", "leg_id")) {
    db.exec("ALTER TABLE sync_flow_run_items DROP COLUMN leg_id");
  }
}

function applySyncFlowLegsCollapse(db: SqliteDatabase): void {
  if (!tableExists(db, "sync_flows")) return;

  // sync_mappings.flow_id, sync_flow_runs.flow_id, and
  // sync_flow_run_items.flow_id all hold a live FK to this table (CASCADE for
  // sync_mappings). A rename-based rebuild (the pattern used elsewhere in this
  // file) is unsafe here: SQLite rewrites every dependent's FK clause to
  // follow the rename, and then dropping the renamed-away table fires their
  // ON DELETE actions against every row as if each flow had really been
  // deleted - wiping every mapping via the CASCADE. `foreign_keys` can't be
  // toggled off mid-transaction to work around it (runMigrations runs the
  // whole chain in one), so this stays a pure ADD COLUMN + backfill instead -
  // sync_flows itself is never renamed or recreated, so nothing depending on
  // it is ever at risk.
  const defaultEnvelope = '{"version":1,"data":{}}';
  for (const column of ["source_ref_json", "target_ref_json", "filter_json", "transform_json", "options_json"]) {
    addColumnIfMissing(db, "sync_flows", column, `text NOT NULL DEFAULT '${defaultEnvelope}'`);
  }

  if (tableExists(db, "sync_flow_legs")) {
    // The UI has only ever created one leg per flow, but createSyncFlow's old
    // input validation never enforced that - a flow built by a direct API
    // call, never through the UI, could in principle have more than one.
    // Backfilling only ever reads the first (by position) either way, so
    // failing loudly here beats silently dropping a real second leg with no
    // record it ever existed.
    const multiLeg = db
      .prepare("SELECT flow_id, COUNT(*) AS n FROM sync_flow_legs GROUP BY flow_id HAVING n > 1")
      .all() as Array<{ flow_id: string; n: number }>;
    if (multiLeg.length > 0) {
      const ids = multiLeg.map((row) => row.flow_id).join(", ");
      const quoted = multiLeg.map((row) => `'${row.flow_id.replace(/'/g, "''")}'`).join(", ");
      // Refusing to open is the same posture as the "schema is newer than this
      // app" check above: a data problem nobody can see is worse than a stop.
      // But a stop has to be actionable, and the app is down at this point, so
      // the way out cannot be anywhere inside it - the statements go here.
      throw new AppDbUnavailableError(
        `Cannot collapse sync_flow_legs: flow(s) ${ids} have more than one leg, and only the first would survive. ` +
          "This was never reachable through the UI, so it means a flow was created by calling the API directly. " +
          "To resolve it, open the database with the sqlite3 CLI and inspect them:\n" +
          `  SELECT * FROM sync_flow_legs WHERE flow_id IN (${quoted}) ORDER BY flow_id, position;\n` +
          "Keep whichever leg each flow should actually use (the upgrade keeps the lowest position) and delete the rest, e.g.:\n" +
          `  DELETE FROM sync_flow_legs WHERE flow_id IN (${quoted}) AND position > 0;\n` +
          "Bench starts normally once every flow has at most one."
      );
    }

    db.exec(`
      UPDATE sync_flows
      SET (source_ref_json, target_ref_json, filter_json, transform_json, options_json) = (
        SELECT source_ref_json, target_ref_json, filter_json, transform_json, options_json
          FROM sync_flow_legs
         WHERE flow_id = sync_flows.id
         ORDER BY position ASC
         LIMIT 1
      )
      WHERE EXISTS (SELECT 1 FROM sync_flow_legs WHERE flow_id = sync_flows.id)
    `);

    // sync_flow_run_items.leg_id references sync_flow_legs and nothing has
    // ever written it (grep confirms no caller sets it) - but a FK column
    // referencing a table that no longer exists breaks every future insert
    // into sync_flow_run_items, even inserting NULL for it, once the
    // referenced table is gone. Drop the column first, then the table.
    if (columnExists(db, "sync_flow_run_items", "leg_id")) {
      db.exec("ALTER TABLE sync_flow_run_items DROP COLUMN leg_id");
    }
    db.exec("DROP TABLE sync_flow_legs");
  }
}

// The v30 shape: identical to AUTOMATION_RUN_TABLE_SQL except automation_id
// is ON DELETE SET NULL. Defined locally rather than reusing that (v18)
// constant - AGENTS.md: "Never rewrite a migration that may have shipped."
const AUTOMATION_RUN_TABLE_V30_SQL = `
CREATE TABLE automation_runs (
  id text PRIMARY KEY,
  automation_id text REFERENCES automation_definitions(id) ON DELETE SET NULL,
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
`;

function applyAutomationRunsDeleteSetNull(db: SqliteDatabase): void {
  if (!tableExists(db, "automation_runs")) return;
  db.exec("ALTER TABLE automation_runs RENAME TO automation_runs_old");
  db.exec(AUTOMATION_RUN_TABLE_V30_SQL);
  db.exec(`
    INSERT INTO automation_runs
      (id, automation_id, type, status, started_at, finished_at, trigger,
       attempt, execution_mode, result_json, rollup_json, error_json)
    SELECT id, automation_id, type, status, started_at, finished_at, trigger,
           attempt, execution_mode, result_json, rollup_json, error_json
    FROM automation_runs_old
  `);
  db.exec("DROP TABLE automation_runs_old");
  // Dropping the table dropped its index; the other AUTOMATION_INDEX_SQL
  // entry (automation_definitions) is untouched and unrelated to this rebuild.
  for (const statement of AUTOMATION_INDEX_SQL) {
    if (statement.includes("ON automation_runs")) db.exec(statement);
  }
}

function applyPdfStatementLayouts(db: SqliteDatabase): void {
  for (const table of [
    "pdf_detection_account_banks",
    "pdf_detection_account_profiles",
    "pdf_detection_profiles",
    "pdf_detection_banks",
  ]) {
    db.exec(`DROP TABLE IF EXISTS ${table}`);
  }
  db.exec(PDF_STATEMENT_LAYOUT_TABLE_SQL);
  db.exec(PDF_STATEMENT_LAYOUT_ACCOUNT_TABLE_SQL);
  for (const statement of PDF_STATEMENT_LAYOUT_INDEX_SQL) db.exec(statement);
}

function applyPdfDetectionDirectProfileAssignments(db: SqliteDatabase): void {
  db.exec(PDF_DETECTION_ACCOUNT_PROFILE_TABLE_SQL);
  if (tableExists(db, "pdf_detection_account_banks")) {
    db.exec(
      `INSERT OR REPLACE INTO pdf_detection_account_profiles
         (budget_sync_id, account_id, profile_id, updated_at)
       SELECT association.budget_sync_id,
              association.account_id,
              COALESCE(association.preferred_profile_id, bank.default_profile_id),
              association.updated_at
         FROM pdf_detection_account_banks association
         JOIN pdf_detection_banks bank ON bank.id = association.bank_id
        WHERE COALESCE(association.preferred_profile_id, bank.default_profile_id) IS NOT NULL`
    );
  }
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_pdf_detection_account_profile ON pdf_detection_account_profiles(profile_id)"
  );
}

function applyPdfDetectionPreferredProfileColumn(db: SqliteDatabase): void {
  if (!tableExists(db, "pdf_detection_account_banks")) return;
  addColumnIfMissing(
    db,
    "pdf_detection_account_banks",
    "preferred_profile_id",
    "text REFERENCES pdf_detection_profiles(id) ON DELETE SET NULL"
  );
}

function applyReconciliationStatementFormatColumn(db: SqliteDatabase): void {
  // Guarded on the table, not just the column: a database stamped at a version
  // it never fully reached — the v18 branch-build case repaired above — can
  // arrive here without `reconciliation_sessions` at all, and an unguarded
  // ALTER would fail the whole upgrade. Where the table is missing, the base
  // schema creates it with this column already in place.
  if (!tableExists(db, "reconciliation_sessions")) return;
  addColumnIfMissing(db, "reconciliation_sessions", "statement_format", "text");
}

function applyAutomationClaimColumn(db: SqliteDatabase): void {
  addColumnIfMissing(db, "automation_definitions", "running_since", "text");
}

/**
 * RD-072: statement rows, saved profiles and apply configs move to the
 * canonical import model.
 *
 * A table rebuild rather than added columns, because `description` was `NOT
 * NULL` and would have to go on being written forever — leaving two names for
 * the same channel and no way to tell which one a reader should trust. The
 * feature is days old with no adoption, so the honest migration is the one that
 * leaves a single correct schema behind.
 *
 * Idempotent by inspection: a database created after this change already has
 * the new shape (the table SQL in `schema.ts` is the current one), so the
 * rebuild only runs where the old columns are actually present.
 */
function applyReconciliationImportSemantics(db: SqliteDatabase): void {
  if (
    tableExists(db, "reconciliation_statement_rows") &&
    !columnExists(db, "reconciliation_statement_rows", "imported_payee")
  ) {
    db.exec(
      "ALTER TABLE reconciliation_statement_rows RENAME TO reconciliation_statement_rows_old"
    );
    db.exec(RECONCILIATION_STATEMENT_ROW_TABLE_SQL);
    db.exec(`
      INSERT INTO reconciliation_statement_rows
        (id, session_id, source_row_number, posted_date, amount, imported_payee, bank_notes,
         bank_reference, external_id, transaction_date, original_amount, original_currency,
         fingerprint, raw_json)
      SELECT id, session_id, source_row_number, posted_date, amount, description, NULL,
             reference, NULL, transaction_date, original_amount, original_currency,
             fingerprint, raw_json
      FROM reconciliation_statement_rows_old
    `);
    db.exec("DROP TABLE reconciliation_statement_rows_old");
    // Dropping the table dropped its indexes; only those are recreated, since
    // the other tables' indexes are untouched and re-running them all would
    // depend on tables this step has no business requiring.
    for (const statement of RECONCILIATION_INDEX_SQL) {
      if (statement.includes("ON reconciliation_statement_rows")) db.exec(statement);
    }
  }

  migrateReconciliationJson(
    db,
    "reconciliation_profiles",
    "mapping_json",
    migrateProfileMapping
  );
  migrateReconciliationJson(
    db,
    "reconciliation_sessions",
    "apply_config_json",
    migrateApplyConfig
  );
}

/** Rewrite one JSON column row by row, leaving anything unparseable alone. */
function migrateReconciliationJson(
  db: SqliteDatabase,
  table: string,
  column: string,
  transform: (value: Record<string, unknown>) => Record<string, unknown> | null
): void {
  if (!tableExists(db, table) || !columnExists(db, table, column)) return;

  const rows = db
    .prepare(`SELECT id, ${column} AS value FROM ${table} WHERE ${column} IS NOT NULL`)
    .all<{ id: string; value: string }>();

  const update = db.prepare(`UPDATE ${table} SET ${column} = ? WHERE id = ?`);
  for (const row of rows) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.value);
    } catch {
      // Not our problem to fix here: the app reads these defensively, and
      // failing the whole migration over one corrupt row would be worse.
      continue;
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) continue;
    const next = transform(parsed as Record<string, unknown>);
    if (next) update.run(JSON.stringify(next), row.id);
  }
}

/** Saved column mapping → `StatementParseConfig` (RD-072 §2.5). */
function migrateProfileMapping(
  mapping: Record<string, unknown>
): Record<string, unknown> | null {
  if (mapping.columns !== undefined || mapping.format !== undefined) return null;

  const { date, description, amount, debit, credit, reference, ...rest } = mapping;
  return {
    ...rest,
    format: "delimited",
    columns: {
      date: date ?? 0,
      importedPayee: description ?? 1,
      notes: undefined,
      amount,
      debit,
      credit,
      reference,
    },
    swapPayeeAndMemo: false,
    fallbackPayeeToMemo: true,
  };
}

/**
 * `descriptionTarget` → independent payee/notes strategies (RD-072 §2.2).
 *
 * The old "notes" choice becomes "leave the payee to rules, put the bank's text
 * in the notes" — the same workflow, except the bank's text is now also
 * recorded as the imported payee, which is the point of the change.
 */
function migrateApplyConfig(config: Record<string, unknown>): Record<string, unknown> | null {
  if (config.payeeStrategy !== undefined) return null;

  const toNotes = config.descriptionTarget === "notes";
  const rest = { ...config };
  delete rest.descriptionTarget;
  return {
    ...rest,
    payeeStrategy: toNotes ? "leave-unset" : "imported-payee",
    notesStrategy: toNotes ? "imported-payee" : "bank-notes",
    enrichImportedPayee: true,
  };
}

function applyReconciliationSessionTag(db: SqliteDatabase): void {
  addColumnIfMissing(db, "reconciliation_sessions", "tag", "text");
}

function applyReconciliationApplyConfig(db: SqliteDatabase): void {
  addColumnIfMissing(db, "reconciliation_sessions", "apply_config_json", "text");
}

function applyReconciliationApplyResults(db: SqliteDatabase): void {
  addColumnIfMissing(db, "reconciliation_sessions", "apply_results_json", "text");
}

function applyReconciliationOriginalAmounts(db: SqliteDatabase): void {
  addColumnIfMissing(db, "reconciliation_statement_rows", "transaction_date", "text");
  addColumnIfMissing(db, "reconciliation_statement_rows", "original_amount", "integer");
  addColumnIfMissing(db, "reconciliation_statement_rows", "original_currency", "text");
}

function nowIso(): string {
  return new Date().toISOString();
}

function tableExists(db: SqliteDatabase, tableName: string): boolean {
  const row = db
    .prepare("SELECT COUNT(*) AS count FROM sqlite_schema WHERE type = 'table' AND name = ?")
    .get<{ count: number }>(tableName);
  return Number(row?.count ?? 0) > 0;
}

function metaValue(db: SqliteDatabase, key: string): string | null {
  if (!tableExists(db, "app_meta")) return null;
  const row = db
    .prepare("SELECT value FROM app_meta WHERE key = ?")
    .get<{ value: string }>(key);
  return row?.value ?? null;
}

function currentSchemaVersion(db: SqliteDatabase): number {
  const raw = metaValue(db, "schema_version");
  if (raw === null) return 0;

  const version = Number(raw);
  if (!Number.isInteger(version) || version < 0) {
    throw new AppDbUnavailableError(`Invalid app database schema_version: ${raw}`);
  }
  return version;
}

function upsertMeta(db: SqliteDatabase, key: string, value: string, updatedAt: string): void {
  db.prepare(
    `INSERT INTO app_meta (key, value, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET
       value = excluded.value,
       updated_at = excluded.updated_at`
  ).run(key, value, updatedAt);
}

function insertMetaIfMissing(db: SqliteDatabase, key: string, value: string, updatedAt: string): void {
  db.prepare(
    `INSERT INTO app_meta (key, value, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(key) DO NOTHING`
  ).run(key, value, updatedAt);
}

export function readMigrationMeta(db: SqliteDatabase): AppDbMigrationMeta {
  return {
    schemaVersion: currentSchemaVersion(db),
    createdAt: metaValue(db, "created_at"),
    lastMigratedAt: metaValue(db, "last_migrated_at"),
  };
}

export function runMigrations(db: SqliteDatabase): AppDbMigrationMeta {
  const currentVersion = currentSchemaVersion(db);
  if (currentVersion > LATEST_SCHEMA_VERSION) {
    throw new AppDbUnavailableError(
      `App database schema ${currentVersion} is newer than this app supports (${LATEST_SCHEMA_VERSION})`
    );
  }

  const pending = MIGRATIONS.filter((migration) => migration.version > currentVersion);
  if (pending.length === 0) {
    return readMigrationMeta(db);
  }

  const migrate = db.transaction(() => {
    for (const migration of pending) {
      if (migration.apply) {
        migration.apply(db);
      } else {
        for (const statement of migration.statements ?? []) {
          db.exec(statement);
        }
      }

      const migratedAt = nowIso();
      insertMetaIfMissing(db, "created_at", migratedAt, migratedAt);
      upsertMeta(db, "schema_version", String(migration.version), migratedAt);
      upsertMeta(db, "last_migrated_at", migratedAt, migratedAt);
    }
  });

  migrate();
  return readMigrationMeta(db);
}
