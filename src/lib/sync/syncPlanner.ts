import { classifyDuplicate } from "./duplicateClassifier";
import { createFxRateResolver } from "./fxPolicy";
import { isRevaluationKey } from "./fxPosition";
import { resolveCategory, resolvePayee } from "./entityResolution";
import { generateSyncMarker } from "./marker";
import { allKeysOf, expandSourceTransactions, sourceTransactionItemKey, type SyncSourceItem } from "./sourceItems";
import { buildPlannedTargetPayload } from "./transform";
import { convertMinorUnits } from "@/lib/fx/fxMath";
import type {
  SyncDuplicateConfidence,
  SyncEntityType,
  SyncItemClassification,
  SyncMapping,
} from "@/lib/app-db/types";
import type {
  FxRateInfo,
  PlannedTargetPayload,
  SyncPlanFlag,
  SyncPlannedAction,
  SyncPlannedItem,
  SyncPlannerInput,
  SyncPlanResult,
  SyncTargetTransactionForDedupe,
} from "./plannedChanges";

/** Lookups built once per plan, so each row costs a map read instead of a scan. */
type PlanContext = {
  /** Target rows by `date:amount`, the only ones a duplicate check can match. */
  targetsByDateAmount: Map<string, SyncTargetTransactionForDedupe[]>;
  targetById: Map<string, SyncTargetTransactionForDedupe>;
  /** Target rows already linked to a source row; they cannot be another row's duplicate. */
  claimedTargetIds: Set<string>;
  /** Parent ids synced as separate split lines. */
  explodedParentIds: Set<string>;
  /** The flow's rate for one row: its policy and bank fee applied. */
  rateFor: (date: string, sourceAmount: number) => FxRateInfo | null;
};

const dateAmountKey = (date: string, amount: number) => `${date}:${amount}`;

function buildPlanContext(
  input: Pick<SyncPlannerInput, "config" | "target" | "existingMappings" | "fxRateByDate" | "fxToday"> & { sourceItems: SyncSourceItem[] }
): PlanContext {
  const targetsByDateAmount = new Map<string, SyncTargetTransactionForDedupe[]>();
  const targetById = new Map<string, SyncTargetTransactionForDedupe>();
  for (const txn of input.target.transactions) {
    targetById.set(txn.id, txn);
    const key = dateAmountKey(txn.date, txn.amount);
    const rows = targetsByDateAmount.get(key);
    if (rows) rows.push(txn);
    else targetsByDateAmount.set(key, [txn]);
  }
  const claimedTargetIds = new Set<string>();
  const explodedParentIds = new Set<string>();
  for (const mapping of input.existingMappings) {
    if (mapping.targetTransactionId) claimedTargetIds.add(mapping.targetTransactionId);
    if (mapping.sourceEntityType === "split_line" && mapping.sourceTransactionId) {
      explodedParentIds.add(mapping.sourceTransactionId);
    }
  }
  // A target carrying one of this plan's markers belongs to that source item, even
  // when the item comes later in the list than a row that looks like its duplicate.
  for (const item of input.sourceItems) {
    for (const sourceItemKey of allKeysOf(item)) {
      const marker = generateSyncMarker({
        sourceBudgetId: input.config.sourceBudgetId,
        targetBudgetId: input.config.targetBudgetId,
        targetAccountId: input.config.targetAccountId,
        sourceItemKey,
      });
      const targetId = marker ? input.target.importedIdIndex.get(marker) : undefined;
      if (targetId) claimedTargetIds.add(targetId);
    }
  }
  return {
    targetsByDateAmount,
    targetById,
    claimedTargetIds,
    explodedParentIds,
    rateFor: createFxRateResolver(input.config, input.fxRateByDate, input.fxToday),
  };
}

