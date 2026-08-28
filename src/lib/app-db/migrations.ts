import type { SqliteDatabase } from "./types";
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

export const LATEST_SCHEMA_VERSION = 23;

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
];

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
