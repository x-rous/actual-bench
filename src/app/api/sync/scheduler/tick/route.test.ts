jest.mock("next/server", () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      json: async () => body,
    }),
  },
}));

import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getAppDb, resetAppDbForTests } from "@/lib/app-db/connection";
import { createAutomation } from "@/lib/app-db/automationRepository";
import { POST } from "./route";
import type { NextRequest } from "next/server";

/**
 * The endpoint external crons already point at. Its URL and response shape are
 * a contract, so the engine replacing the sync-specific scheduler underneath it
 * must not change what a caller reads.
 */

const SECRET = "test-scheduler-secret";
const VAULT_KEY = "0".repeat(64);

function request(secret = SECRET): NextRequest {
  return { headers: { get: () => secret } } as unknown as NextRequest;
}

describe("POST /api/sync/scheduler/tick", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "actual-bench-tick-route-"));
    process.env.ACTUAL_BENCH_DB_PATH = join(root, "metadata.sqlite");
    process.env.SYNC_SCHEDULER_SECRET = SECRET;
    process.env.SYNC_VAULT_KEY = VAULT_KEY;
  });

  afterEach(() => {
    resetAppDbForTests();
    delete process.env.ACTUAL_BENCH_DB_PATH;
    delete process.env.SYNC_SCHEDULER_SECRET;
    delete process.env.SYNC_VAULT_KEY;
    rmSync(root, { recursive: true, force: true });
  });

  it("still reports the sync flow id, not the automation id, in `flowId`", async () => {
    const db = getAppDb();
    createAutomation(db, {
      type: "budget-file-sync",
      name: "Nightly sync",
      scheduleKind: "interval",
      intervalMinutes: 30,
      targetRef: { version: 1, data: { flowId: "flow-abc" } },
      config: { version: 1, data: { flowId: "flow-abc" } },
    });

    const response = await POST(request());
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      ran: { flowId: string | null; automationId: string; type: string | null; status: string }[];
    };

    expect(body.ran).toHaveLength(1);
    // The identifier an existing cron consumer parses is unchanged...
    expect(body.ran[0].flowId).toBe("flow-abc");
    // ...and the automation id is additional, not a substitute.
    expect(body.ran[0].automationId).not.toBe("flow-abc");
    expect(body.ran[0].type).toBe("budget-file-sync");
  });

  it("refuses a wrong secret", async () => {
    const response = await POST(request("nope"));
    expect(response.status).toBe(403);
  });

  it("is disabled when no secret is configured", async () => {
    delete process.env.SYNC_SCHEDULER_SECRET;
    const response = await POST(request());
    expect(response.status).toBe(403);
  });
});
