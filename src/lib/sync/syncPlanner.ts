import { classifyDuplicate } from "./duplicateClassifier";
import { resolveCategory, resolvePayee } from "./entityResolution";
import { generateSyncMarker } from "./marker";
import { expandSourceTransactions, type SyncSourceItem } from "./sourceItems";
import { buildPlannedTargetPayload } from "./transform";
import { convertMinorUnits } from "@/lib/fx/fxMath";
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
 * Performs NO Actual writes and NO DB access - persistence is a separate step
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
 * Plan from raw source transactions - expands splits internally. Convenience
 * entry point for headless/fixture use.
 */
export function planSyncFlow(input: SyncPlannerInput): SyncPlanResult {
  return planExpandedItems({
    ...input,
    sourceItems: expandSourceTransactions(input.sourceTransactions, {
      groupSplits: input.config.createTargetSplits,
    }),
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

  // RD-057 §5: an active mapping whose source item is no longer present means the
  // source transaction was deleted. Surfaced only when the flow opts in (whole
  // account scans), as review-first delete candidates the user must select.
  if (input.detectDeletedSource) {
    const presentKeys = new Set(input.sourceItems.map((item) => item.itemKey));
    for (const mapping of input.existingMappings) {
      if (mapping.status !== "active") continue;
      if (presentKeys.has(mapping.sourceItemKey)) continue;
      items.push(deletedSourceItem(mapping));
    }
  }

  const counts: Record<string, number> = {};
  for (const item of items) {
    counts[item.classification] = (counts[item.classification] ?? 0) + 1;
  }

  return { flowId: config.flowId, items, counts };
}

/** A review-first delete candidate for a mapping whose source was deleted. */
function deletedSourceItem(mapping: SyncMapping): SyncPlannedItem {
  return {
    sourceItemKey: mapping.sourceItemKey,
    sourceEntityType: mapping.sourceEntityType,
    sourceTransactionId: mapping.sourceTransactionId ?? "",
    sourceSplitId: mapping.sourceSplitId,
    sourceFingerprint: mapping.sourceFingerprint,
    usedFallbackKey: false,
    source: { date: "", amount: 0, payeeName: null, categoryName: null, notes: null },
    classification: "source_missing",
    duplicateConfidence: "none",
    action: "delete",
    flags: ["source_deleted_review"],
    selectedForApply: false,
    plannedTargetPayload: null,
    targetTransactionId: mapping.targetTransactionId,
    message: "Source transaction was deleted; select to delete the mapped target.",
  };
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

/** A blocked item awaiting an FX rate (RD-056), routed to review. */
function fxPendingItem(item: SyncSourceItem): SyncPlannedItem {
  return baseItem(item, {
    classification: "blocked",
    action: "blocked",
    flags: ["fx_rate_pending"],
    message: `No FX rate available for ${item.date}; item is awaiting a rate.`,
  });
}

function planSourceItem(
  item: SyncSourceItem,
  input: Pick<SyncPlannerInput, "config" | "target" | "fxRateByDate">,
  mappingByKey: Map<string, SyncMapping>,
  canWriteMarker: boolean
): SyncPlannedItem {
  const { config, target } = input;

  // FX conversion (RD-056): resolve this item's rate. A cross-currency item with
  // no rate for its date is "pending" and routed to review before it could be
  // matched/created with an unconverted amount.
  const needsFx = config.fxEnabled && config.fxSourceCurrency !== config.fxTargetCurrency;
  const fxInfo = needsFx ? input.fxRateByDate?.get(item.date) ?? null : null;
  const fxRate = fxInfo?.rate ?? null;
  const fxPending = needsFx && fxInfo == null;

  // 1. Existing mapping wins - this item was synced before.
  const mapping = mappingByKey.get(item.itemKey);
  if (mapping) {
    // A disabled mapping (RD-057 §7 repair tool) means "stop syncing this item":
    // skip it and never re-create, regardless of source changes.
    if (mapping.status === "disabled") {
      return baseItem(item, {
        classification: "already_synced",
        action: "skip",
        targetTransactionId: mapping.targetTransactionId,
        message: "Sync disabled for this item.",
      });
    }
    if (mapping.sourceFingerprint === item.fingerprint) {
      return baseItem(item, {
        classification: "already_synced",
        action: "skip",
        targetTransactionId: mapping.targetTransactionId,
        message: "Already synced.",
      });
    }
    // Source content changed after sync. When the flow opts into updating mapped
    // targets (RD-057 §4), build an update candidate that overwrites the target;
    // otherwise warn only and leave the target unchanged. Apply re-checks that
    // the target was not edited outside sync before overwriting.
    //
    // Grouped split parents are excluded: the update path patches only the parent
    // fields and cannot rewrite child lines, so updating one would leave the split
    // totals inconsistent. Warn instead until updates can carry subtransactions.
    const isGroupedSplit = !!item.splitLines && item.splitLines.length > 0;
    if (config.updateMappedTargets && mapping.targetTransactionId && !isGroupedSplit) {
      if (fxPending) return fxPendingItem(item);
      const upPayee = resolvePayee(item, config, input.target.payees);
      const upCategory = resolveCategory(item, input.target.categories);
      const upImportedId = generateSyncMarker({
        sourceBudgetId: config.sourceBudgetId,
        targetBudgetId: config.targetBudgetId,
        targetAccountId: config.targetAccountId,
        sourceItemKey: item.itemKey,
      });
      const upPayload = buildPlannedTargetPayload({
        item,
        config,
        payee: upPayee,
        category: upCategory,
        importedId: upImportedId,
        fx: fxInfo,
      });
      return baseItem(item, {
        classification: "source_changed_since_sync",
        action: "update",
        flags: ["source_changed_since_sync", "source_changed_update"],
        selectedForApply: true,
        plannedTargetPayload: upPayload,
        targetTransactionId: mapping.targetTransactionId,
        message: "Source changed since last sync; target will be updated to match.",
      });
    }
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
  // Grouped split (RD-057 §6): resolve each child's payee/category by name and
  // apply the flow's amount direction, so the parent creates as one target split.
  const subtransactions = item.splitLines?.map((line) => {
    const childPayee = resolvePayee({ payeeName: line.payeeName ?? item.payeeName }, config, target.payees);
    const childCategory = resolveCategory({ categoryName: line.categoryName }, target.categories);
    const directedChild = config.amountDirection === "same" ? line.amount : -line.amount;
    return {
      amount: fxRate ? convertMinorUnits(directedChild, fxRate) : directedChild,
      categoryId: childCategory.categoryId,
      payeeId: childPayee.payeeId,
      payeeName: childPayee.payeeName,
      notes: line.notes,
    };
  }) ?? null;
  // With FX, converting each child independently can round the children so they
  // no longer sum to the parent total. Reconcile by pushing the rounding
  // remainder onto the last child, keeping the grouped split balanced (RD-056).
  if (fxRate && subtransactions && subtransactions.length > 0) {
    const directedParent = config.amountDirection === "same" ? item.amount : -item.amount;
    const parentConverted = convertMinorUnits(directedParent, fxRate);
    const childSum = subtransactions.reduce((sum, child) => sum + child.amount, 0);
    const remainder = parentConverted - childSum;
    if (remainder !== 0) subtransactions[subtransactions.length - 1].amount += remainder;
  }
  const payload = buildPlannedTargetPayload({ item, config, payee, category, importedId, subtransactions, fx: fxInfo });
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

  // An FX-pending item must not be matched or created with an unconverted
  // amount — route it to review now (after the cheap marker-repair check above).
  if (fxPending) return fxPendingItem(item);

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
    // Surface the applied FX rate in the preview's Details (RD-056); the source
    // and target amount columns already show original vs converted.
    message: fxRate ? `FX ${config.fxSourceCurrency}→${config.fxTargetCurrency} @ ${fxRate}` : null,
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
