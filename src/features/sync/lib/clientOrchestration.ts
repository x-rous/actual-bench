import { ensureTransportReady, getTransport } from "@/lib/actual";
import {
  runLiveDryRunPreview,
  type LiveDryRunResult,
  type PreviewStore,
  type PreviewTransportProvider,
} from "@/lib/sync/previewOrchestrator";
import {
  applySyncRun,
  type ApplyRunResult,
  type ApplyStore,
  type ApplySelection,
  type ApplyTransportProvider,
} from "@/lib/sync/applyOrchestrator";
import type { ConnectionInstance } from "@/store/connection";
import type { SyncMapping } from "@/lib/app-db/types";
import * as api from "./syncApi";

/**
 * Client-side wiring for the Budget File Sync orchestrators (RD-053 / PR-019
 * Slice 5). The preview/apply orchestrators run in the browser (they need the
 * Direct transport); their DB ports are satisfied by the server routes via
 * `syncApi`. No planner/apply logic is duplicated here — this only assembles
 * ports and calls the existing orchestrators.
 */

const browserTransportProvider: PreviewTransportProvider & ApplyTransportProvider = {
  async openTransport(connection: ConnectionInstance) {
    // Pattern A: opening a Direct budget may switch the single browser runtime.
    await ensureTransportReady(connection);
    return getTransport(connection);
  },
};

function previewStore(): PreviewStore {
  return {
    loadFlow: async (flowId) => (await api.getFlow(flowId)).flow,
    loadMappings: async (flowId) => (await api.listMappings(flowId)).mappings,
    persistPlan: async (plan, meta) =>
      api.persistDraftRun({ plan, summary: meta.summary, sourceSnapshotSummary: meta.sourceSnapshotSummary }),
    persistFailedRun: async (flowId, error, meta) => {
      const { runId } = await api.persistFailedRun({
        flowId,
        summary: meta.summary,
        error: { code: error.code, message: error.message },
      });
      return runId;
    },
  };
}

function applyStore(): ApplyStore {
  // Preload mappings once so per-item revalidation is a cache hit, not N fetches.
  let mappingCache: Map<string, SyncMapping> | null = null;
  async function ensureMappingCache(flowId: string): Promise<Map<string, SyncMapping>> {
    if (!mappingCache) {
      const { mappings } = await api.listMappings(flowId);
      mappingCache = new Map(mappings.map((m) => [m.sourceItemKey, m]));
    }
    return mappingCache;
  }

  return {
    loadRun: async (runId) => (await api.getRun(runId)).run,
    loadRunItems: async (runId) => (await api.getRun(runId)).items,
    loadFlow: async (flowId) => (await api.getFlow(flowId)).flow,
    getMappingBySource: async (flowId, sourceItemKey) =>
      (await ensureMappingCache(flowId)).get(sourceItemKey) ?? null,
    createMapping: async (input) => {
      const { mapping } = await api.createMapping(input);
      // Keep the cache coherent for the rest of this apply run.
      if (mappingCache) mappingCache.set(mapping.sourceItemKey, mapping);
    },
    updateRunStatus: async (runId, patch) => {
      await api.updateRun(runId, { status: patch.status, finishedAt: patch.finishedAt, counts: patch.counts });
    },
    updateRunItemStatus: async (itemId, patch) => {
      await api.updateRunItem(itemId, patch);
    },
    persistApplyFailure: async (runId, error) => {
      await api.updateRun(runId, {
        status: "failed",
        finishedAt: new Date().toISOString(),
        error: { version: 1, data: { code: error.code, message: error.message } },
      });
    },
  };
}

export function runClientPreview(input: {
  flowId: string;
  sourceConnection: ConnectionInstance;
  targetConnection: ConnectionInstance;
  allowDisabled?: boolean;
}): Promise<LiveDryRunResult> {
  return runLiveDryRunPreview(
    {
      flowId: input.flowId,
      context: { sourceConnection: input.sourceConnection, targetConnection: input.targetConnection },
      allowDisabled: input.allowDisabled,
    },
    { transport: browserTransportProvider, store: previewStore() }
  );
}

export function runClientApply(input: {
  runId: string;
  targetConnection: ConnectionInstance;
  selection?: ApplySelection;
}): Promise<ApplyRunResult> {
  return applySyncRun(
    { runId: input.runId, targetConnection: input.targetConnection, selection: input.selection },
    { transport: browserTransportProvider, store: applyStore() }
  );
}
