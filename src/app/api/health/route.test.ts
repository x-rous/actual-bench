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
import { resetAppDbForTests } from "@/lib/app-db/connection";
import { GET } from "./route";

describe("GET /api/health", () => {
  let root: string;

  afterEach(() => {
    resetAppDbForTests();
    delete process.env.ACTUAL_BENCH_DB_PATH;
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it("returns 200 and a minimal body when the database is ready", async () => {
    root = mkdtempSync(join(tmpdir(), "actual-bench-health-route-"));
    process.env.ACTUAL_BENCH_DB_PATH = join(root, "metadata.sqlite");

    const response = GET();
    const body = (await response.json()) as { status: string };

    expect(response.status).toBe(200);
    expect(body).toEqual({ status: "ok" });
  });

  it("returns 503 without leaking the configured path when storage is unavailable", async () => {
    root = mkdtempSync(join(tmpdir(), "actual-bench-health-route-"));
    process.env.ACTUAL_BENCH_DB_PATH = join(root, "missing", "metadata.sqlite");

    const response = GET();
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(503);
    expect(body).toEqual({ status: "unavailable" });
    expect(JSON.stringify(body)).not.toContain(root);
  });
});
