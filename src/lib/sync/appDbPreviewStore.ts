import { getSyncFlow } from "@/lib/app-db/syncFlowRepository";
import { getAllSyncMappingsForFlow } from "@/lib/app-db/syncMappingRepository";
import { createSyncFlowRun } from "@/lib/app-db/syncRunRepository";
import { persistDraftPreviewRun } from "./persistPlan";
import type { SqliteDatabase } from "@/lib/app-db/types";
import type { PreviewStore } from "./previewOrchestrator";

/**
 * App DB-backed implementation of the dry-run `PreviewStore` port
 * (RD-053 / PR-019 Slice 3).
 *
 * This is the server-only adapter: it wires the orchestrator's persistence port
 * to the PR-018 repositories. Kept separate from the orchestrator so the
 * browser-side transport and the server-side SQLite never have to live in the
 * same module.
 */
export function createAppDbPreviewStore(db: SqliteDatabase): PreviewStore {
  return {
    loadFlow: async (flowId) => getSyncFlow(db, flowId),
    loadMappings: async (flowId) => getAllSyncMappingsForFlow(db, flowId),
    persistPlan: async (plan, meta) => {
      const { run } = persistDraftPreviewRun(db, plan, {
        summary: meta.summary,
        sourceSnapshotSummary: meta.sourceSnapshotSummary,
      });
      return { runId: run.id };
    },
    persistFailedRun: async (flowId, error, meta) => {
      const run = createSyncFlowRun(db, {
        flowId: flowId ?? null,
        status: "failed",
        createdByTrigger: "manual_preview",
        finishedAt: new Date().toISOString(),
        summary: { version: 1, data: { ...meta.summary } },
        error: { version: 1, data: { code: error.code, message: error.message } },
      });
      return run.id;
    },
  };
}
