import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  DEFAULT_APP_DB_PATH,
  getAppDb,
  getAppDbHealth,
  resetAppDbForTests,
  resolveAppDbPath,
} from "./connection";
import {
  APP_META_TABLE_SQL,
  SYNC_FLOW_INDEX_SQL,
  SYNC_FLOW_LEG_TABLE_SQL,
  SYNC_FLOW_RUN_ITEM_TABLE_SQL,
  SYNC_FLOW_RUN_TABLE_SQL,
  SYNC_FLOW_TABLE_SQL,
} from "./schema";
import type { SqliteDatabase } from "./types";

function tempDbPath(): { root: string; dbPath: string } {
  const root = mkdtempSync(join(tmpdir(), "actual-bench-db-"));
  return { root, dbPath: join(root, "metadata.sqlite") };
}

describe("app DB connection", () => {
  afterEach(() => {
    resetAppDbForTests();
    delete process.env.ACTUAL_BENCH_DB_PATH;
    delete process.env.VERCEL;
  });

  it("resolves the default and override database paths", () => {
    expect(resolveAppDbPath({} as NodeJS.ProcessEnv)).toBe(DEFAULT_APP_DB_PATH);
    expect(resolveAppDbPath({ ACTUAL_BENCH_DB_PATH: "./tmp/app.sqlite" } as unknown as NodeJS.ProcessEnv)).toBe(
      resolve("./tmp/app.sqlite")
    );
  });

  it("falls back to a writable temp path on Vercel when no override is set", () => {
    // On Vercel `/data` does not exist and the filesystem is read-only except
    // the temp dir, so the default must not be the (unwritable) `/data` path.
    expect(resolveAppDbPath({ VERCEL: "1" } as unknown as NodeJS.ProcessEnv)).toBe(
      resolve(tmpdir(), "actual-bench.sqlite")
    );
    // An explicit override still wins on Vercel.
    expect(
      resolveAppDbPath({ VERCEL: "1", ACTUAL_BENCH_DB_PATH: "/mnt/app.sqlite" } as unknown as NodeJS.ProcessEnv)
    ).toBe(resolve("/mnt/app.sqlite"));
  });

  it("reports a ready but non-durable metadata DB on the Vercel runtime", () => {
    process.env.VERCEL = "1";
    const { root, dbPath } = tempDbPath();

    try {
      const health = getAppDbHealth(dbPath);
      expect(health.ready).toBe(true);
      expect(health.writable).toBe(true);
      expect(health.schemaVersion).toBe(5);
      expect(health.runtime).toBe("vercel");
      expect(health.durable).toBe(false);
    } finally {
      resetAppDbForTests();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("initializes the default metadata DB on Vercel without an override (the demo condition)", () => {
    // Reproduces the exact demo setup: VERCEL set, no ACTUAL_BENCH_DB_PATH.
    // Previously this defaulted to `/data` and failed with ENOENT.
    process.env.VERCEL = "1";
    delete process.env.ACTUAL_BENCH_DB_PATH;
    const defaultPath = resolveAppDbPath();

    try {
      expect(defaultPath).toBe(resolve(tmpdir(), "actual-bench.sqlite"));
      const health = getAppDbHealth(); // no arg → uses the resolved default
      expect(health.ready).toBe(true);
      expect(health.writable).toBe(true);
      expect(health.error).toBeUndefined();
    } finally {
      resetAppDbForTests();
      for (const suffix of ["", "-wal", "-shm"]) {
        rmSync(`${defaultPath}${suffix}`, { force: true });
      }
    }
  });

  it("initializes migrations idempotently and reports health", () => {
    const { root, dbPath } = tempDbPath();

    try {
      const db = getAppDb(dbPath);
      const version = db
        .prepare("SELECT value FROM app_meta WHERE key = ?")
        .get<{ value: string }>("schema_version");
      expect(version?.value).toBe("5");

      const sameDb = getAppDb(dbPath);
      expect(sameDb).toBe(db);

      const health = getAppDbHealth(dbPath);
      expect(health.ready).toBe(true);
      expect(health.writable).toBe(true);
      expect(health.schemaVersion).toBe(5);
      expect(health.configuredPath).toBe(dbPath);
    } finally {
      resetAppDbForTests();
      rmSync(root, { recursive: true, force: true });
    }
  });


  it("migrates an existing schema v1 database to the sync platform schema", () => {
    const { root, dbPath } = tempDbPath();

    try {
      const db = new Database(dbPath) as SqliteDatabase;
      db.exec(APP_META_TABLE_SQL);
      db.exec(SYNC_FLOW_TABLE_SQL);
      db.exec(SYNC_FLOW_LEG_TABLE_SQL);
      db.exec(SYNC_FLOW_RUN_TABLE_SQL);
      db.exec(SYNC_FLOW_RUN_ITEM_TABLE_SQL);
      for (const statement of SYNC_FLOW_INDEX_SQL) db.exec(statement);
      db.prepare("INSERT INTO app_meta (key, value, updated_at) VALUES (?, ?, ?)").run("schema_version", "1", "2026-01-01T00:00:00.000Z");
      db.prepare("INSERT INTO app_meta (key, value, updated_at) VALUES (?, ?, ?)").run("created_at", "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z");
      db.prepare("INSERT INTO app_meta (key, value, updated_at) VALUES (?, ?, ?)").run("last_migrated_at", "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z");
      db.close();

      const migrated = getAppDb(dbPath);
      const version = migrated.prepare("SELECT value FROM app_meta WHERE key = ?").get<{ value: string }>("schema_version");
      const flowTypeColumn = migrated.pragma("table_info(sync_flows)") as Array<{ name: string }>;
      const mappingTable = migrated
        .prepare("SELECT COUNT(*) AS count FROM sqlite_schema WHERE type = 'table' AND name = ?")
        .get<{ count: number }>("sync_mappings");

      expect(version?.value).toBe("5");
      expect(flowTypeColumn.some((column) => column.name === "flow_type")).toBe(true);
      expect(mappingTable?.count).toBe(1);
    } finally {
      resetAppDbForTests();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reports an unavailable health state when the parent directory is missing", () => {
    const { root } = tempDbPath();
    const missingPath = join(root, "missing", "metadata.sqlite");

    try {
      const health = getAppDbHealth(missingPath);
      expect(health.ready).toBe(false);
      expect(health.writable).toBe(false);
      expect(health.error).toBeTruthy();
    } finally {
      resetAppDbForTests();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
