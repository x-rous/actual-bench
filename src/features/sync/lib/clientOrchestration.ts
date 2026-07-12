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
  type RunItemStatusPatch,
} from "@/lib/sync/applyOrchestrator";
import { runSafeSync, type SafeSyncResult } from "@/lib/sync/safeSyncOrchestrator";
import type { ConnectionInstance } from "@/store/connection";
import type { SyncMapping, SyncMappingInput } from "@/lib/app-db/types";
import * as api from "./syncApi";

/**
 * Client-side wiring for the Budget File Sync orchestrators (RD-053 / PR-019
 * Slice 5). The preview/apply orchestrators run in the browser (they need the
 * Direct transport); their DB ports are satisfied by the server routes via
 * `syncApi`. No planner/apply logic is duplicated here - this only assembles
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
      api.persistDraftRun({ plan, summary: meta.summary, sourceSnapshotSummary: meta.sourceSnapshotSummary, trigger: meta.trigger }),
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

  // Per-item mapping creates and status updates are buffered and flushed in one
  // request each (one insert-transaction + one update-transaction) instead of an
  // HTTP round-trip per item - the dominant apply cost on large runs. The
  // durable target `imported_id` marker is the real idempotency guarantee, so a
  // deferred flush cannot cause duplicates even if the tab closes mid-run.
  const pendingMappings: SyncMappingInput[] = [];
  const pendingItemPatches: { itemId: string; patch: RunItemStatusPatch }[] = [];

  async function flush(): Promise<void> {
    if (pendingMappings.length > 0) {
      await api.createMappings(pendingMappings);
      pendingMappings.length = 0;
    }
    if (pendingItemPatches.length > 0) {
      await api.updateRunItems(pendingItemPatches);
      pendingItemPatches.length = 0;
    }
  }

  return {
    loadRun: async (runId) => (await api.getRun(runId)).run,
    loadRunItems: async (runId) => (await api.getRun(runId)).items,
    loadFlow: async (flowId) => (await api.getFlow(flowId)).flow,
    getMappingBySource: async (flowId, sourceItemKey) =>
      (await ensureMappingCache(flowId)).get(sourceItemKey) ?? null,
    createMapping: async (input) => {
      pendingMappings.push(input);
      // Keep the in-memory cache coherent immediately (the DB write is deferred).
      if (mappingCache) mappingCache.set(input.sourceItemKey, input as unknown as SyncMapping);
    },
    updateMapping: async (mappingId, patch) => {
      // Update/delete mapping patches are rare (one per drifted/removed item), so
      // they write straight through rather than buffering like creates.
      await flush();
      await api.updateMapping(mappingId, patch);
    },
    updateRunStatus: async (runId, patch) => {
      // A terminal status marks the end of the run: flush buffered item writes
      // first so the finalized run reflects them, then update the run itself.
      if (patch.status !== "applying") await flush();
      await api.updateRun(runId, { status: patch.status, finishedAt: patch.finishedAt, counts: patch.counts });
    },
    updateRunItemStatus: async (itemId, patch) => {
      pendingItemPatches.push({ itemId, patch });
    },
    persistApplyFailure: async (runId, error) => {
      // Persist whatever succeeded before the failure, then record the error.
      await flush();
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
    { transport: browserTransportProvider, store: previewStore(), resolveFx: (needs, allowProvider) => api.resolveFxRates(needs, allowProvider) }
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

/**
 * Run a safe-only automated sync (RD-054 / PR-020) end to end via the browser
 * transport: policy-gated preview → apply of safe classes only. Used by both the
 * "Run safe sync now" action and the client interval scheduler.
 */
export function runClientSafeSync(input: {
  flowId: string;
  sourceConnection: ConnectionInstance;
  targetConnection: ConnectionInstance;
  allowDisabled?: boolean;
}): Promise<SafeSyncResult> {
  return runSafeSync(
    {
      flowId: input.flowId,
      context: { sourceConnection: input.sourceConnection, targetConnection: input.targetConnection },
      allowDisabled: input.allowDisabled,
    },
    { transport: browserTransportProvider, previewStore: previewStore(), applyStore: applyStore() }
  );
}
