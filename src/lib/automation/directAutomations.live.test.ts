import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { __configureNodeHostForTests, __resetNodeHostForTests, closeNodeRuntime } from "@/lib/actual/runtime/nodeHost";
import { openServerTransport, resolveServerConnection } from "@/lib/actual/serverTransport";
import { getAppDb, resetAppDbForTests } from "@/lib/app-db/connection";
import { createBackupDestination, createBackupPolicy, listBackupArtifacts } from "@/lib/app-db/backupRepository";
import { runBackup } from "@/lib/backup/runBackup";
import { upsertSyncCredential } from "@/lib/credentials/unattendedCredentials";

/**
 * Scheduled work on a Direct budget, against a real Actual server (RD-095 M5).
 * Skipped unless pointed at one:
 *
 *   ACTUAL_TEST_SERVER_URL, ACTUAL_TEST_SERVER_PASSWORD, ACTUAL_TEST_SERVER_BUDGET
 *
 * What a scheduled run does, minus the worker thread Jest cannot start: the
 * credential comes from the unattended store, the budget opens through the Node
 * host, and nothing in the browser is involved. Read-only on the server.
 */

const url = process.env.ACTUAL_TEST_SERVER_URL;
const password = process.env.ACTUAL_TEST_SERVER_PASSWORD;
const budget = process.env.ACTUAL_TEST_SERVER_BUDGET;

const live = url && password && budget ? describe : describe.skip;

jest.mock("@/lib/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

live("scheduled work on a Direct budget, against a real server", () => {
  jest.setTimeout(300_000);
  let root: string;
  const saved = { key: process.env.ACTUAL_BENCH_VAULT_KEY, db: process.env.ACTUAL_BENCH_DB_PATH };

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "actual-bench-direct-live-"));
    process.env.ACTUAL_BENCH_DB_PATH = join(root, "metadata.sqlite");
    process.env.ACTUAL_BENCH_RUNTIME_DIR = join(root, "runtime");
    process.env.ACTUAL_BENCH_VAULT_KEY = "live-test-operator-key";
    __configureNodeHostForTests({
      allowMainThread: true,
      // "Uploaded just now": this test never refreshes a snapshot.
      snapshots: { lastSnapshotAt: () => new Date().toISOString(), recordSnapshot: () => {} },
    });
    upsertSyncCredential(getAppDb(), {
      connectionFingerprint: "live-direct",
      mode: "browser-api",
      baseUrl: url!,
      budgetSyncId: budget!,
      label: "Live Direct",
      secret: { serverPassword: password! },
    });
    jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(console, "info").mockImplementation(() => {});
    jest.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterAll(async () => {
    await closeNodeRuntime();
    __resetNodeHostForTests();
    jest.restoreAllMocks();
    resetAppDbForTests();
    rmSync(root, { recursive: true, force: true });
    delete process.env.ACTUAL_BENCH_RUNTIME_DIR;
    for (const [name, value] of Object.entries({ ACTUAL_BENCH_VAULT_KEY: saved.key, ACTUAL_BENCH_DB_PATH: saved.db })) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  function heapMb(): number {
    return Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
  }

  it("backs up the budget from the stored credential, and the copy passes verification", async () => {
    const db = getAppDb();
    const destination = createBackupDestination(db, {
      name: "Local",
      kind: "local",
      config: { version: 1, data: { path: join(root, "volume") } },
    });
    const policy = createBackupPolicy(db, {
      name: "Direct nightly",
      contents: "budget",
      sourceRef: { version: 1, data: { connectionFingerprint: "live-direct" } },
      destinationIds: [destination.id],
      verificationLevel: "data",
    });

    const started = Date.now();
    const result = await runBackup(db, policy);
    await closeNodeRuntime();
    process.stdout.write(`[live] Direct backup: ${Date.now() - started} ms, heap ${heapMb()} MB\n`);

    expect(result).toMatchObject({ stored: true, verified: true });
    const [artifact] = listBackupArtifacts(db);
    expect(artifact).toMatchObject({ kind: "budget", sourceBudgetId: budget, verificationStatus: "passed" });
  });

  it("runs a bank sync and reports honestly when no account is linked to a bank", async () => {
    const connection = resolveServerConnection(getAppDb(), "live-direct")!;
    const transport = openServerTransport(connection);

    const started = Date.now();
    const outcome = await transport.runBankSync!();
    await closeNodeRuntime();
    process.stdout.write(`[live] Direct bank sync: ${Date.now() - started} ms, ${outcome.results.length} accounts\n`);

    // The test server has no bank links: nothing to pull is a result, not a failure.
    expect(outcome.status).toBe("ok");
    expect(outcome.results.length).toBeGreaterThan(0);
    expect(outcome.results.every((entry) => entry.status === "not-linked")).toBe(true);
  });
});