/**
 * Headless dry-run planner for Cross Budget Sync (RD-053 / PR-019 Slice 2).
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

  const context = buildPlanContext(input);
  const items = input.sourceItems.map((sourceItem) =>
    planSourceItem(withExistingKey(sourceItem, input, mappingByKey), input, mappingByKey, canWriteMarker, context)
  );

  // RD-057 §5: an active mapping whose source item no longer exists means the
  // source transaction was deleted. Surfaced only when the flow opts in, as
  // review-first delete candidates the user must select.
  if (input.detectDeletedSource) {
    const presentKeys = input.presentSourceKeys ?? new Set(input.sourceItems.map((item) => item.itemKey));
    for (const mapping of input.existingMappings) {
      if (mapping.status !== "active") continue;
      // A revaluation entry has no source transaction to go missing.
      if (isRevaluationKey(mapping.sourceItemKey)) continue;
      if (presentKeys.has(mapping.sourceItemKey)) continue;
      // A positional split key embeds the line's content, so an edit changes it.
      // Only the parent's existence can say whether that line was really deleted.
      if (mapping.sourceEntityType === "split_line" && !mapping.sourceSplitId && mapping.sourceTransactionId && presentKeys.has(sourceTransactionItemKey(mapping.sourceTransactionId))) continue;
      items.push(deletedSourceItem(mapping));
    }
  }

  const counts: Record<string, number> = {};
  for (const item of items) {
    counts[item.classification] = (counts[item.classification] ?? 0) + 1;
  }

  return { flowId: config.flowId, items, counts };
}

/**
 * A split line with no stable id may already be synced under another of its
 * positional keys (its cleared state has changed). Keep that key and its marker,
 * so the line is recognised instead of being created again. If the keys point at
 * different target rows, nothing can say which is right, and the line is held.
 */
