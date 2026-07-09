import {
  createSyncFlowRun,
  createSyncFlowRunItem,
} from "@/lib/app-db/syncRunRepository";
import type {
  JsonObject,
  SqliteDatabase,
  SyncFlowRun,
  SyncFlowRunItem,
  SyncRunTrigger,
} from "@/lib/app-db/types";
import type { PlannedTargetPayload, SyncPlannedItem, SyncPlanResult } from "./plannedChanges";

/**
 * Persist a dry-run plan into the PR-018 run/run-item repositories
 * (RD-053 / PR-019 Slice 2).
 *
 * The run is created in `draft_preview` state with no Actual writes. Planned
 * items are stored with their classification, planned payload, flags, and the
 * durable marker so the preview is fully inspectable and reloadable.
 */

export type PersistDraftPreviewResult = {
  run: SyncFlowRun;
  items: SyncFlowRunItem[];
};

export type PersistDraftPreviewOptions = {
  /** Extra run-summary fields merged with the item total (e.g. scan/filter counts). */
  summary?: JsonObject;
  /** Source snapshot summary stored on the run. */
  sourceSnapshotSummary?: JsonObject;
  /** What created this run; defaults to a manual preview (RD-054). */
  trigger?: SyncRunTrigger;
};

function payloadToJsonObject(payload: PlannedTargetPayload): JsonObject {
  return {
    accountId: payload.accountId,
    date: payload.date,
    amount: payload.amount,
    payeeId: payload.payeeId,
    payeeName: payload.payeeName,
    categoryId: payload.categoryId,
    notes: payload.notes,
    cleared: payload.cleared,
    importedId: payload.importedId,
  };
}

function sourceItemRef(item: SyncPlannedItem): JsonObject {
  return {
    itemKey: item.sourceItemKey,
    entityType: item.sourceEntityType,
    transactionId: item.sourceTransactionId,
    splitId: item.sourceSplitId,
    fingerprint: item.sourceFingerprint,
    usedFallbackKey: item.usedFallbackKey,
    // Source display snapshot so the preview can show source vs target.
    source: {
      date: item.source.date,
      amount: item.source.amount,
      payeeName: item.source.payeeName,
      categoryName: item.source.categoryName,
      notes: item.source.notes,
    },
  };
}

export function persistDraftPreviewRun(
  db: SqliteDatabase,
  plan: SyncPlanResult,
  options: PersistDraftPreviewOptions = {}
): PersistDraftPreviewResult {
  // Persist the run + all its items in ONE transaction: 1 commit instead of
  // N+1, which is the difference between one fsync and hundreds for a big run.
  const persist = db.transaction((): PersistDraftPreviewResult => {
    const run = createSyncFlowRun(db, {
      flowId: plan.flowId,
      status: "draft_preview",
      createdByTrigger: options.trigger ?? "manual_preview",
      summary: { version: 1, data: { totalItems: plan.items.length, ...options.summary } },
      counts: { version: 1, data: { ...plan.counts } },
      sourceSnapshotSummary: options.sourceSnapshotSummary
        ? { version: 1, data: options.sourceSnapshotSummary }
        : null,
    });

    const items = plan.items.map((item, index) =>
      createSyncFlowRunItem(db, {
        runId: run.id,
        flowId: plan.flowId,
        sequence: index,
        status: "planned",
        message: item.message,
        sourceItemRef: { version: 1, data: sourceItemRef(item) },
        targetItemRef: item.targetTransactionId
          ? { version: 1, data: { targetTransactionId: item.targetTransactionId } }
          : null,
        sourceEntityType: item.sourceEntityType,
        sourceItemKey: item.sourceItemKey,
        sourceTransactionId: item.sourceTransactionId,
        sourceSplitId: item.sourceSplitId,
        sourceFingerprint: item.sourceFingerprint,
        plannedAction: item.action,
        plannedTargetPayload: item.plannedTargetPayload
          ? { version: 1, data: payloadToJsonObject(item.plannedTargetPayload) }
          : null,
        classification: item.classification,
        duplicateConfidence: item.duplicateConfidence,
        warnings: { version: 1, data: { flags: [...item.flags] } },
        selectedForApply: item.selectedForApply,
        applyState: "pending",
        createdTargetMarker: item.plannedTargetPayload?.importedId ?? null,
      })
    );

    return { run, items };
  });

  return persist();
}
