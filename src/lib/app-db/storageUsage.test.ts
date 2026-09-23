import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getAppDb, resetAppDbForTests } from "./connection";
import { createSyncFlow } from "./syncFlowRepository";
import { createSyncFlowRun, createSyncFlowRunItem } from "./syncRunRepository";
import { getAppDbStorageUsage } from "./storageUsage";
import type { JsonEnvelope } from "./types";

const envelope: JsonEnvelope = { version: 1, data: {} };

describe("app db storage usage", () => {
  let root: string;
  let path: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "actual-bench-storage-usage-"));
    path = join(root, "metadata.sqlite");
  });

  afterEach(() => {
    resetAppDbForTests();
    rmSync(root, { recursive: true, force: true });
  });

  it("reports a real size and names the table holding the rows", () => {
    const db = getAppDb(path);
    const flow = createSyncFlow(db, {
      name: "Card sync",
      legs: [{ sourceRef: envelope, targetRef: envelope, filter: envelope, transform: envelope }],
    });
    const run = createSyncFlowRun(db, { flowId: flow.id });
    for (let i = 0; i < 30; i += 1) {
      createSyncFlowRunItem(db, { runId: run.id, flowId: flow.id, sourceItemRef: envelope });
    }

    const usage = getAppDbStorageUsage(path);

    expect(usage.fileBytes).toBeGreaterThan(0);
    expect(usage.totalBytes).toBe(usage.fileBytes + usage.walBytes);
    expect(usage.pageSize).toBeGreaterThan(0);

    // Largest first, so the answer to "why is this big" is the first row -
    // here the run items, which are the only thing that grows per tick.
    expect(usage.tables[0]?.name).toBe("sync_flow_run_items");
    expect(usage.tables[0]?.rows).toBe(30);

    // Every table is listed, including the empty ones, so a table that should
    // have rows and does not is visible too.
    expect(usage.tables.find((table) => table.name === "sync_flows")?.rows).toBe(1);
    expect(usage.tables.some((table) => table.rows === 0)).toBe(true);
    // Never SQLite's own bookkeeping tables.
    expect(usage.tables.some((table) => table.name.startsWith("sqlite_"))).toBe(false);
  });

  it("reports space freed by deleted rows, which is why a file stays large", () => {
    const db = getAppDb(path);
    const flow = createSyncFlow(db, {
      name: "Card sync",
      legs: [{ sourceRef: envelope, targetRef: envelope, filter: envelope, transform: envelope }],
    });
    const run = createSyncFlowRun(db, { flowId: flow.id });
    for (let i = 0; i < 400; i += 1) {
      createSyncFlowRunItem(db, { runId: run.id, flowId: flow.id, sourceItemRef: envelope });
    }
    db.exec("DELETE FROM sync_flow_run_items");

    const usage = getAppDbStorageUsage(path);

    // The rows are gone but the pages they used are still in the file, which is
    // exactly the thing that makes a purge look like it did nothing.
    expect(usage.tables.find((table) => table.name === "sync_flow_run_items")?.rows).toBe(0);
    expect(usage.freePages).toBeGreaterThan(0);
    expect(usage.freeBytes).toBe(usage.freePages * usage.pageSize);
  });
});
