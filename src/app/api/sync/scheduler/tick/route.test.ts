/**
 * @jest-environment node
 */
jest.mock("next/server", () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({ status: init?.status ?? 200, json: async () => body }),
  },
}));

import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getAppDb, resetAppDbForTests } from "@/lib/app-db/connection";
import { POST, GET } from "./route";

function req(headers: Record<string, string> = {}): { headers: { get(k: string): string | null } } {
  return { headers: { get: (k: string) => headers[k.toLowerCase()] ?? null } };
}

describe("scheduler tick endpoint (RD-058 / PR-024c)", () => {
  const originalSecret = process.env.SYNC_SCHEDULER_SECRET;
  const originalKey = process.env.SYNC_VAULT_KEY;
  const originalDbPath = process.env.ACTUAL_BENCH_DB_PATH;
  let root: string;
  beforeEach(() => {
    // The GET snapshot reads scheduler state from the shared app DB, which the
    // route resolves from ACTUAL_BENCH_DB_PATH.
    root = mkdtempSync(join(tmpdir(), "actual-bench-tick-route-"));
    process.env.ACTUAL_BENCH_DB_PATH = join(root, "metadata.sqlite");
    getAppDb();
  });
  afterEach(() => {
    resetAppDbForTests();
    rmSync(root, { recursive: true, force: true });
    if (originalDbPath === undefined) delete process.env.ACTUAL_BENCH_DB_PATH;
    else process.env.ACTUAL_BENCH_DB_PATH = originalDbPath;
    for (const [k, v] of [["SYNC_SCHEDULER_SECRET", originalSecret], ["SYNC_VAULT_KEY", originalKey]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("rejects POST when no scheduler secret is configured", async () => {
    delete process.env.SYNC_SCHEDULER_SECRET;
    const res = await POST(req() as never);
    expect(res.status).toBe(403);
  });

  it("rejects POST with a wrong secret", async () => {
    process.env.SYNC_SCHEDULER_SECRET = "s3cret";
    const res = await POST(req({ "x-scheduler-secret": "wrong" }) as never);
    expect(res.status).toBe(403);
  });

  it("GET returns a scheduler state snapshot", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { enabled: boolean; inFlight: string[] };
    expect(typeof body.enabled).toBe("boolean");
    expect(Array.isArray(body.inFlight)).toBe(true);
  });
});
