import { classifyDuplicate } from "./duplicateClassifier";
import { resolveCategory, resolvePayee } from "./entityResolution";
import { generateSyncMarker } from "./marker";
import { expandSourceTransactions, type SyncSourceItem } from "./sourceItems";
import { buildPlannedTargetPayload } from "./transform";
import type {
  SyncDuplicateConfidence,
  SyncEntityType,
  SyncItemClassification,
  SyncMapping,
} from "@/lib/app-db/types";
import type {
  PlannedTargetPayload,
  SyncPlanFlag,
  SyncPlannedAction,
  SyncPlannedItem,
  SyncPlannerInput,
  SyncPlanResult,
} from "./plannedChanges";

/**
 * Headless dry-run planner for Budget File Sync (RD-053 / PR-019 Slice 2).
 *
 * Takes a flow config, a materialized source snapshot, target lookup data, and
 * existing mappings; produces classified planned items with target payloads.
 * Performs NO Actual writes and NO DB access — persistence is a separate step
 * (`persistDraftPreviewRun`).
 *
 * Decision order per source item:
 *   1. existing DB mapping?  -> already_synced / source_changed_since_sync
 *   2. else durable marker already on target? -> target_marker_match (repair)
 *   3. else duplicate heuristic -> exact/strong/weak_duplicate (skipped)
 *   4. else -> new (create), unless no marker can be produced -> blocked
 * DB mappings are the primary source of truth; the marker is secondary.
 */
/**
 * Plan from raw source transactions — expands splits internally. Convenience
 * entry point for headless/fixture use.
 */
export function planSyncFlow(input: SyncPlannerInput): SyncPlanResult {
  return planExpandedItems({
    ...input,
    sourceItems: expandSourceTransactions(input.sourceTransactions),
  });
}

/**
 * Plan from already-expanded, already-filtered source items. The live
 * orchestrator (Slice 3) filters + materializes source items first, then calls
 * this so filtering semantics apply per split line.
 */
export function planExpandedItems(
  input: Omit<SyncPlannerInput, "sourceTransactions"> & { sourceItems: SyncSourceItem[] }
): SyncPlanResult {
  const { config, capabilities } = input;
  const mappingByKey = new Map<string, SyncMapping>();
  for (const mapping of input.existingMappings) {
    mappingByKey.set(mapping.sourceItemKey, mapping);
  }

  const canWriteMarker =
    capabilities.supported && capabilities.capabilities.createTransactionWithImportedId;

  const items = input.sourceItems.map((sourceItem) =>
    planSourceItem(sourceItem, input, mappingByKey, canWriteMarker)
  );

  const counts: Record<string, number> = {};
  for (const item of items) {
    counts[item.classification] = (counts[item.classification] ?? 0) + 1;
  }

  return { flowId: config.flowId, items, counts };
}

function entityType(item: SyncSourceItem): SyncEntityType {
  return item.kind === "split_line" ? "split_line" : "transaction";
}

function baseItem(
  item: SyncSourceItem,
  fields: {
    classification: SyncItemClassification;
    action: SyncPlannedAction;
    duplicateConfidence?: SyncDuplicateConfidence;
    flags?: SyncPlanFlag[];
    selectedForApply?: boolean;
    plannedTargetPayload?: PlannedTargetPayload | null;
    targetTransactionId?: string | null;
    message?: string | null;
  }
): SyncPlannedItem {
  const flags = fields.flags ?? [];
  if (item.usedFallbackKey && !flags.includes("split_fallback_key")) {
    flags.push("split_fallback_key");
  }
  return {
    sourceItemKey: item.itemKey,
    sourceEntityType: entityType(item),
    sourceTransactionId: item.sourceTransactionId,
    sourceSplitId: item.sourceSplitId,
    sourceFingerprint: item.fingerprint,
    usedFallbackKey: item.usedFallbackKey,
    source: {
      date: item.date,
      amount: item.amount,
      payeeName: item.payeeName,
      categoryName: item.categoryName,
      notes: item.notes,
    },
    classification: fields.classification,
    duplicateConfidence: fields.duplicateConfidence ?? "none",
    action: fields.action,
    flags,
    selectedForApply: fields.selectedForApply ?? false,
    plannedTargetPayload: fields.plannedTargetPayload ?? null,
    targetTransactionId: fields.targetTransactionId ?? null,
    message: fields.message ?? null,
  };
}

