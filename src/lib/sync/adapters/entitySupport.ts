import { normalizeName } from "../normalize";
import type { SyncEntityType, SyncFlow, SyncItemClassification, SyncMapping } from "@/lib/app-db/types";
import type { EntityTargetPayload, SyncPlannedItem, SyncPlanResult } from "../plannedChanges";

/**
 * Shared helpers for master-data (entity) sync adapters (RD-055): entity flow
 * config decode, normalized-name matching, and planned-item construction. Entity
 * flows sync at the **budget** level (no account) and have no `imported_id`
 * marker — matching is by normalized name, idempotency by the app-DB mapping.
 */

export type EntityFlowConfig = {
  flowId: string;
  sourceConnectionFingerprint: string;
  sourceBudgetId: string;
  sourceBudgetName: string;
  targetConnectionFingerprint: string;
  targetBudgetId: string;
  targetBudgetName: string;
  /** Category-only: create categories under this target group when no group matches. */
  defaultGroupName: string | null;
  /** Category-only: create a missing target group instead of blocking. */
  createMissingGroup: boolean;
};

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function decodeEntityFlowConfig(flow: SyncFlow): EntityFlowConfig {
  const leg = flow.legs[0];
  const source = (leg?.sourceRef.data ?? {}) as Record<string, unknown>;
  const target = (leg?.targetRef.data ?? {}) as Record<string, unknown>;
  const options = (leg?.options.data ?? {}) as Record<string, unknown>;
  const defaultGroup = str(options.defaultGroupName).trim();
  return {
    flowId: flow.id,
    sourceConnectionFingerprint: str(source.connectionFingerprint),
    sourceBudgetId: str(source.budgetId),
    sourceBudgetName: str(source.budgetName),
    targetConnectionFingerprint: str(target.connectionFingerprint),
    targetBudgetId: str(target.budgetId),
    targetBudgetName: str(target.budgetName),
    defaultGroupName: defaultGroup ? defaultGroup : null,
    createMissingGroup: options.createMissingGroup === true,
  };
}

/** Planned-item factory for an entity, reusing the shared run-item shape. */
export function buildEntityPlannedItem(input: {
  entityType: Extract<SyncEntityType, "payee" | "category">;
  sourceId: string;
  name: string;
  /** Display group name (categories); shown in the "group" column. */
  groupName?: string | null;
  classification: SyncItemClassification;
  action: SyncPlannedItem["action"];
  targetId: string | null;
  entityPayload: EntityTargetPayload | null;
  selectedForApply: boolean;
  message: string | null;
  flags?: SyncPlannedItem["flags"];
}): SyncPlannedItem {
  return {
    sourceItemKey: `${input.entityType}:${input.sourceId}`,
    sourceEntityType: input.entityType,
    sourceTransactionId: input.sourceId,
    sourceSplitId: null,
    sourceFingerprint: normalizeName(input.name),
    usedFallbackKey: false,
    source: {
      date: "",
      amount: 0,
      payeeName: input.name,
      categoryName: input.groupName ?? null,
      notes: null,
    },
    classification: input.classification,
    duplicateConfidence: "none",
    action: input.action,
    flags: input.flags ?? [],
    selectedForApply: input.selectedForApply,
    plannedTargetPayload: null,
    entityPayload: input.entityPayload,
    targetTransactionId: input.targetId,
    message: input.message,
  };
}

/** Tally a plan's items by classification for the run counts. */
export function countByClassification(items: SyncPlannedItem[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) counts[item.classification] = (counts[item.classification] ?? 0) + 1;
  return counts;
}

/** Existing DB mapping for a source entity key, if any. */
export function mappingFor(mappings: SyncMapping[], sourceItemKey: string): SyncMapping | undefined {
  return mappings.find((m) => m.sourceItemKey === sourceItemKey);
}

export function toPlanResult(flowId: string, items: SyncPlannedItem[]): SyncPlanResult {
  return { flowId, items, counts: countByClassification(items) };
}

export { normalizeName };
