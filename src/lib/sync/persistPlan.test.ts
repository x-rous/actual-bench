import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getAppDb, resetAppDbForTests } from "@/lib/app-db/connection";
import { createSyncFlow } from "@/lib/app-db/syncFlowRepository";
import { getSyncFlowRun, listSyncFlowRunItems } from "@/lib/app-db/syncRunRepository";
import type { SqliteDatabase } from "@/lib/app-db/types";
import { getBudgetFileSyncCapabilities } from "./capabilities";
import { buildPlanConfig } from "./flowConfig";
import { generateSyncMarker } from "./marker";
import { persistDraftPreviewRun } from "./persistPlan";
import { planSyncFlow } from "./syncPlanner";
import type { SyncSourceTransaction } from "@/lib/actual/transport";

function tempDb(): { root: string; db: SqliteDatabase } {
  const root = mkdtempSync(join(tmpdir(), "actual-bench-plan-db-"));
  return { root, db: getAppDb(join(root, "metadata.sqlite")) };
}

function createFlow(db: SqliteDatabase): string {
  return createSyncFlow(db, {
    name: "Cross-budget card",
    legs: [
      {
        sourceRef: { version: 1, data: { connectionFingerprint: "src-fp", budgetSyncId: "budget-a" } },
        targetRef: { version: 1, data: { connectionFingerprint: "tgt-fp", budgetSyncId: "budget-b" } },
        filter: { version: 1, data: {} },
        transform: { version: 1, data: {} },
      },
    ],
  }).id;
}

const source: SyncSourceTransaction = {
  id: "t1",
  accountId: "acct-src",
  date: "2026-07-01",
  amount: -1250,
  payeeId: "sp1",
  payeeName: "Coffee Bar",
  categoryId: "sc1",
  categoryName: "Dining",
  notes: "flat white",
  cleared: true,
  reconciled: false,
  importedId: null,
  isParent: false,
  isChild: false,
  parentId: null,
  splitLines: [],
};

describe("persistDraftPreviewRun", () => {
  afterEach(() => resetAppDbForTests());

  it("persists a draft_preview run and inspectable planned items", () => {
    const { root, db } = tempDb();
    try {
      const flowId = createFlow(db);
      const plan = planSyncFlow({
        config: buildPlanConfig({ flowId, sourceBudgetId: "budget-src", targetBudgetId: "budget-tgt", targetAccountId: "acct-tgt", sourceBudgetName: "Home", sourceAccountName: "Checking" }),
        capabilities: getBudgetFileSyncCapabilities({ mode: "browser-api" }),
        sourceTransactions: [source],
        target: { payees: [], categories: [], importedIdIndex: new Map(), transactions: [] },
        existingMappings: [],
      });

      const { run, items } = persistDraftPreviewRun(db, plan);

      // Run persisted in draft_preview with counts.
      const reloaded = getSyncFlowRun(db, run.id);
      expect(reloaded?.status).toBe("draft_preview");
      expect(reloaded?.flowId).toBe(flowId);
      expect(reloaded?.counts?.data).toMatchObject({ new: 1 });
      expect(reloaded?.summary.data).toMatchObject({ totalItems: 1 });

      // Item persisted with classification, action, payload, marker, flags.
      expect(items).toHaveLength(1);
      const stored = listSyncFlowRunItems(db, { runId: run.id });
      expect(stored).toHaveLength(1);
      const item = stored[0];
      expect(item.classification).toBe("new");
      expect(item.plannedAction).toBe("create");
      expect(item.sourceItemKey).toBe("txn:t1");
      expect(item.sourceEntityType).toBe("transaction");
      expect(item.selectedForApply).toBe(true);
      expect(item.applyState).toBe("pending");
      expect(item.createdTargetMarker).toBe(
        generateSyncMarker({ sourceBudgetId: "budget-src", targetBudgetId: "budget-tgt", targetAccountId: "acct-tgt", sourceItemKey: "txn:t1" })
      );
      expect(item.plannedTargetPayload?.data).toMatchObject({ amount: 1250 });
      expect((item.warnings?.data as { flags: string[] }).flags).toContain("target_rules_may_modify");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("persists one item per exploded split line", () => {
    const { root, db } = tempDb();
    try {
      const flowId = createFlow(db);
      const parent: SyncSourceTransaction = {
        ...source,
        id: "p",
        isParent: true,
        splitLines: [
          { id: "s1", amount: -1000, payeeId: null, payeeName: null, categoryId: "sc-a", categoryName: "Groceries", notes: null },
          { id: "s2", amount: -2000, payeeId: null, payeeName: null, categoryId: "sc-b", categoryName: "Household", notes: null },
        ],
      };
      const plan = planSyncFlow({
        config: buildPlanConfig({ flowId, sourceBudgetId: "budget-src", targetBudgetId: "budget-tgt", targetAccountId: "acct-tgt", sourceBudgetName: "Home", sourceAccountName: "Checking" }),
        capabilities: getBudgetFileSyncCapabilities({ mode: "browser-api" }),
        sourceTransactions: [parent],
        target: { payees: [], categories: [], importedIdIndex: new Map(), transactions: [] },
        existingMappings: [],
      });

      const { run } = persistDraftPreviewRun(db, plan);
      const stored = listSyncFlowRunItems(db, { runId: run.id });
      // Stable ordering via the persisted `sequence` column (migration v3).
      expect(stored.map((i) => i.sourceItemKey)).toEqual(["split:p:s1", "split:p:s2"]);
      expect(stored.map((i) => i.sequence)).toEqual([0, 1]);
      expect(stored.every((i) => i.sourceEntityType === "split_line")).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
