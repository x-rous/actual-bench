import {
  createSyncFlowRun,
  createSyncFlowRunItem,
} from "@/lib/app-db/syncRunRepository";
import type {
  JsonObject,
  SqliteDatabase,
  SyncFlowRun,
  SyncFlowRunItem,
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
  };
}

export function persistDraftPreviewRun(
  db: SqliteDatabase,
  plan: SyncPlanResult
): PersistDraftPreviewResult {
  const run = createSyncFlowRun(db, {
    flowId: plan.flowId,
    status: "draft_preview",
    createdByTrigger: "manual_preview",
    summary: { version: 1, data: { totalItems: plan.items.length } },
    counts: { version: 1, data: { ...plan.counts } },
  });

  const items = plan.items.map((item) =>
    createSyncFlowRunItem(db, {
      runId: run.id,
      flowId: plan.flowId,
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
}
