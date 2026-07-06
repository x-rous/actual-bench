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

  it("initializes migrations idempotently and reports health", () => {
    const { root, dbPath } = tempDbPath();

    try {
      const db = getAppDb(dbPath);
      const version = db
        .prepare("SELECT value FROM app_meta WHERE key = ?")
        .get<{ value: string }>("schema_version");
      expect(version?.value).toBe("1");

      const sameDb = getAppDb(dbPath);
      expect(sameDb).toBe(db);

      const health = getAppDbHealth(dbPath);
      expect(health.ready).toBe(true);
      expect(health.writable).toBe(true);
      expect(health.schemaVersion).toBe(1);
      expect(health.configuredPath).toBe(dbPath);
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
