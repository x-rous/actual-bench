import type { SqliteDatabase } from "./types";
import {
  APP_META_TABLE_SQL,
  SYNC_FLOW_INDEX_SQL,
  SYNC_FLOW_LEG_TABLE_SQL,
  SYNC_FLOW_RUN_ITEM_TABLE_SQL,
  SYNC_FLOW_RUN_TABLE_SQL,
  SYNC_FLOW_TABLE_SQL,
  SYNC_MAPPING_TABLE_SQL,
  SYNC_PLATFORM_V2_INDEX_SQL,
  SYNC_PLATFORM_V3_INDEX_SQL,
} from "./schema";
import { AppDbUnavailableError } from "./errors";

export const LATEST_SCHEMA_VERSION = 3;

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
];

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
