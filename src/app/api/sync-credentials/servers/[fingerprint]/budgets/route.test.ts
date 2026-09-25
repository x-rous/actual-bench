import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { __configureNodeHostForTests, __resetNodeHostForTests } from "@/lib/actual/runtime/nodeHost";
import { getAppDb, resetAppDbForTests } from "@/lib/app-db/connection";
import { upsertSyncCredential } from "@/lib/credentials/unattendedCredentials";
import { connectionFingerprint } from "@/lib/sync/connectionRef";
import { __configureWorkerSupervisorForTests } from "@/lib/workers/supervisor";
import { hostBackedSpawn, type CrossingLog } from "@/lib/workers/testing/fakeWorker";
import { GET } from "./route";

jest.mock("@/lib/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

/**
 * The budgets on an enrolled Direct server (PR-071a), listed in a worker - the
 * host-backed fake, running the real task host - from the saved password.
 */

const PASSWORD = "direct-server-password-5c3e";
const SERVER = { mode: "browser-api" as const, baseUrl: "https://actual.example.test" };
const fingerprintOf = (budgetSyncId: string) => connectionFingerprint({ ...SERVER, budgetSyncId });

describe("GET /api/sync-credentials/servers/[fingerprint]/budgets", () => {
  const saved = {
    key: process.env.SYNC_VAULT_KEY,
    db: process.env.ACTUAL_BENCH_DB_PATH,
    executor: process.env.ACTUAL_BENCH_AUTOMATION_EXECUTOR,
    runtime: process.env.ACTUAL_BENCH_RUNTIME_DIR,
  };
  let root: string;
  let crossings: CrossingLog;
  let downloads: number;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "actual-bench-server-budgets-"));
    process.env.ACTUAL_BENCH_DB_PATH = join(root, "metadata.sqlite");
    process.env.ACTUAL_BENCH_RUNTIME_DIR = join(root, "runtime");
    process.env.SYNC_VAULT_KEY = "test-operator-key";
    process.env.ACTUAL_BENCH_AUTOMATION_EXECUTOR = "worker";
    upsertSyncCredential(getAppDb(), {
      connectionFingerprint: fingerprintOf("b-envelope"),
      ...SERVER,
      budgetSyncId: "b-envelope",
      label: "Envelope",
      secret: { serverPassword: PASSWORD },
    });
    crossings = { toWorker: [], toParent: [] };
    downloads = 0;
    __configureWorkerSupervisorForTests({ spawn: hostBackedSpawn(crossings).spawn });
    __configureNodeHostForTests({
      allowMainThread: true,
      loadApi: async () =>
        ({
          init: async () => ({ send: async () => null }),
          getBudgets: async () => [
            { state: "remote", groupId: "b-tracking", name: "Tracking" },
            { state: "remote", groupId: "b-envelope", name: "Envelope" },
            { state: "remote", groupId: "b-secret", name: "Secret", encryptKeyId: "key-1" },
            { state: "remote", groupId: "b-secret", name: "Secret (duplicate)" },
            { state: "local", id: "local-only", name: "Local copy" },
          ],
          downloadBudget: async () => void (downloads += 1),
          sync: async () => undefined,
          shutdown: async () => undefined,
        }) as never,
    });
  });

  afterEach(() => {
    __configureWorkerSupervisorForTests();
    __resetNodeHostForTests();
    resetAppDbForTests();
    rmSync(root, { recursive: true, force: true });
    for (const [name, value] of Object.entries({
      SYNC_VAULT_KEY: saved.key,
      ACTUAL_BENCH_DB_PATH: saved.db,
      ACTUAL_BENCH_AUTOMATION_EXECUTOR: saved.executor,
      ACTUAL_BENCH_RUNTIME_DIR: saved.runtime,
    })) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  const get = (fingerprint: string) =>
    GET(new Request("http://bench.test"), { params: Promise.resolve({ fingerprint }) });

  it("lists the server's budgets, which are enrolled and which are encrypted, without opening any", async () => {
    const response = await get(fingerprintOf("b-envelope"));

    expect(response.status).toBe(200);
    const body = (await response.json()) as { budgets: Array<Record<string, unknown>> };
    expect(body.budgets).toEqual([
      { budgetSyncId: "b-envelope", name: "Envelope", encrypted: false, enrolled: true, connectionFingerprint: fingerprintOf("b-envelope") },
      { budgetSyncId: "b-secret", name: "Secret", encrypted: true, enrolled: false, connectionFingerprint: fingerprintOf("b-secret") },
      { budgetSyncId: "b-tracking", name: "Tracking", encrypted: false, enrolled: false, connectionFingerprint: fingerprintOf("b-tracking") },
    ]);
    expect(downloads).toBe(0);
    expect(JSON.stringify(crossings)).not.toContain(PASSWORD);
    expect(JSON.stringify(body)).not.toContain(PASSWORD);
  });

  it("answers 404 for a connection that is not enrolled", async () => {
    expect((await get("nope")).status).toBe(404);
  });
});