function planSourceItem(
  item: SyncSourceItem,
  input: Pick<SyncPlannerInput, "config" | "target">,
  mappingByKey: Map<string, SyncMapping>,
  canWriteMarker: boolean
): SyncPlannedItem {
  const { config, target } = input;

  // 1. Existing mapping wins — this item was synced before.
  const mapping = mappingByKey.get(item.itemKey);
  if (mapping) {
    if (mapping.sourceFingerprint === item.fingerprint) {
      return baseItem(item, {
        classification: "already_synced",
        action: "skip",
        targetTransactionId: mapping.targetTransactionId,
        message: "Already synced.",
      });
    }
    // Source content changed after sync: warn only, never auto-update target.
    return baseItem(item, {
      classification: "source_changed_since_sync",
      action: "skip",
      flags: ["source_changed_since_sync"],
      targetTransactionId: mapping.targetTransactionId,
      message: "Source changed since last sync; target left unchanged.",
    });
  }

  // Resolve entities + build the intended payload/marker up front.
  const payee = resolvePayee(item, config, target.payees);
  const category = resolveCategory(item, target.categories);
  const importedId = generateSyncMarker({
    sourceBudgetId: config.sourceBudgetId,
    targetBudgetId: config.targetBudgetId,
    targetAccountId: config.targetAccountId,
    sourceItemKey: item.itemKey,
  });
  const payload = buildPlannedTargetPayload({ item, config, payee, category, importedId });
  const effectivePayeeName = resolveEffectivePayeeName(item, payee, target);

  // 2. No mapping, but our marker already exists on the target → repairable.
  if (importedId && target.importedIdIndex.has(importedId)) {
    return baseItem(item, {
      classification: "target_marker_match",
      action: "skip",
      flags: ["target_marker_match_repair"],
      targetTransactionId: target.importedIdIndex.get(importedId) ?? null,
      message: "Target already has a matching sync marker; mapping can be repaired.",
    });
  }

  // 3. Duplicate heuristic (skipped by default when uncertain).
  const { confidence, targetTransactionId: dupTargetId } = classifyDuplicate(
    payload,
    target.transactions,
    effectivePayeeName
  );
  if (confidence !== "none") {
    // Exact duplicates can be auto-mapped to the existing target when the flow
    // opts in: record a mapping (no write), instead of routing to review. Fuzzy
    // (strong/weak) duplicates always stay review-required.
    if (confidence === "exact" && config.exactDuplicateAutoMap && dupTargetId) {
      return baseItem(item, {
        classification: "exact_duplicate",
        action: "skip",
        duplicateConfidence: confidence,
        flags: ["exact_duplicate_auto_map"],
        plannedTargetPayload: payload,
        targetTransactionId: dupTargetId,
        message: "Exact duplicate on the target; will be mapped to the existing transaction.",
      });
    }
    return baseItem(item, {
      classification: duplicateClassification(confidence),
      action: "skip",
      duplicateConfidence: confidence,
      flags: ["duplicate_review"],
      message: "Possible duplicate on the target; skipped for review.",
    });
  }

  // 4a. Blocked when we cannot attach a durable marker to the create.
  if (!importedId) {
    return baseItem(item, {
      classification: "blocked",
      action: "blocked",
      flags: ["blocked_no_marker"],
      message: canWriteMarker
        ? "Cannot derive a stable sync marker for this item."
        : "Target cannot store a durable sync marker (imported id) in this mode.",
    });
  }
  if (!canWriteMarker) {
    return baseItem(item, {
      classification: "blocked",
      action: "blocked",
      flags: ["blocked_no_marker"],
      message: "Target cannot store a durable sync marker (imported id) in this mode.",
    });
  }

  // 4b. New create candidate.
  const flags: SyncPlanFlag[] = ["target_rules_may_modify"];
  if (payee.willCreateOnApply) flags.push("missing_payee_created_on_apply");
  if (payee.leftEmpty) flags.push("missing_payee_left_empty");
  if (category.leftEmpty) flags.push("missing_category_left_empty");

  return baseItem(item, {
    classification: "new",
    action: "create",
    flags,
    selectedForApply: true,
    plannedTargetPayload: payload,
    message: null,
  });
}

/**
 * Effective payee name used for duplicate comparison: the matched target
 * payee's name, else the create-on-apply name, else the source name.
 */
function resolveEffectivePayeeName(
  item: SyncSourceItem,
  payee: ReturnType<typeof resolvePayee>,
  target: SyncPlannerInput["target"]
): string | null {
  if (payee.payeeId) {
    return target.payees.find((p) => p.id === payee.payeeId)?.name ?? item.payeeName;
  }
  return payee.payeeName ?? item.payeeName;
}

function duplicateClassification(
  confidence: SyncDuplicateConfidence
): SyncItemClassification {
  switch (confidence) {
    case "exact":
      return "exact_duplicate";
    case "strong":
      return "strong_duplicate";
    case "weak":
      return "weak_duplicate";
    default:
      return "new";
  }
}
