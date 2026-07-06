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
import { GET, POST } from "./route";

const sourceRef = { version: 1, data: { connectionRef: "source", budgetSyncId: "budget-a" } };
const targetRef = { version: 1, data: { connectionRef: "target", budgetSyncId: "budget-b" } };
const envelope = { version: 1, data: {} };

function request(body: unknown): Request {
  return {
    json: async () => body,
  } as Request;
}

describe("/api/sync-flows", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "actual-bench-flows-route-"));
    process.env.ACTUAL_BENCH_DB_PATH = join(root, "metadata.sqlite");
  });

  afterEach(() => {
    resetAppDbForTests();
    delete process.env.ACTUAL_BENCH_DB_PATH;
    rmSync(root, { recursive: true, force: true });
  });

  it("creates and lists sync flow definitions", async () => {
    const createResponse = await POST(request({
      name: "One-way mirror",
      legs: [{ sourceRef, targetRef, filter: envelope, transform: envelope }],
    }));
    const created = (await createResponse.json()) as { flow: { id: string; name: string } };

    expect(createResponse.status).toBe(201);
    expect(created.flow.name).toBe("One-way mirror");

    const listResponse = GET();
    const listed = (await listResponse.json()) as { flows: Array<{ id: string; name: string }> };

    expect(listResponse.status).toBe(200);
    expect(listed.flows).toHaveLength(1);
    expect(listed.flows[0]).toMatchObject({ id: created.flow.id, name: "One-way mirror" });
  });

  it("rejects credential fields", async () => {
    const response = await POST(request({
      name: "Unsafe",
      legs: [
        {
          sourceRef: { version: 1, data: { serverPassword: "secret" } },
          targetRef,
          filter: envelope,
          transform: envelope,
        },
      ],
    }));
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(body.error).toMatch(/credential field/i);
  });
});
