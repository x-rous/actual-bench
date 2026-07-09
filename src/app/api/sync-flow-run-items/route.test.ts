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
import { createSyncFlow } from "@/lib/app-db/syncFlowRepository";
import { createSyncFlowRun, createSyncFlowRunItem, listSyncFlowRunItems } from "@/lib/app-db/syncRunRepository";
import { PATCH } from "./route";

const envelope = { version: 1, data: {} };

function request(body: unknown): Request {
  return { json: async () => body } as Request;
}

describe("/api/sync-flow-run-items batch PATCH", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "actual-bench-run-items-route-"));
    process.env.ACTUAL_BENCH_DB_PATH = join(root, "metadata.sqlite");
  });

  afterEach(() => {
    resetAppDbForTests();
    delete process.env.ACTUAL_BENCH_DB_PATH;
    rmSync(root, { recursive: true, force: true });
  });

  it("updates several run item statuses in one transaction", async () => {
    const db = getAppDb();
    const flowId = createSyncFlow(db, {
      name: "Card sync",
      legs: [{ sourceRef: envelope, targetRef: envelope, filter: envelope, transform: envelope }],
    }).id;
    const run = createSyncFlowRun(db, { flowId, status: "applying" });
    const a = createSyncFlowRunItem(db, { runId: run.id, status: "planned", sourceItemRef: envelope, applyState: "pending" });
    const b = createSyncFlowRunItem(db, { runId: run.id, status: "planned", sourceItemRef: envelope, applyState: "pending" });

    const response = await PATCH(request({
      items: [
        { itemId: a.id, patch: { status: "applied", applyState: "applied" } },
        { itemId: b.id, patch: { status: "failed", applyState: "failed" } },
      ],
    }));
    const body = (await response.json()) as { updated: number };
    expect(body.updated).toBe(2);

    const items = listSyncFlowRunItems(db, { runId: run.id });
    expect(items.find((i) => i.id === a.id)?.applyState).toBe("applied");
    expect(items.find((i) => i.id === b.id)?.applyState).toBe("failed");
  });

  it("returns 0 updated for an empty batch", async () => {
    const response = await PATCH(request({ items: [] }));
    const body = (await response.json()) as { updated: number };
    expect(body.updated).toBe(0);
  });

  it("rejects a malformed item with a 400 before touching the database", async () => {
    const bad = await PATCH(request({ items: [{ itemId: "x" }] }));
    expect(bad.status).toBe(400);
    const nullEntry = await PATCH(request({ items: [null] }));
    expect(nullEntry.status).toBe(400);
  });
});
