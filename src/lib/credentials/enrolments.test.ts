import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { __configureNodeHostForTests, __resetNodeHostForTests } from "@/lib/actual/runtime/nodeHost";
import { resolveServerConnection } from "@/lib/actual/serverTransport";
import { getAppDb, resetAppDbForTests } from "@/lib/app-db/connection";
import { __configureWorkerSupervisorForTests } from "@/lib/workers/supervisor";
import { hostBackedSpawn, type CrossingLog } from "@/lib/workers/testing/fakeWorker";
import { __resetEnrolmentsForTests, __waitForEnrolmentsForTests, getEnrolment, startEnrolment } from "./enrolments";
import { getSyncCredential, upsertSyncCredential } from "./unattendedCredentials";

jest.mock("@/lib/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

/**
 * Enrolling a Direct connection (RD-095 M4): the check runs in a worker - here
 * the host-backed fake, which runs the real task host through the real
 * protocol - against a scripted Actual runtime, and the credential is stored
 * only if the budget opens.
 */

const PASSWORD = "direct-server-password-4f2a";
const E2EE = "budget-e2ee-password-9c1d";

const DIRECT = {
  connectionFingerprint: "fp-direct",
  mode: "browser-api",
  baseUrl: "https://actual.example.test",
  budgetSyncId: "budget-1",
  label: "Envelope",
};

type Script = { initError?: unknown; downloadError?: unknown };

function actualApi(script: Script, uploads: string[]) {
  return {
    init: async () => {
      if (script.initError) throw script.initError;
      return { send: async (name: string) => (name === "upload-budget" ? (uploads.push(name), {}) : null) };
    },
    downloadBudget: async () => {
      if (script.downloadError) throw script.downloadError;
    },
    sync: async () => undefined,
    shutdown: async () => undefined,
  };
}

describe("enrolling a Direct connection", () => {
  const saved = {
    key: process.env.SYNC_VAULT_KEY,
    db: process.env.ACTUAL_BENCH_DB_PATH,
    executor: process.env.ACTUAL_BENCH_AUTOMATION_EXECUTOR,
    runtime: process.env.ACTUAL_BENCH_RUNTIME_DIR,
  };
  let root: string;
  let crossings: CrossingLog;
  let uploads: string[];

  function script(value: Script) {
    __configureNodeHostForTests({
      allowMainThread: true,
      loadApi: async () => actualApi(value, uploads) as never,
      snapshots: { lastSnapshotAt: () => null, recordSnapshot: () => {} },
    });
  }

  async function enrol(secret: Record<string, string>) {
    const id = startEnrolment({ ...DIRECT, secret });
    await __waitForEnrolmentsForTests();
    return getEnrolment(id);
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "actual-bench-enrol-"));
    process.env.ACTUAL_BENCH_DB_PATH = join(root, "metadata.sqlite");
    process.env.ACTUAL_BENCH_RUNTIME_DIR = join(root, "runtime");
    process.env.SYNC_VAULT_KEY = "test-operator-key";
    process.env.ACTUAL_BENCH_AUTOMATION_EXECUTOR = "worker";
    crossings = { toWorker: [], toParent: [] };
    uploads = [];
    __configureWorkerSupervisorForTests({ spawn: hostBackedSpawn(crossings).spawn });
    __resetEnrolmentsForTests();
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

  it("stores the password once the budget opens, and a run can then open it from what was stored", async () => {
    script({});

    expect(await enrol({ serverPassword: PASSWORD, encryptionPassword: E2EE })).toMatchObject({
      status: "enrolled",
      credential: { connectionFingerprint: "fp-direct", mode: "browser-api" },
    });
    expect(resolveServerConnection(getAppDb(), "fp-direct")).toMatchObject({
      mode: "browser-api",
      serverPassword: PASSWORD,
      encryptionPassword: E2EE,
    });
    // A stale snapshot is refreshed while the budget is open, and nothing is left on disk.
    expect(uploads).toEqual(["upload-budget"]);
    expect(readdirSync(join(root, "runtime"))).toEqual([]);
  });

  it("never lets the password or the encryption password cross into the worker in plaintext", async () => {
    script({});
    await enrol({ serverPassword: PASSWORD, encryptionPassword: E2EE });

    const crossed = JSON.stringify(crossings);
    expect(crossings.toWorker.length).toBeGreaterThan(0);
    expect(crossed).not.toContain(PASSWORD);
    expect(crossed).not.toContain(E2EE);
  });

  it.each([
    [
      "a wrong server password",
      { initError: Object.assign(new Error("Authentication failed: invalid-password"), { code: "invalid-password" }) },
      "AUTH_FAILED",
    ],
    [
      "a wrong encryption password",
      {
        downloadError: Object.assign(new Error("Unable to decrypt file with this password. Please try again."), {
          code: "decrypt-failure",
        }),
      },
      "ENCRYPTION_KEY_WRONG",
    ],
    [
      "a missing encryption password",
      {
        downloadError: Object.assign(new Error("File Envelope is encrypted. Please provide a password."), {
          code: "missing-key",
        }),
      },
      "ENCRYPTION_KEY_REQUIRED",
    ],
    [
      "an unknown budget",
      { downloadError: Object.assign(new Error('Budget "budget-1" not found.'), { code: "budget-not-found" }) },
      "BUDGET_NOT_FOUND",
    ],
  ])("stores nothing for %s, and leaves the server's working password alone", async (_case, value, code) => {
    // Another budget on the same server is already enrolled with the right password.
    upsertSyncCredential(getAppDb(), {
      ...DIRECT,
      connectionFingerprint: "fp-other",
      budgetSyncId: "budget-2",
      secret: { serverPassword: "the-working-password" },
    });
    script(value);

    expect(await enrol({ serverPassword: "a-mistyped-password" })).toMatchObject({ status: "failed", code });
    expect(getSyncCredential(getAppDb(), "fp-direct")).toBeNull();
    expect(getSyncCredential(getAppDb(), "fp-other")?.secret.serverPassword).toBe("the-working-password");
  });

  it("enrols another budget on the server with the saved password, which never crosses in plaintext", async () => {
    upsertSyncCredential(getAppDb(), {
      ...DIRECT,
      connectionFingerprint: "fp-first",
      budgetSyncId: "budget-0",
      secret: { serverPassword: PASSWORD },
    });
    script({});

    expect(await enrol({})).toMatchObject({ status: "enrolled" });
    expect(getSyncCredential(getAppDb(), "fp-direct")?.secret).toEqual({ serverPassword: PASSWORD });
    expect(JSON.stringify(crossings)).not.toContain(PASSWORD);
  });

  it("refuses at once when nothing is saved for the server and no password was sent", () => {
    script({});
    expect(() => startEnrolment({ ...DIRECT, secret: {} })).toThrow(/No budget on this server is enrolled yet/);
  });

  it("keeps a password an upstream error echoes back out of the answer", async () => {
    script({ initError: new Error(`unexpected reply for a-mistyped-password`) });

    const enrolment = await enrol({ serverPassword: "a-mistyped-password" });

    expect(enrolment).toMatchObject({ status: "failed", code: null });
    expect(JSON.stringify(enrolment)).not.toContain("a-mistyped-password");
  });
});
