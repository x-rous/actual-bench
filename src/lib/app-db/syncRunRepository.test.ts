import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getAppDb, resetAppDbForTests } from "./connection";
import { createSyncFlow } from "./syncFlowRepository";
import { createSyncFlowRun, createSyncFlowRunItem, listSyncFlowRunItems } from "./syncRunRepository";
import type { JsonEnvelope, SqliteDatabase } from "./types";

const envelope: JsonEnvelope = { version: 1, data: {} };

function tempDb(): { root: string; db: SqliteDatabase } {
  const root = mkdtempSync(join(tmpdir(), "actual-bench-run-db-"));
  return { root, db: getAppDb(join(root, "metadata.sqlite")) };
}

describe("sync run repository", () => {
  afterEach(() => {
    resetAppDbForTests();
  });

  it("stores run items with preview classification and apply result fields", () => {
    const { root, db } = tempDb();

    try {
      const flow = createSyncFlow(db, {
        name: "Preview flow",
        legs: [{ sourceRef: envelope, targetRef: envelope, filter: envelope, transform: envelope }],
      });
      const run = createSyncFlowRun(db, {
        flowId: flow.id,
        counts: { version: 1, data: { new: 1, blocked: 0 } },
      });

      const item = createSyncFlowRunItem(db, {
        runId: run.id,
        flowId: flow.id,
        legId: flow.legs[0]?.id ?? null,
        sourceEntityType: "transaction",
        sourceItemKey: "transaction:txn-source",
        sourceTransactionId: "txn-source",
        sourceFingerprint: "source-hash",
        plannedAction: "create_transaction",
        plannedTargetPayload: { version: 1, data: { amount: 10000 } },
        classification: "new",
        duplicateConfidence: "none",
        selectedForApply: true,
        applyState: "pending",
        createdTargetMarker: "actual-bench-sync:flow:budget:transaction:txn-source",
      });

      expect(item.classification).toBe("new");
      expect(item.selectedForApply).toBe(true);
      expect(item.plannedTargetPayload?.data.amount).toBe(10000);
      expect(item.createdTargetMarker).toMatch(/^actual-bench-sync:/);

      const listed = listSyncFlowRunItems(db, { runId: run.id });
      expect(listed).toHaveLength(1);
      expect(listed[0]?.sourceItemKey).toBe("transaction:txn-source");
    } finally {
      resetAppDbForTests();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