function withExistingKey(
  item: SyncSourceItem,
  input: Pick<SyncPlannerInput, "config" | "target">,
  mappingByKey: Map<string, SyncMapping>
): SyncSourceItem {
  if (!item.keyAliases) return item;
  const { config, target } = input;
  const matches: { key: string; targetId: string | null }[] = [];
  for (const key of new Set([item.itemKey, ...item.keyAliases])) {
    const mapped = mappingByKey.get(key);
    if (mapped) {
      matches.push({ key, targetId: mapped.targetTransactionId });
      continue;
    }
    const marker = generateSyncMarker({
      sourceBudgetId: config.sourceBudgetId,
      targetBudgetId: config.targetBudgetId,
      targetAccountId: config.targetAccountId,
      sourceItemKey: key,
    });
    const markedId = marker ? target.importedIdIndex.get(marker) : undefined;
    if (markedId) matches.push({ key, targetId: markedId });
  }
  if (matches.length === 0) return item;
  if (new Set(matches.map((match) => match.targetId)).size > 1) return { ...item, identityConflict: true };
  const current = matches.find((match) => match.key === item.itemKey);
  return { ...item, itemKey: (current ?? matches[0]).key };
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

/**
 * An already-synced item whose FX rate changed since sync → an opt-in `update`
 * candidate that rewrites the target amount (RD-056). Returns null when FX
 * updates are off, no rate is available, the item is a grouped split, or the
 * target already holds the current converted amount. Apply re-checks the target
 * wasn't hand-edited before overwriting.
 */
function fxRateChangeUpdate(
  item: SyncSourceItem,
  input: Pick<SyncPlannerInput, "config" | "target">,
  mapping: SyncMapping,
  fxInfo: FxRateInfo | null,
  fxRate: string | null,
  context: PlanContext
): SyncPlannedItem | null {
  const { config } = input;
  if (!config.fxUpdateOnRateChange || !fxRate || !fxInfo || !mapping.targetTransactionId) return null;

  const directedParent = config.amountDirection === "same" ? item.amount : -item.amount;
  const currentConverted = convertMinorUnits(directedParent, fxRate);
  const targetTxn = context.targetById.get(mapping.targetTransactionId);
  if (!targetTxn || targetTxn.amount === currentConverted) return null;

  const { payload: built } = buildCreatePayload(item, input, fxInfo);
  const payload = { ...built, keepTargetPayee: !!item.isTransfer };
  return baseItem(item, {
    classification: "source_changed_since_sync",
    action: "update",
    flags: ["source_changed_update", "fx_rate_changed"],
    selectedForApply: true,
    plannedTargetPayload: payload,
    targetTransactionId: mapping.targetTransactionId,
    message: `Exchange rate changed for ${item.date} (now ${fxRate}); the target amount will be updated.`,
  });
}

/** A blocked item awaiting an FX rate (RD-056), routed to review. */
function fxPendingItem(item: SyncSourceItem, reason?: string): SyncPlannedItem {
  return baseItem(item, {
    classification: "blocked",
    action: "blocked",
    flags: ["fx_rate_pending"],
    message: reason ?? `No FX rate available for ${item.date}; item is awaiting a rate.`,
  });
}

const transferNote = (name: string | null | undefined, notes: string | null) => {
  const label = name ? `Transfer: ${name}` : "Transfer";
  return notes?.trim() ? `${label} - ${notes.trim()}` : label;
};

/**
 * A source transfer is one leg of a pair inside the source budget. If its payee
 * resolved to a transfer payee on the target, Actual would create a counterpart
 * leg there, and syncing the other leg would then double it. It is written with
 * no payee and the other side named in its notes.
 */
function withoutTransferPayee(item: SyncSourceItem): SyncSourceItem {
  if (!item.isTransfer) return item;
  return { ...item, payeeId: null, payeeName: null, notes: transferNote(item.payeeName, item.notes) };
}

/** The target payload for creating this item, with grouped-split children resolved. */
function buildCreatePayload(
  sourceItem: SyncSourceItem,
  input: Pick<SyncPlannerInput, "config" | "target">,
  fxInfo: FxRateInfo | null
) {
  const { config, target } = input;
  const item = withoutTransferPayee(sourceItem);
  const fxRate = fxInfo?.rate ?? null;
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
    const childPayee = line.transferId
      ? resolvePayee({ payeeName: null }, config, target.payees)
      : resolvePayee({ payeeName: line.payeeName ?? item.payeeName }, config, target.payees);
    const childCategory = resolveCategory({ categoryName: line.categoryName }, target.categories);
    const directedChild = config.amountDirection === "same" ? line.amount : -line.amount;
    return {
      amount: fxRate ? convertMinorUnits(directedChild, fxRate) : directedChild,
      categoryId: childCategory.categoryId,
      payeeId: childPayee.payeeId,
      payeeName: childPayee.payeeName,
      notes: line.transferId ? transferNote(line.payeeName, line.notes) : line.notes,
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
  return { payee, category, importedId, payload };
}

/** True when this item's split shape differs from how the split was first synced. */
function splitModeChanged(item: SyncSourceItem, mappingByKey: Map<string, SyncMapping>, context: PlanContext): boolean {
  if (item.kind === "split_line") return mappingByKey.has(sourceTransactionItemKey(item.sourceTransactionId));
  return !!item.splitLines?.length && context.explodedParentIds.has(item.sourceTransactionId);
}

function planSourceItem(
  item: SyncSourceItem,
  input: Pick<SyncPlannerInput, "config" | "target" | "fxRateByDate" | "fxPendingByDate" | "manualFxRates">,
  mappingByKey: Map<string, SyncMapping>,
  canWriteMarker: boolean,
  context: PlanContext
): SyncPlannedItem {
  const { config, target } = input;

  if (item.identityConflict) {
    return baseItem(item, {
      classification: "blocked",
      action: "blocked",
      flags: ["ambiguous_split_identity"],
      message: "This split line matches more than one transaction on the target. Check them before syncing it.",
    });
  }

  // FX conversion (RD-056): resolve this item's rate. A cross-currency item with
  // no rate for its date is "pending" and routed to review before it could be
  // matched/created with an unconverted amount.
  const needsFx = config.fxEnabled && config.fxSourceCurrency !== config.fxTargetCurrency;
  // A synced row keeps the rate it was recorded with. One the user set keeps it
  // always; any other keeps it while its date stands, unless the flow opted into
  // following rate changes. A note edit must not re-convert the amount.
  const recorded = needsFx ? input.manualFxRates?.get(mappingByKey.get(item.itemKey)?.targetTransactionId ?? "") : undefined;
  const manualRate = recorded?.isManual !== false ? recorded : undefined;
  const lockedRate = recorded && !manualRate && recorded.requestedDate === item.date && !config.fxUpdateOnRateChange ? recorded : undefined;
  const keptRate = manualRate ?? lockedRate;
  const fxInfo: FxRateInfo | null = !needsFx
    ? null
    : keptRate
      ? {
          rate: keptRate.rate,
          effectiveDate: keptRate.effectiveDate,
          source: keptRate.source ?? "manual",
          provider: keptRate.provider ?? null,
          fxRateId: keptRate.fxRateId ?? null,
          ...(manualRate ? { isManual: true } : {}),
        }
      : context.rateFor(item.date, item.amount);
  const fxRate = fxInfo?.rate ?? null;
  const fxPending = needsFx && fxInfo == null;
  const fxPendingReason = input.fxPendingByDate?.get(item.date);

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
    // The target was deleted: nothing can be updated, and the budgets now differ.
    if (mapping.targetTransactionId && target.allTransactionIds && !target.allTransactionIds.has(mapping.targetTransactionId)) {
      if (fxPending) return fxPendingItem(item, fxPendingReason);
      const { importedId, payload } = buildCreatePayload(item, input, fxInfo);
      const canRecreate = canWriteMarker && !!importedId;
      return baseItem(item, {
        classification: "target_missing",
        action: canRecreate ? "create" : "skip",
        flags: ["target_missing_review"],
        plannedTargetPayload: canRecreate ? payload : null,
        targetTransactionId: mapping.targetTransactionId,
        message: "Deleted from the target budget. Select it to recreate, or stop syncing it.",
      });
    }
    if (mapping.sourceFingerprint === item.fingerprint || item.legacyFingerprints?.includes(mapping.sourceFingerprint)) {
      // The source is unchanged, but the FX rate may have been corrected since
      // sync. When the flow opts in, offer to update the target amount (RD-056).
      const fxUpdate = manualRate ? null : fxRateChangeUpdate(item, input, mapping, fxInfo, fxRate, context);
      if (fxUpdate) return fxUpdate;
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
    // the target was not edited outside sync before overwriting. A grouped split
    // carries its lines, so the update can rewrite them too.
    if (config.updateMappedTargets && mapping.targetTransactionId) {
      if (fxPending) return fxPendingItem(item, fxPendingReason);
      const { payload: builtUpdate } = buildCreatePayload(item, input, fxInfo);
      const upPayload = { ...builtUpdate, keepTargetPayee: !!item.isTransfer };
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

  // The flow's split setting changed after this split was synced. Creating it in
  // the new shape would sit beside the rows already on the target.
  if (splitModeChanged(item, mappingByKey, context)) {
    return baseItem(item, {
      classification: "blocked",
      action: "blocked",
      flags: ["split_mode_changed"],
      message: "Already synced with the other split setting; creating it again would duplicate it.",
    });
  }

  // Resolve entities + build the intended payload/marker up front.
  const { payee, category, importedId, payload } = buildCreatePayload(item, input, fxInfo);
  const effectivePayeeName = resolveEffectivePayeeName(item, payee, target);

  // 2. No mapping, but our marker already exists on the target → repairable.
  if (importedId && target.importedIdIndex.has(importedId)) {
    return baseItem(item, {
      classification: "target_marker_match",
      action: "skip",
      flags: ["target_marker_match_repair"],
      // Carried so the repair can restore the FX record; a repair writes no row.
      plannedTargetPayload: payload,
      targetTransactionId: target.importedIdIndex.get(importedId) ?? null,
      message: "Target already has a matching sync marker; mapping can be repaired.",
    });
  }

  // An FX-pending item must not be matched or created with an unconverted
  // amount — route it to review now (after the cheap marker-repair check above).
  if (fxPending) return fxPendingItem(item, fxPendingReason);

  // 3. Duplicate heuristic (skipped by default when uncertain).
  const { confidence, targetTransactionId: dupTargetId } = classifyDuplicate(
    payload,
    (context.targetsByDateAmount.get(dateAmountKey(payload.date, payload.amount)) ?? []).filter((txn) => !context.claimedTargetIds.has(txn.id)),
    effectivePayeeName
  );
  if (confidence !== "none") {
    // Exact duplicates can be auto-mapped to the existing target when the flow
    // opts in: record a mapping (no write), instead of routing to review. Fuzzy
    // (strong/weak) duplicates always stay review-required.
    if (confidence === "exact" && config.exactDuplicateAutoMap && dupTargetId) {
      // One target row can stand in for one source row only.
      context.claimedTargetIds.add(dupTargetId);
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
  if (item.isTransfer) flags.push("source_transfer");

  return baseItem(item, {
    classification: "new",
    action: "create",
    flags,
    selectedForApply: true,
    plannedTargetPayload: payload,
    // Surface the applied FX rate in the preview's Details (RD-056); the source
    // and target amount columns already show original vs converted.
    message: fxRate
      ? `FX ${config.fxSourceCurrency}→${config.fxTargetCurrency} @ ${fxRate}${item.isTransfer ? " · source transfer, created without a transfer payee" : ""}`
      : item.isTransfer
        ? "Transfer in the source budget; created without a transfer payee."
        : null,
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
