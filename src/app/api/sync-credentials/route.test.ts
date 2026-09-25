import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getAppDb, resetAppDbForTests } from "@/lib/app-db/connection";
import { __resetEnrolmentsForTests, __waitForEnrolmentsForTests } from "@/lib/credentials/enrolments";
import { getSyncCredential, upsertSyncCredential } from "@/lib/credentials/unattendedCredentials";
import { __configureWorkerSupervisorForTests } from "@/lib/workers/supervisor";
import { connectionFingerprint } from "@/lib/sync/connectionRef";
import { scriptedSpawn } from "@/lib/workers/testing/fakeWorker";
import { GET as getEnrolment } from "./enrolments/[id]/route";
import { POST } from "./route";

/**
 * Enrolment through the route (RD-095 M4): checked against the server, stored
 * only if the check passes. HTTP checks run in-thread here, as Jest runs jobs
 * (`jest.env.cjs`); the Direct worker path is covered in `enrolments.test.ts`.
 */

/** The fingerprint the route expects: the one the connection's own details give. */
const fp = (budgetSyncId: string) =>
  connectionFingerprint({ mode: "http-api", baseUrl: "https://api.example.test", budgetSyncId });

/** The same budget, reached Direct. */
const DIRECT_FP = connectionFingerprint({ mode: "browser-api", baseUrl: "https://api.example.test", budgetSyncId: "budget-1" });

const HTTP = {
  connectionFingerprint: fp("budget-1"),
  mode: "http-api",
  baseUrl: "https://api.example.test",
  budgetSyncId: "budget-1",
  label: "Household",
};

