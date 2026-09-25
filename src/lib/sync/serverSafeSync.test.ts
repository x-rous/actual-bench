/**
 * @jest-environment node
 */
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getAppDb, resetAppDbForTests } from "@/lib/app-db/connection";
import { createSyncFlow } from "@/lib/app-db/syncFlowRepository";
import { upsertSyncCredential } from "@/lib/credentials/unattendedCredentials";
import { putSecret } from "@/lib/credentials/store";
import { runServerSafeSync } from "./serverSafeSync";
import type { JsonEnvelope, JsonObject, SqliteDatabase } from "@/lib/app-db/types";

const env = (data: JsonObject): JsonEnvelope => ({ version: 1, data });

function makeFlow(db: SqliteDatabase): string {
  return createSyncFlow(db, {
    name: "Unattended card",
    legs: [
      {
        sourceRef: env({ connectionFingerprint: "src-fp", budgetId: "b-src", accountId: "acct-src", budgetName: "Home", accountName: "Checking" }),
        targetRef: env({ connectionFingerprint: "tgt-fp", budgetId: "b-tgt", accountId: "acct-tgt", budgetName: "Family", accountName: "Joint" }),
        filter: env({}),
        transform: env({}),
        options: env({ reviewPolicy: "auto_sync_on_interval" }),
      },
    ],
  }).id;
}

function enroll(db: SqliteDatabase, fp: string, budget: string) {
  upsertSyncCredential(db, {
    connectionFingerprint: fp, mode: "http-api",
    baseUrl: "https://api.example.com", budgetSyncId: budget, label: fp,
    secret: { apiKey: "key-" + fp },
  });
}

function tempDb(): { root: string; db: SqliteDatabase } {
  const root = mkdtempSync(join(tmpdir(), "actual-bench-server-sync-"));
  return { root, db: getAppDb(join(root, "metadata.sqlite")) };
}

describe("runServerSafeSync (RD-058 / PR-024b)", () => {
  let root: string;
  let db: SqliteDatabase;
  const originalKey = process.env.ACTUAL_BENCH_VAULT_KEY;
  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env.ACTUAL_BENCH_VAULT_KEY = "test-key";
    ({ root, db } = tempDb());
  });
  afterEach(() => {
    resetAppDbForTests();
    rmSync(root, { recursive: true, force: true });
    if (originalKey === undefined) delete process.env.ACTUAL_BENCH_VAULT_KEY;
    else process.env.ACTUAL_BENCH_VAULT_KEY = originalKey;
    global.fetch = originalFetch;
  });

  it("is blocked while the vault is locked", async () => {
    putSecret(db, { domain: "operator" }, { ref: "dest-1", kind: "s3", plaintext: "{}" });
    process.env.ACTUAL_BENCH_VAULT_KEY = "a-different-key";
    const flowId = makeFlow(db);
    const result = await runServerSafeSync(db, flowId);
    expect(result.status).toBe("vault_locked");
    expect("message" in result && result.message).toMatch(/App Health/);
  });

  it("reports flow_not_found for an unknown flow", async () => {
    expect((await runServerSafeSync(db, "nope")).status).toBe("flow_not_found");
  });

  it("reports not_enrolled when credentials are missing", async () => {
    const flowId = makeFlow(db);
    enroll(db, "src-fp", "b-src"); // only source enrolled
    expect((await runServerSafeSync(db, flowId)).status).toBe("not_enrolled");
  });

  it("runs a flow saved on a connection that is not enrolled through another enrolment of the same budget (PR-071c)", async () => {
    const flowId = makeFlow(db);
    // The flow was saved on "src-fp" and "tgt-fp"; the same two budgets are
    // enrolled under other connections - say, through the other mode.
    enroll(db, "src-other-mode", "b-src");
    enroll(db, "tgt-other-mode", "b-tgt");
    global.fetch = jest.fn(async () =>
      new Response(JSON.stringify({ data: [] }), { status: 200, headers: { "content-type": "application/json" } })
    ) as unknown as typeof fetch;

    const result = await runServerSafeSync(db, flowId);

    expect(result.status).toBe("no_safe_items");
    // Both budgets were read, each through its other enrolment.
    const calledUrls = (global.fetch as jest.Mock).mock.calls.map((call) => String(call[0]));
    expect(calledUrls.some((url) => url.includes("/v1/budgets/b-src/"))).toBe(true);
    expect(calledUrls.some((url) => url.includes("/v1/budgets/b-tgt/"))).toBe(true);
  });

  it("runs the safe-only engine server-side with no browser (empty source → no-op)", async () => {
    const flowId = makeFlow(db);
    enroll(db, "src-fp", "b-src");
    enroll(db, "tgt-fp", "b-tgt");
    // Catch-all actual-http-api mock: every list returns empty.
    global.fetch = jest.fn(async () =>
      new Response(JSON.stringify({ data: [] }), { status: 200, headers: { "content-type": "application/json" } })
    ) as unknown as typeof fetch;

    const result = await runServerSafeSync(db, flowId);
    // Reached the engine (past the guards) and found nothing safe to apply.
    expect(result.status).toBe("no_safe_items");
    // The upstream calls forwarded straight to actual-http-api (no /api/proxy).
    const calledUrls = (global.fetch as jest.Mock).mock.calls.map((c) => String(c[0]));
    expect(calledUrls.some((u) => u.startsWith("https://api.example.com/v1/budgets/"))).toBe(true);
    expect(calledUrls.some((u) => u.includes("/api/proxy"))).toBe(false);
  });
});
