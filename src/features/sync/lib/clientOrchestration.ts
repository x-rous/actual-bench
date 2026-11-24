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
  type FxSnapshotInput,
  type ApplyTransportProvider,
  type RunItemStatusPatch,
} from "@/lib/sync/applyOrchestrator";
import { manualFxRates } from "@/lib/sync/fxPosition";
import { runSafeSync, type SafeSyncResult } from "@/lib/sync/safeSyncOrchestrator";
import type { ConnectionInstance } from "@/store/connection";
import type { SyncMapping, SyncMappingInput } from "@/lib/app-db/types";
import * as api from "./syncApi";

/**
 * Client-side wiring for the Cross Budget Sync orchestrators (RD-053 / PR-019
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
    loadManualFxRates: async (flowId) => manualFxRates((await api.listFlowFxSnapshots(flowId)).snapshots),
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
  // One store serves one apply. Its run and item writes carry the claim token,
  // so the server refuses them once another apply owns the run.
  let applyToken: string | null = null;
  const pendingMappings: SyncMappingInput[] = [];
  const pendingItemPatches: { itemId: string; patch: RunItemStatusPatch }[] = [];
  const pendingFxSnapshots: { input: FxSnapshotInput; itemId?: string }[] = [];
  // Records are buffered with the run item they belong to, so one the server could
  // not save can fail that item and leave the others applied.
  const itemByMappingKey = new Map<string, string>();
  const failedItems = new Map<string, RunItemStatusPatch>();
  const failItem = (itemId: string | undefined, code: string, message: string) => {
    if (!itemId) return;
    const patch: RunItemStatusPatch = { status: "failed", applyState: "failed", message, errors: { version: 1, data: { code } } };
    failedItems.set(itemId, patch);
    pendingItemPatches.push({ itemId, patch });
  };

  /** Mappings first, then FX records; run-item state unless the claim was lost. */
  async function flush(options: { items: boolean } = { items: true }): Promise<void> {
    if (pendingMappings.length > 0) {
      const { conflicts } = await api.createMappings(pendingMappings);
      pendingMappings.length = 0;
      for (const key of conflicts ?? []) {
        failItem(itemByMappingKey.get(key), "mapping_conflict", "This item is already linked to a different target transaction. Check the target account for a duplicate.");
      }
    }
    if (pendingFxSnapshots.length > 0) {
      const batch = pendingFxSnapshots.splice(0);
      const snapshots = batch.map((entry) => entry.input);
      // The record of the rate these rows keep. If it cannot be saved the item
      // fails, and Retry saves it without writing the transaction again.
      await api.persistFxSnapshots(snapshots).catch(() => api.persistFxSnapshots(snapshots)).catch(() => {
        for (const { itemId } of batch) failItem(itemId, "fx_record_failed", "The transaction was written, but its exchange rate could not be saved. Retry to save it.");
      });
    }
    if (!options.items) {
      pendingItemPatches.length = 0;
      return;
    }
    if (pendingItemPatches.length > 0) {
      await api.updateRunItems(pendingItemPatches.map(({ itemId, patch }) => ({ itemId, patch: { ...patch, applyToken } })));
      pendingItemPatches.length = 0;
    }
  }

  return {
    claimRun: async (runId, retry) => {
      applyToken = (await api.claimRun(runId, retry)).token;
      return applyToken;
    },
    heartbeatRun: async (runId, token) => (await api.heartbeatRun(runId, token)).alive,
    saveRunItemPayloads: async (payloads) => {
      // One request and one transaction: all of them are saved, or none.
      await api.updateRunItems(payloads.map(({ itemId, payload }) => ({ itemId, patch: { plannedTargetPayload: payload, applyToken } })));
    },
    flushWrites: async () => {
      await flush();
      return [...failedItems.keys()];
    },
    flushRecords: () => flush({ items: false }),
    loadRun: async (runId) => (await api.getRun(runId)).run,
    loadRunItems: async (runId) => (await api.getRun(runId)).items,
    loadFlow: async (flowId) => (await api.getFlow(flowId)).flow,
    getMappingBySource: async (flowId, sourceItemKey) =>
      (await ensureMappingCache(flowId)).get(sourceItemKey) ?? null,
    createMapping: async (input, itemId) => {
      pendingMappings.push(input);
      if (itemId) itemByMappingKey.set(input.sourceItemKey, itemId);
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
      await api.updateRun(runId, { status: patch.status, finishedAt: patch.finishedAt, counts: patch.counts, ...(patch.error !== undefined ? { error: patch.error } : {}), applyToken });
    },
    updateRunItemStatus: async (itemId, patch) => {
      pendingItemPatches.push({ itemId, patch: failedItems.get(itemId) ?? patch });
    },
    persistApplyFailure: async (runId, error) => {
      // Persist whatever succeeded before the failure, then record the error.
      await flush();
      await api.updateRun(runId, {
        status: "failed",
        finishedAt: new Date().toISOString(),
        error: { version: 1, data: { code: error.code, message: error.message } },
        applyToken,
      });
    },
    persistFxSnapshot: async (input, itemId) => {
      // A rate the user set is written now. Others go in one batch at the end.
      if (!input.isManual) {
        pendingFxSnapshots.push({ input, itemId });
        return;
      }
      try {
        await api.persistFxSnapshot(input);
      } catch {
        await api.persistFxSnapshot(input);
      }
    },
    updateFxSnapshot: async (input) => {
      await api.updateFxSnapshot(input);
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
  amountOverrides?: Record<string, number>;
}): Promise<ApplyRunResult> {
  return applySyncRun(
    { runId: input.runId, targetConnection: input.targetConnection, selection: input.selection, amountOverrides: input.amountOverrides },
    { transport: browserTransportProvider, store: applyStore() }
  );
}

/**
 * Send categories set in the target budget back to empty source rows, through the
 * same preview and apply as any other sync. It writes to the flow's source budget.
 */
export async function runClientCategoryReturn(input: {
  flowId: string;
  sourceConnection: ConnectionInstance;
  targetConnection: ConnectionInstance;
}): Promise<ApplyRunResult | null> {
  const preview = await runLiveDryRunPreview(
    {
      flowId: input.flowId,
      context: { sourceConnection: input.sourceConnection, targetConnection: input.targetConnection },
      allowDisabled: true,
      adapterKind: "category_return",
    },
    { transport: browserTransportProvider, store: previewStore() }
  );
  if (preview.status !== "draft_preview") throw new Error(preview.error.message);
  const selectedItemIds = preview.items.filter((item) => item.plannedAction === "update").map((item) => item.id);
  if (selectedItemIds.length === 0) {
    await api.updateRun(preview.runId, { status: "no_changes", finishedAt: new Date().toISOString() });
    return null;
  }
  return applySyncRun(
    { runId: preview.runId, targetConnection: input.sourceConnection, selection: { selectedItemIds } },
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
    {
      transport: browserTransportProvider,
      previewStore: previewStore(),
      applyStore: applyStore(),
      resolveFx: (needs, allowProvider) => api.resolveFxRates(needs, allowProvider),
    }
  );
}
