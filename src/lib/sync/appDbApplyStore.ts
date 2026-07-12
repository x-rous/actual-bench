import { getSyncFlow } from "@/lib/app-db/syncFlowRepository";
import { createSyncMapping, getSyncMappingBySource, updateSyncMapping } from "@/lib/app-db/syncMappingRepository";
import {
  getAllSyncFlowRunItems,
  getSyncFlowRun,
  updateSyncFlowRun,
  updateSyncFlowRunItem,
} from "@/lib/app-db/syncRunRepository";
import { saveTransactionFx } from "@/lib/fx/repositories/transactionFxRepository";
import type { SqliteDatabase } from "@/lib/app-db/types";
import type { ApplyStore } from "./applyOrchestrator";

/**
 * App DB-backed implementation of the apply `ApplyStore` port
 * (RD-053 / PR-019 Slice 4). Server-only adapter over the PR-018 repositories;
 * kept separate from the orchestrator so browser transport and SQLite stay
 * decoupled.
 */
export function createAppDbApplyStore(db: SqliteDatabase): ApplyStore {
  return {
    loadRun: async (runId) => getSyncFlowRun(db, runId),
    loadRunItems: async (runId) => getAllSyncFlowRunItems(db, runId),
    loadFlow: async (flowId) => getSyncFlow(db, flowId),
    getMappingBySource: async (flowId, sourceItemKey) => getSyncMappingBySource(db, flowId, sourceItemKey),
    createMapping: async (input) => {
      createSyncMapping(db, input);
    },
    updateMapping: async (mappingId, patch) => {
      updateSyncMapping(db, mappingId, patch);
    },
    updateRunStatus: async (runId, patch) => {
      updateSyncFlowRun(db, runId, {
        status: patch.status,
        finishedAt: patch.finishedAt,
        counts: patch.counts,
      });
    },
    updateRunItemStatus: async (itemId, patch) => {
      updateSyncFlowRunItem(db, itemId, patch);
    },
    persistApplyFailure: async (runId, error) => {
      updateSyncFlowRun(db, runId, {
        status: "failed",
        finishedAt: new Date().toISOString(),
        error: { version: 1, data: { code: error.code, message: error.message } },
      });
    },
    persistFxSnapshot: async (input) => {
      saveTransactionFx(db, { ...input, source: input.source as import("@/lib/fx/types").FxRateSource, isManual: false });
    },
  };
}
