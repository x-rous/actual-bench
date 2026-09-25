import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { __configureNodeHostForTests, __resetNodeHostForTests } from "@/lib/actual/runtime/nodeHost";
import { getAppDb, resetAppDbForTests } from "@/lib/app-db/connection";
import { connectionFingerprint } from "@/lib/sync/connectionRef";
import { __configureWorkerSupervisorForTests } from "@/lib/workers/supervisor";
import { hostBackedSpawn, type CrossingLog } from "@/lib/workers/testing/fakeWorker";
import { GET as listBudgets } from "@/app/api/sync-credentials/servers/[fingerprint]/budgets/route";
import { __resetEnrolmentsForTests, __waitForEnrolmentsForTests, getEnrolment, startEnrolment } from "./enrolments";
import { getSyncCredential } from "./unattendedCredentials";

/**
 * Enrolling the budgets on a Direct server from its saved password, against a
 * real Actual server (PR-071a): the real Node build, behind the host-backed
 * worker. Skipped unless pointed at one:
 *
 *   ACTUAL_TEST_SERVER_URL, ACTUAL_TEST_SERVER_PASSWORD, ACTUAL_TEST_SERVER_BUDGET
 *   ACTUAL_TEST_SERVER_ENCRYPTED_BUDGET and _ENCRYPTION_PASSWORD (optional)
 *
 * Read-only on the server: it lists and opens budgets, never uploads.
 */

const url = process.env.ACTUAL_TEST_SERVER_URL;
const password = process.env.ACTUAL_TEST_SERVER_PASSWORD;
const budget = process.env.ACTUAL_TEST_SERVER_BUDGET;
const encryptedBudget = process.env.ACTUAL_TEST_SERVER_ENCRYPTED_BUDGET;
const encryptionPassword = process.env.ACTUAL_TEST_SERVER_ENCRYPTION_PASSWORD;

const live = url && password && budget ? describe : describe.skip;

jest.mock("@/lib/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

live("enrolling a Direct server's budgets from its saved password, against a real server", () => {
  jest.setTimeout(300_000);
  let root: string;
  const crossings: CrossingLog = { toWorker: [], toParent: [] };
  const saved = {
    key: process.env.ACTUAL_BENCH_VAULT_KEY,
    db: process.env.ACTUAL_BENCH_DB_PATH,
    executor: process.env.ACTUAL_BENCH_AUTOMATION_EXECUTOR,
  };
  const fingerprintOf = (syncId: string) => connectionFingerprint({ mode: "browser-api", baseUrl: url!, budgetSyncId: syncId });

  async function enrol(syncId: string, secret: Record<string, string>) {
    const id = startEnrolment({
      connectionFingerprint: fingerprintOf(syncId),
      mode: "browser-api",
      baseUrl: url!,
      budgetSyncId: syncId,
      label: syncId,
      secret,
    });
    await __waitForEnrolmentsForTests(300_000);
    return getEnrolment(id);
  }

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "actual-bench-enrol-server-live-"));
    process.env.ACTUAL_BENCH_DB_PATH = join(root, "metadata.sqlite");
    process.env.ACTUAL_BENCH_RUNTIME_DIR = join(root, "runtime");
    process.env.ACTUAL_BENCH_VAULT_KEY = "live-test-operator-key";
    process.env.ACTUAL_BENCH_AUTOMATION_EXECUTOR = "worker";
    __configureWorkerSupervisorForTests({ spawn: hostBackedSpawn(crossings).spawn });
    __configureNodeHostForTests({
      allowMainThread: true,
      // "Uploaded just now": this test never refreshes a snapshot.
      snapshots: { lastSnapshotAt: () => new Date().toISOString(), recordSnapshot: () => {} },
    });
    __resetEnrolmentsForTests();
    getAppDb();
    jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(console, "info").mockImplementation(() => {});
    jest.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterAll(() => {
    __configureWorkerSupervisorForTests();
    __resetNodeHostForTests();
    jest.restoreAllMocks();
    resetAppDbForTests();
    rmSync(root, { recursive: true, force: true });
    delete process.env.ACTUAL_BENCH_RUNTIME_DIR;
    for (const [name, value] of Object.entries({
      ACTUAL_BENCH_VAULT_KEY: saved.key,
      ACTUAL_BENCH_DB_PATH: saved.db,
      ACTUAL_BENCH_AUTOMATION_EXECUTOR: saved.executor,
    })) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it("enrols the first budget with the password, then lists the server's others", async () => {
    expect(await enrol(budget!, { serverPassword: password! })).toMatchObject({ status: "enrolled" });

    const response = await listBudgets(new Request("http://bench.test"), {
      params: Promise.resolve({ fingerprint: fingerprintOf(budget!) }),
    });
    expect(response.status).toBe(200);
    const { budgets } = (await response.json()) as {
      budgets: Array<{ budgetSyncId: string; enrolled: boolean; encrypted: boolean }>;
    };
    expect(budgets.find((entry) => entry.budgetSyncId === budget)).toMatchObject({ enrolled: true });
    expect(budgets.filter((entry) => !entry.enrolled).length).toBeGreaterThan(0);
    if (encryptedBudget) {
      expect(budgets.find((entry) => entry.budgetSyncId === encryptedBudget)).toMatchObject({ encrypted: true });
    }
  });

  it("enrols another budget on the server from the saved password, the browser sending none", async () => {
    const response = await listBudgets(new Request("http://bench.test"), {
      params: Promise.resolve({ fingerprint: fingerprintOf(budget!) }),
    });
    const { budgets } = (await response.json()) as { budgets: Array<{ budgetSyncId: string; enrolled: boolean; encrypted: boolean }> };
    const other = budgets.find((entry) => !entry.enrolled && !entry.encrypted)!;

    expect(await enrol(other.budgetSyncId, {})).toMatchObject({ status: "enrolled" });
    expect(getSyncCredential(getAppDb(), fingerprintOf(other.budgetSyncId))?.secret.serverPassword).toBe(password);
    expect(JSON.stringify(crossings)).not.toContain(password!);
  });

  (encryptedBudget && encryptionPassword ? it : it.skip)(
    "enrols the encrypted budget only with its right encryption password",
    async () => {
      expect(await enrol(encryptedBudget!, { encryptionPassword: "not-it" })).toMatchObject({
        status: "failed",
        code: "ENCRYPTION_KEY_WRONG",
      });
      expect(getSyncCredential(getAppDb(), fingerprintOf(encryptedBudget!))).toBeNull();

      expect(await enrol(encryptedBudget!, { encryptionPassword: encryptionPassword! })).toMatchObject({
        status: "enrolled",
      });
      expect(JSON.stringify(crossings)).not.toContain(encryptionPassword!);
    }
  );
});