function post(body: unknown): Promise<Response> {
  return POST(
    new Request("http://bench.test/api/sync-credentials", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  );
}

async function enrolmentOf(response: Response) {
  const { enrolmentId } = (await response.json()) as { enrolmentId: string };
  await __waitForEnrolmentsForTests();
  const status = await getEnrolment(new Request("http://bench.test"), { params: Promise.resolve({ id: enrolmentId }) });
  return (await status.json()) as { status: string; code?: string | null; message?: string };
}

describe("POST /api/sync-credentials", () => {
  const saved = { key: process.env.ACTUAL_BENCH_VAULT_KEY, db: process.env.ACTUAL_BENCH_DB_PATH, fetch: global.fetch };
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "actual-bench-enrol-route-"));
    process.env.ACTUAL_BENCH_DB_PATH = join(root, "metadata.sqlite");
    process.env.ACTUAL_BENCH_VAULT_KEY = "test-operator-key";
    __resetEnrolmentsForTests();
  });
  afterEach(() => {
    global.fetch = saved.fetch;
    resetAppDbForTests();
    rmSync(root, { recursive: true, force: true });
    for (const [name, value] of [
      ["ACTUAL_BENCH_VAULT_KEY", saved.key],
      ["ACTUAL_BENCH_DB_PATH", saved.db],
    ] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  function answerAccounts(status: number, body: unknown = { data: [] }) {
    global.fetch = jest.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
  }

  it("refuses while the vault is locked", async () => {
    upsertSyncCredential(getAppDb(), { ...HTTP, secret: { apiKey: "working-key" } });
    process.env.ACTUAL_BENCH_VAULT_KEY = "a-different-key";
    expect((await post({ ...HTTP, secret: { apiKey: "key" } })).status).toBe(409);
  });

  it.each([
    [{ ...HTTP, secret: { serverPassword: "pw" } }, /No budget on this server is enrolled yet/],
    [
      { ...HTTP, mode: "browser-api", connectionFingerprint: DIRECT_FP, secret: { apiKey: "key" } },
      /No budget on this server is enrolled yet/,
    ],
    [{ ...HTTP, mode: "carrier-pigeon", secret: { apiKey: "key" } }, /Unknown connection mode/],
  ])("refuses an enrolment with no secret for its mode and none saved for its server (%#)", async (body, message) => {
    const response = await post(body);
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toMatch(message);
  });

  it("refuses a Direct enrolment at once when automations run in-thread", async () => {
    const response = await post({ ...HTTP, mode: "browser-api", connectionFingerprint: DIRECT_FP, secret: { serverPassword: "pw" } });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "NEEDS_WORKERS" });
  });

  it("checks an HTTP key with the server, then stores it", async () => {
    answerAccounts(200);
    const response = await post({ ...HTTP, secret: { apiKey: "good-key" } });
    expect(response.status).toBe(202);

    expect(await enrolmentOf(response)).toMatchObject({ status: "enrolled" });
    expect(getSyncCredential(getAppDb(), fp("budget-1"))?.secret.apiKey).toBe("good-key");
    // The check went to the server with the key being enrolled.
    const [, init] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
    expect(new Headers(init.headers).get("x-api-key")).toBe("good-key");
  });

  it.each([
    [401, "AUTH_FAILED"],
    [403, "AUTH_FAILED"],
    [404, "BUDGET_NOT_FOUND"],
  ])("stores nothing when the server answers %i, and keeps the key it already had", async (status, code) => {
    upsertSyncCredential(getAppDb(), { ...HTTP, secret: { apiKey: "working-key" } });
    answerAccounts(status, { error: "nope" });

    const enrolment = await enrolmentOf(await post({ ...HTTP, secret: { apiKey: "mistyped-key" } }));

    expect(enrolment).toMatchObject({ status: "failed", code });
    expect(getSyncCredential(getAppDb(), fp("budget-1"))?.secret.apiKey).toBe("working-key");
  });

  it("enrols another budget on an enrolled server with the saved key, the browser sending none", async () => {
    upsertSyncCredential(getAppDb(), { ...HTTP, secret: { apiKey: "saved-key" } });
    answerAccounts(200);

    const enrolment = await enrolmentOf(
      await post({ ...HTTP, connectionFingerprint: fp("budget-2"), budgetSyncId: "budget-2", label: "Joint", secret: {} })
    );

    expect(enrolment).toMatchObject({ status: "enrolled" });
    const [, init] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
    expect(new Headers(init.headers).get("x-api-key")).toBe("saved-key");
    expect(getSyncCredential(getAppDb(), fp("budget-2"))).toMatchObject({
      budgetSyncId: "budget-2",
      secret: { apiKey: "saved-key" },
    });
  });

  it("passes the encryption password typed for a budget, with the saved key", async () => {
    upsertSyncCredential(getAppDb(), { ...HTTP, secret: { apiKey: "saved-key" } });
    answerAccounts(200);

    await enrolmentOf(
      await post({ ...HTTP, connectionFingerprint: fp("budget-3"), budgetSyncId: "budget-3", secret: { encryptionPassword: "e2ee" } })
    );

    const [, init] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
    expect(new Headers(init.headers).get("budget-encryption-password")).toBe("e2ee");
    expect(getSyncCredential(getAppDb(), fp("budget-3"))?.secret).toEqual({ apiKey: "saved-key", encryptionPassword: "e2ee" });
  });

  it("refuses a fingerprint that is not the connection's own, and stores nothing", async () => {
    // Another budget's fingerprint, sent with no secret so the server's saved
    // key would be used: it must not overwrite that budget's enrolment.
    upsertSyncCredential(getAppDb(), { ...HTTP, secret: { apiKey: "saved-key" } });
    const response = await post({
      ...HTTP,
      connectionFingerprint: fp("budget-1"),
      baseUrl: "https://elsewhere.example.test",
      secret: {},
    });

    expect(response.status).toBe(400);
    expect(getSyncCredential(getAppDb(), fp("budget-1"))).toMatchObject({ baseUrl: "https://api.example.test" });
  });

  it("reports an unreachable server as such", async () => {
    global.fetch = jest.fn(async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;

    const enrolment = await enrolmentOf(await post({ ...HTTP, secret: { apiKey: "key" } }));

    expect(enrolment).toMatchObject({ status: "failed", code: "SERVER_UNREACHABLE" });
    expect(getSyncCredential(getAppDb(), fp("budget-1"))).toBeNull();
  });

  it("says Bench is busy, at once, when no worker slot is free", async () => {
    process.env.ACTUAL_BENCH_AUTOMATION_EXECUTOR = "worker";
    try {
      __configureWorkerSupervisorForTests({ maxSlots: 0, spawn: scriptedSpawn(() => {}).spawn });
      const response = await post({ ...HTTP, secret: { apiKey: "key" } });
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ code: "BUSY", error: expect.stringMatching(/busy/) });
    } finally {
      process.env.ACTUAL_BENCH_AUTOMATION_EXECUTOR = "in-thread";
      __configureWorkerSupervisorForTests();
    }
  });

  it("answers 404 for an enrolment it does not know", async () => {
    const response = await getEnrolment(new Request("http://bench.test"), { params: Promise.resolve({ id: "nope" }) });
    expect(response.status).toBe(404);
  });
});
