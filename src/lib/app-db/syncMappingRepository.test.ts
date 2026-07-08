import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getAppDb, resetAppDbForTests } from "./connection";
import { createSyncFlow } from "./syncFlowRepository";
import { createSyncFlowRun } from "./syncRunRepository";
import {
  createSyncMapping,
  getSyncMappingBySource,
  listSyncMappings,
  updateSyncMapping,
} from "./syncMappingRepository";
import type { JsonEnvelope, SqliteDatabase, SyncMappingInput } from "./types";

const envelope: JsonEnvelope = { version: 1, data: {} };

function tempDb(): { root: string; db: SqliteDatabase } {
  const root = mkdtempSync(join(tmpdir(), "actual-bench-mapping-db-"));
  return { root, db: getAppDb(join(root, "metadata.sqlite")) };
}

function createFlow(db: SqliteDatabase): string {
  return createSyncFlow(db, {
    name: "Household card",
    legs: [
      {
        sourceRef: { version: 1, data: { connectionFingerprint: "source-fp", budgetSyncId: "budget-a" } },
        targetRef: { version: 1, data: { connectionFingerprint: "target-fp", budgetSyncId: "budget-b" } },
        filter: envelope,
        transform: envelope,
      },
    ],
  }).id;
}

function mappingInput(flowId: string, runId: string): SyncMappingInput {
  return {
    flowId,
    sourceConnectionFingerprint: "source-fp",
    sourceBudgetId: "budget-a",
    sourceAccountId: "account-a",
    sourceEntityType: "split_line",
    sourceTransactionId: "txn-source",
    sourceSplitId: "split-2",
    sourceItemKey: "split:txn-source:split-2",
    sourceFingerprint: "source-hash",
    targetConnectionFingerprint: "target-fp",
    targetBudgetId: "budget-b",
    targetAccountId: "account-b",
    targetEntityType: "transaction",
    targetTransactionId: "txn-target",
    targetItemKey: "txn:txn-target",
    targetFingerprint: "target-hash",
    targetMarker: "actual-bench-sync:flow:budget-a:split:txn-source:split-2",
    createdRunId: runId,
  };
}

describe("sync mapping repository", () => {
  afterEach(() => {
    resetAppDbForTests();
  });

  it("creates, finds, lists, and updates idempotency mappings", () => {
    const { root, db } = tempDb();

    try {
      const flowId = createFlow(db);
      const run = createSyncFlowRun(db, { flowId });
      const created = createSyncMapping(db, mappingInput(flowId, run.id));

      expect(created.sourceEntityType).toBe("split_line");
      expect(created.sourceItemKey).toBe("split:txn-source:split-2");
      expect(created.targetMarker).toMatch(/^actual-bench-sync:/);
      expect(created.status).toBe("active");

      const bySource = getSyncMappingBySource(db, flowId, "split:txn-source:split-2");
      expect(bySource?.id).toBe(created.id);

      const listed = listSyncMappings(db, { flowId });
      expect(listed).toHaveLength(1);

      const updated = updateSyncMapping(db, created.id, {
        status: "source_missing",
        lastSeenAt: "2026-07-06T00:00:00.000Z",
      });

      expect(updated?.status).toBe("source_missing");
      expect(updated?.lastSeenAt).toBe("2026-07-06T00:00:00.000Z");
    } finally {
      resetAppDbForTests();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("enforces one mapping per flow and source item key", () => {
    const { root, db } = tempDb();

    try {
      const flowId = createFlow(db);
      const run = createSyncFlowRun(db, { flowId });
      const input = mappingInput(flowId, run.id);

      createSyncMapping(db, input);
      expect(() => createSyncMapping(db, input)).toThrow();
    } finally {
      resetAppDbForTests();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
