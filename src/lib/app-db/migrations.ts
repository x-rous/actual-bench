import type { SqliteDatabase } from "./types";
import {
  APP_META_TABLE_SQL,
  SYNC_FLOW_INDEX_SQL,
  SYNC_FLOW_LEG_TABLE_SQL,
  SYNC_FLOW_RUN_ITEM_TABLE_SQL,
  SYNC_FLOW_RUN_TABLE_SQL,
  SYNC_FLOW_TABLE_SQL,
} from "./schema";
import { AppDbUnavailableError } from "./errors";

export const LATEST_SCHEMA_VERSION = 1;

type Migration = {
  version: number;
  statements: readonly string[];
};

export type AppDbMigrationMeta = {
  schemaVersion: number;
  createdAt: string | null;
  lastMigratedAt: string | null;
};

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
      for (const statement of migration.statements) {
        db.exec(statement);
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
