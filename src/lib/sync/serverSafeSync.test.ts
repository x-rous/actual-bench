/**
 * @jest-environment node
 */
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getAppDb, resetAppDbForTests } from "@/lib/app-db/connection";
import { createSyncFlow } from "@/lib/app-db/syncFlowRepository";
import { upsertSyncCredential } from "@/lib/app-db/syncCredentialRepository";
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
  const originalKey = process.env.SYNC_VAULT_KEY;
  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env.SYNC_VAULT_KEY = "test-key";
    ({ root, db } = tempDb());
  });
  afterEach(() => {
    resetAppDbForTests();
    rmSync(root, { recursive: true, force: true });
    if (originalKey === undefined) delete process.env.SYNC_VAULT_KEY;
    else process.env.SYNC_VAULT_KEY = originalKey;
    global.fetch = originalFetch;
  });

  it("is blocked when the vault is disabled", async () => {
    delete process.env.SYNC_VAULT_KEY;
    const flowId = makeFlow(db);
    expect((await runServerSafeSync(db, flowId)).status).toBe("vault_disabled");
  });

  it("reports flow_not_found for an unknown flow", async () => {
    expect((await runServerSafeSync(db, "nope")).status).toBe("flow_not_found");
  });

  it("reports not_enrolled when credentials are missing", async () => {
    const flowId = makeFlow(db);
    enroll(db, "src-fp", "b-src"); // only source enrolled
    expect((await runServerSafeSync(db, flowId)).status).toBe("not_enrolled");
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
