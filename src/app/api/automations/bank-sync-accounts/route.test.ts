import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { __configureNodeHostForTests, __resetNodeHostForTests } from "@/lib/actual/runtime/nodeHost";
import { getAppDb, resetAppDbForTests } from "@/lib/app-db/connection";
import { upsertSyncCredential } from "@/lib/credentials/unattendedCredentials";
import { __configureWorkerSupervisorForTests } from "@/lib/workers/supervisor";
import { hostBackedSpawn, type CrossingLog } from "@/lib/workers/testing/fakeWorker";
import { GET } from "./route";

jest.mock("@/lib/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

/**
 * The accounts of an enrolled Direct budget (RD-095 M5), read in a worker - the
 * host-backed fake, running the real task host - from the stored credential,
 * against a scripted Actual runtime.
 */

const PASSWORD = "direct-server-password-77aa";

/** An ActualQL builder that records nothing and chains everything. */
function builder(): unknown {
  const chain: Record<string, unknown> = {};
  for (const method of ["filter", "unfilter", "select", "calculate", "groupBy", "orderBy", "limit", "offset", "raw", "withDead", "withoutValidatedRefs", "options"]) {
    chain[method] = () => chain;
  }
  return chain;
}

describe("GET /api/automations/bank-sync-accounts for a Direct connection", () => {
  const saved = {
    key: process.env.ACTUAL_BENCH_VAULT_KEY,
    db: process.env.ACTUAL_BENCH_DB_PATH,
    executor: process.env.ACTUAL_BENCH_AUTOMATION_EXECUTOR,
    runtime: process.env.ACTUAL_BENCH_RUNTIME_DIR,
  };
  let root: string;
  let crossings: CrossingLog;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "actual-bench-bank-accounts-"));
    process.env.ACTUAL_BENCH_DB_PATH = join(root, "metadata.sqlite");
    process.env.ACTUAL_BENCH_RUNTIME_DIR = join(root, "runtime");
    process.env.ACTUAL_BENCH_VAULT_KEY = "test-operator-key";
    upsertSyncCredential(getAppDb(), {
      connectionFingerprint: "fp-direct",
      mode: "browser-api",
      baseUrl: "https://actual.example.test",
      budgetSyncId: "budget-1",
      label: "Envelope",
      secret: { serverPassword: PASSWORD },
    });
    crossings = { toWorker: [], toParent: [] };
    __configureNodeHostForTests({
      allowMainThread: true,
      snapshots: { lastSnapshotAt: () => new Date().toISOString(), recordSnapshot: () => {} },
      loadApi: async () =>
        ({
          init: async () => ({ send: async () => null }),
          downloadBudget: async () => undefined,
          sync: async () => undefined,
          shutdown: async () => undefined,
          q: () => builder(),
          aqlQuery: async () => ({
            data: [
              { id: "a1", name: "Checking", closed: false, account_id: "ext-1", account_sync_source: "simpleFin" },
              { id: "a2", name: "Cash", closed: false, account_id: null },
              { id: "a3", name: "Old card", closed: true, account_id: "ext-3" },
            ],
          }),
        }) as never,
    });
  });

  afterEach(() => {
    __configureWorkerSupervisorForTests();
    __resetNodeHostForTests();
    resetAppDbForTests();
    rmSync(root, { recursive: true, force: true });
    for (const [name, value] of Object.entries({
      ACTUAL_BENCH_VAULT_KEY: saved.key,
      ACTUAL_BENCH_DB_PATH: saved.db,
      ACTUAL_BENCH_AUTOMATION_EXECUTOR: saved.executor,
      ACTUAL_BENCH_RUNTIME_DIR: saved.runtime,
    })) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  const request = () => new Request("http://bench.test/api/automations/bank-sync-accounts?connection=fp-direct");

  it("reads the accounts in a worker from the stored credential, and the password never crosses", async () => {
    process.env.ACTUAL_BENCH_AUTOMATION_EXECUTOR = "worker";
    __configureWorkerSupervisorForTests({ spawn: hostBackedSpawn(crossings).spawn });

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      accounts: [
        { id: "a1", name: "Checking", linked: true, syncSource: "simpleFin", lastSync: null },
        { id: "a2", name: "Cash", linked: false, syncSource: null, lastSync: null },
      ],
    });
    expect(JSON.stringify(crossings)).not.toContain(PASSWORD);
  });

  it("answers a known failure with a fixed message, never the worker's own text", async () => {
    process.env.ACTUAL_BENCH_AUTOMATION_EXECUTOR = "worker";
    __configureWorkerSupervisorForTests({ spawn: hostBackedSpawn(crossings).spawn });
    __configureNodeHostForTests({
      loadApi: async () =>
        ({
          init: async () => {
            throw Object.assign(new Error("Authentication failed: invalid-password at /srv/internal/path"), {
              code: "invalid-password",
            });
          },
        }) as never,
    });

    const response = await GET(request());

    expect(response.status).toBe(502);
    const { error } = (await response.json()) as { error: string };
    expect(error).toBe("The Actual server refused the password. Update it on the connection.");
    expect(error).not.toContain("/srv/internal");
  });

  it("answers an unexpected failure with a generic message", async () => {
    process.env.ACTUAL_BENCH_AUTOMATION_EXECUTOR = "worker";
    __configureWorkerSupervisorForTests({ spawn: hostBackedSpawn(crossings).spawn });
    __configureNodeHostForTests({
      loadApi: async () =>
        ({
          init: async () => {
            throw new Error("ENOSPC: no space left on device, write '/data/actual-runtime/w-1/db.sqlite'");
          },
        }) as never,
    });

    const response = await GET(request());

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "Bench could not read this budget's accounts. Try again." });
  });

  it("says Direct needs worker threads when automations run in-thread", async () => {
    process.env.ACTUAL_BENCH_AUTOMATION_EXECUTOR = "in-thread";

    const response = await GET(request());

    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toMatch(/worker threads/);
  });
});
