import { getBudgetFileSyncCapabilities } from "./capabilities";
import "./adapters"; // register all data-type adapters (side-effect)
import { connectionMatchesBudget } from "./connectionRef";
import { decodeFlowPlanConfig, type SyncFlowPlanConfig } from "./flowConfig";
import { generateSyncMarker } from "./marker";
import { getSyncKindAdapter, SyncKindError, type AdapterCreateResult, type SyncKindAdapter } from "./syncKind";
import type { ActualBenchTransport } from "@/lib/actual/transport";
import type { ConnectionInstance } from "@/store/connection";
import type {
  JsonEnvelope,
  JsonObject,
  SyncEntityType,
  SyncFlow,
  SyncFlowRun,
  SyncFlowRunItem,
  SyncMapping,
  SyncMappingInput,
  SyncMappingPatch,
} from "@/lib/app-db/types";
import type { PlannedTargetPayload } from "./plannedChanges";
import type { AdapterMutateInput } from "./syncKind";

/**
 * Headless apply engine for Budget File Sync (RD-053 / PR-019 Slice 4).
 *
 * Takes a persisted `draft_preview` run and applies its safe `new` create
 * candidates to the target budget in Direct mode. It re-validates target-side
 * safety before every create, records a mapping immediately after each success,
 * and reports partial failures cleanly. It never opens the source budget - apply
 * works entirely from the persisted preview payload plus live target lookups.
 *
 * Ports keep the browser transport and server SQLite decoupled, mirroring the
 * Slice 3 orchestrator.
 */

// --- Ports ------------------------------------------------------------------

export type ApplyTransportProvider = {
  openTransport(connection: ConnectionInstance): Promise<ActualBenchTransport>;
};

export type ApplyStore = {
  loadRun(runId: string): Promise<SyncFlowRun | null>;
  loadRunItems(runId: string): Promise<SyncFlowRunItem[]>;
  loadFlow(flowId: string): Promise<SyncFlow | null>;
  getMappingBySource(flowId: string, sourceItemKey: string): Promise<SyncMapping | null>;
  createMapping(input: SyncMappingInput): Promise<void>;
  /** Patch an existing mapping (RD-057: refresh fingerprints, mark disabled/gone). */
  updateMapping(mappingId: string, patch: SyncMappingPatch): Promise<void>;
  updateRunStatus(runId: string, patch: RunStatusPatch): Promise<void>;
  updateRunItemStatus(itemId: string, patch: RunItemStatusPatch): Promise<void>;
  persistApplyFailure(runId: string, error: ApplyError): Promise<void>;
};

export type RunStatusPatch = {
  status: "applying" | "applied" | "partial" | "failed" | "no_changes";
  finishedAt?: string | null;
  counts?: JsonEnvelope;
};

export type RunItemStatusPatch = {
  status: string;
  applyState: "applied" | "failed" | "skipped";
  message?: string | null;
  warnings?: JsonEnvelope | null;
  errors?: JsonEnvelope | null;
  createdTargetTransactionId?: string | null;
  createdTargetMarker?: string | null;
  targetItemRef?: JsonEnvelope | null;
};

// --- Input / result ---------------------------------------------------------

export type ApplySelection =
  | { selectedItemIds: string[] }
  /** Auto-select every new create candidate (RD-053 default). */
  | { selection: "all_safe_new" }
  /**
   * Auto-select every safe item: new create candidates **and** repairable
   * `target_marker_match` rows. Used by RD-054 safe-only automation so an
   * auto run also self-heals a lost DB mapping when the marker already exists
   * on the target (no Actual write for the repair).
   */
  | { selection: "all_safe" }
  /**
   * Re-attempt every item that previously failed on this run (RD-054 retry).
   * Permitted on a partial/failed run, not only a fresh draft preview.
   */
  | { selection: "retry_failed" };

export type ApplySyncRunInput = {
  runId: string;
  targetConnection: ConnectionInstance;
  /** Defaults to all safe `new` create candidates. */
  selection?: ApplySelection;
};

export type ApplyErrorCode =
  | "run_not_found"
  | "run_not_applyable"
  | "flow_not_found"
  | "route_mismatch"
  | "unsupported_connection"
  | "ineligible_selection"
  | "no_eligible_items"
  | "target_open_failed"
  | "finalize_failed";

export type ApplyError = { code: ApplyErrorCode; message: string };

export type ApplyItemOutcome =
  | "applied"
  | "applied_with_warnings"
  | "repaired"
  | "updated"
  | "deleted"
  | "skipped"
  | "failed";

export type ApplyItemResult = {
  itemId: string;
  sourceItemKey: string;
  outcome: ApplyItemOutcome;
  targetTransactionId: string | null;
  changedFields?: string[];
  message?: string;
};

export type ApplyCounts = {
  selected: number;
  applied: number;
  appliedWithWarnings: number;
  repaired: number;
  updated: number;
  deleted: number;
  skipped: number;
  failed: number;
};

export type ApplyRunResult = {
  status: "applied" | "partial" | "failed";
  runId: string;
  error?: ApplyError;
  counts: ApplyCounts;
  items: ApplyItemResult[];
};

class ApplyPreflightError extends Error {
  constructor(public readonly code: ApplyErrorCode, message: string) {
    super(message);
    this.name = "ApplyPreflightError";
  }
  toError(): ApplyError {
    return { code: this.code, message: this.message };
  }
}

const EMPTY_COUNTS: ApplyCounts = {
  selected: 0,
  applied: 0,
  appliedWithWarnings: 0,
  repaired: 0,
  updated: 0,
  deleted: 0,
  skipped: 0,
  failed: 0,
};

// --- Orchestration ----------------------------------------------------------

export async function applySyncRun(
  input: ApplySyncRunInput,
  deps: { transport: ApplyTransportProvider; store: ApplyStore }
): Promise<ApplyRunResult> {
  const { runId } = input;

  let prepared: PreparedApply;
  try {
    prepared = await validateAndPrepare(input, deps.store);
  } catch (err) {
    if (err instanceof ApplyPreflightError) {
      return { status: "failed", runId, error: err.toError(), counts: { ...EMPTY_COUNTS }, items: [] };
    }
    throw err;
  }

  const { config, adapter, flow, eligible } = prepared;
  const counts: ApplyCounts = { ...EMPTY_COUNTS, selected: eligible.length };
  const items: ApplyItemResult[] = [];

  await deps.store.updateRunStatus(runId, { status: "applying" });

  let transport: ActualBenchTransport;
  let markerIndex: Map<string, string>;
  try {
    transport = await deps.transport.openTransport(input.targetConnection);
    // Adapter-specific apply prep (e.g. the target marker index for transactions).
    ({ markerIndex } = await adapter.prepareApply(transport, flow));
  } catch (err) {
    const error: ApplyError = {
      code: "target_open_failed",
      message: describe(err, "Failed to open the target budget for apply."),
    };
    await deps.store.updateRunStatus(runId, { status: "failed", finishedAt: nowIso() });
    await safePersistFailure(deps.store, runId, error);
    return { status: "failed", runId, error, counts, items };
  }

  const ctx: ItemContext = { config, adapter, flow, transport, markerIndex };

  // Repair/map items write nothing, so they stay per-item (cheap). Creates are
  // batched into ONE insert + ONE id-recovery read instead of one round-trip per
  // transaction - the dominant cost on large runs.
  for (const eligibleItem of eligible.filter((e) => e.mode === "repair" || e.mode === "map")) {
    const result = await applyOneItem(eligibleItem, ctx, deps.store);
    items.push(result);
    tally(counts, result.outcome);
  }
  for (const result of await applyCreateBatch(eligible.filter((e) => e.mode === "create"), ctx, deps.store)) {
    items.push(result);
    tally(counts, result.outcome);
  }
  for (const result of await applyMutateBatch("update", eligible.filter((e) => e.mode === "update"), ctx, deps.store)) {
    items.push(result);
    tally(counts, result.outcome);
  }
  for (const result of await applyMutateBatch("delete", eligible.filter((e) => e.mode === "delete"), ctx, deps.store)) {
    items.push(result);
    tally(counts, result.outcome);
  }

  const status = deriveRunStatus(counts);
  // Per-item mappings/statuses are already persisted; a failure to write the
  // final run summary must not throw away the completed work or leave the run
  // stuck "applying" without explanation. Record the finalize error best-effort.
  try {
    await deps.store.updateRunStatus(runId, {
      status,
      finishedAt: nowIso(),
      counts: { version: 1, data: applyCountsToJson(counts) },
    });
  } catch (err) {
    await safePersistFailure(deps.store, runId, {
      code: "finalize_failed",
      message: describe(err, "Apply completed but the run status could not be finalized."),
    });
  }

  return { status, runId, counts, items };
}

// --- Validation / preparation ----------------------------------------------

type ApplyItemMode = "create" | "repair" | "map" | "update" | "delete";

type EligibleItem = {
  item: SyncFlowRunItem;
  mode: ApplyItemMode;
  /** Raw persisted create payload (transaction or entity) for create items. */
  payloadJson: JsonObject | null;
  /** Existing target transaction/entity id for repair/map items; null for create. */
  targetTransactionId: string | null;
};

type PreparedApply = {
  flow: SyncFlow;
  config: SyncFlowPlanConfig;
  adapter: SyncKindAdapter;
  eligible: EligibleItem[];
};

function isEligibleNew(item: SyncFlowRunItem): boolean {
  return (
    item.classification === "new" &&
    item.plannedAction === "create" &&
    item.applyState !== "applied" &&
    item.plannedTargetPayload != null
  );
}

/** A drifted item the flow opted to push to its mapped target (RD-057 §4). */
function isEligibleUpdate(item: SyncFlowRunItem): boolean {
  return (
    item.classification === "source_changed_since_sync" &&
    item.plannedAction === "update" &&
    item.applyState !== "applied" &&
    item.plannedTargetPayload != null &&
    readTargetTxnId(item) != null
  );
}

/** A source-deleted item whose target still exists (RD-057 §5), review-first. */
function isEligibleDelete(item: SyncFlowRunItem): boolean {
  return (
    item.classification === "source_missing" &&
    item.plannedAction === "delete" &&
    item.applyState !== "applied" &&
    readTargetTxnId(item) != null
  );
}

function toMutateCandidate(item: SyncFlowRunItem, mode: "update" | "delete"): EligibleItem {
  const payloadJson = (item.plannedTargetPayload?.data as JsonObject | undefined) ?? null;
  return { item, mode, payloadJson, targetTransactionId: readTargetTxnId(item) };
}

function itemHasFlag(item: SyncFlowRunItem, flag: string): boolean {
  const flags = (item.warnings?.data as { flags?: unknown } | undefined)?.flags;
  return Array.isArray(flags) && flags.includes(flag);
}

/** An exact duplicate the flow opted to auto-map to its existing target (no write). */
function isExactDupAutoMap(item: SyncFlowRunItem): boolean {
  return (
    item.classification === "exact_duplicate" &&
    itemHasFlag(item, "exact_duplicate_auto_map") &&
    readTargetTxnId(item) != null
  );
}

/**
 * A repairable item whose target id was resolved at preview: a transaction
 * marker match, or a master-data entity name match (RD-055). Both record a
 * mapping to the existing target without a write.
 */
function isRepairable(item: SyncFlowRunItem): boolean {
  return (
    (item.classification === "target_marker_match" || item.classification === "target_name_match") &&
    readTargetTxnId(item) != null
  );
}

function readTargetTxnId(item: SyncFlowRunItem): string | null {
  const data = item.targetItemRef?.data as Record<string, unknown> | undefined;
  const id = data?.targetTransactionId;
  if (typeof id === "string") return id;
  return item.createdTargetTransactionId ?? null;
}

function readPayload(item: SyncFlowRunItem): PlannedTargetPayload | null {
  const data = item.plannedTargetPayload?.data as Record<string, unknown> | undefined;
  if (!data) return null;
  const accountId = typeof data.accountId === "string" ? data.accountId : "";
  const date = typeof data.date === "string" ? data.date : "";
  const amount = typeof data.amount === "number" ? data.amount : NaN;
  if (!accountId || !date || !Number.isFinite(amount)) return null;
  return {
    accountId,
    date,
    amount,
    payeeId: typeof data.payeeId === "string" ? data.payeeId : null,
    payeeName: typeof data.payeeName === "string" ? data.payeeName : null,
    categoryId: typeof data.categoryId === "string" ? data.categoryId : null,
    notes: typeof data.notes === "string" ? data.notes : null,
    cleared: data.cleared === true,
    importedId: typeof data.importedId === "string" ? data.importedId : null,
  };
}

async function validateAndPrepare(
  input: ApplySyncRunInput,
  store: ApplyStore
): Promise<PreparedApply> {
  const isRetry =
    !!input.selection && "selection" in input.selection && input.selection.selection === "retry_failed";

  const run = await store.loadRun(input.runId);
  if (!run) throw new ApplyPreflightError("run_not_found", `Run ${input.runId} was not found.`);
  // A retry may run on a partial/failed run; a normal apply only on a fresh draft.
  const applyableStatuses = isRetry ? ["draft_preview", "partial", "failed"] : ["draft_preview"];
  if (!applyableStatuses.includes(run.status)) {
    throw new ApplyPreflightError(
      "run_not_applyable",
      isRetry
        ? `Run is ${run.status}; only partial/failed runs can be retried.`
        : `Run is ${run.status}; only draft_preview runs can be applied.`
    );
  }
  if (!run.flowId) throw new ApplyPreflightError("flow_not_found", "Run has no associated flow.");

  const flow = await store.loadFlow(run.flowId);
  if (!flow) throw new ApplyPreflightError("flow_not_found", `Flow ${run.flowId} was not found.`);

  const adapter = getSyncKindAdapter(flow.flowType);
  if (!adapter) {
    throw new ApplyPreflightError("route_mismatch", `Unsupported sync type: ${flow.flowType}.`);
  }
  const config = decodeFlowPlanConfig(flow);

  // Direct-only support gate first - an unsupported mode can never apply,
  // regardless of route. (Create-capability checks come after eligibility.)
  const caps = getBudgetFileSyncCapabilities({ mode: input.targetConnection.mode });
  if (!caps.supported) {
    throw new ApplyPreflightError("unsupported_connection", caps.reason ?? "Target connection is unsupported.");
  }

  // Match the target on its budget id (stable across mode/URL), not the full
  // fingerprint, so a flow built in one mode also applies in the other.
  if (config.targetBudgetId && !connectionMatchesBudget(input.targetConnection, config.targetBudgetId)) {
    throw new ApplyPreflightError("route_mismatch", "Target connection is not the budget this flow was saved for.");
  }

  const allItems = await store.loadRunItems(input.runId);
  const byId = new Map(allItems.map((item) => [item.id, item]));

  // Resolve each selected item to a create or repair candidate. Explicit
  // selection may include target_marker_match rows (repair). Bulk modes:
  //   "all_safe_new" (and undefined) → new create candidates only;
  //   "all_safe"                     → new creates + repairable marker matches.
  const eligible: EligibleItem[] = [];
  if (input.selection && "selectedItemIds" in input.selection) {
    for (const id of input.selection.selectedItemIds) {
      const item = byId.get(id);
      if (!item) {
        throw new ApplyPreflightError("ineligible_selection", `Selected item ${id} does not belong to this run.`);
      }
      if (isEligibleNew(item)) {
        eligible.push(toCreateCandidate(item));
      } else if (isRepairable(item)) {
        eligible.push({ item, mode: "repair", payloadJson: null, targetTransactionId: readTargetTxnId(item) });
      } else if (isExactDupAutoMap(item)) {
        eligible.push({ item, mode: "map", payloadJson: null, targetTransactionId: readTargetTxnId(item) });
      } else if (isEligibleUpdate(item)) {
        eligible.push(toMutateCandidate(item, "update"));
      } else if (isEligibleDelete(item)) {
        eligible.push(toMutateCandidate(item, "delete"));
      } else {
        throw new ApplyPreflightError("ineligible_selection", `Selected item ${id} is not an applyable create, repair, map, update, or delete candidate.`);
      }
    }
  } else if (isRetry) {
    // Re-attempt only items that previously failed, routed to their normal mode.
    for (const item of allItems) {
      if (item.applyState !== "failed") continue;
      if (isEligibleNew(item)) eligible.push(toCreateCandidate(item));
      else if (isRepairable(item)) eligible.push({ item, mode: "repair", payloadJson: null, targetTransactionId: readTargetTxnId(item) });
      else if (isExactDupAutoMap(item)) eligible.push({ item, mode: "map", payloadJson: null, targetTransactionId: readTargetTxnId(item) });
      else if (isEligibleUpdate(item)) eligible.push(toMutateCandidate(item, "update"));
      else if (isEligibleDelete(item)) eligible.push(toMutateCandidate(item, "delete"));
    }
  } else {
    const includeRepairs = input.selection?.selection === "all_safe";
    // A manual apply (default / all_safe_new) pushes opted-in drift updates; the
    // "all_safe" automation path never overwrites, and deletes are always
    // review-first (explicit selection only) - so neither is included here.
    const includeUpdates = input.selection?.selection !== "all_safe";
    for (const item of allItems) {
      if (isEligibleNew(item)) {
        eligible.push(toCreateCandidate(item));
      } else if (includeRepairs && isRepairable(item)) {
        eligible.push({ item, mode: "repair", payloadJson: null, targetTransactionId: readTargetTxnId(item) });
      } else if (includeRepairs && isExactDupAutoMap(item)) {
        eligible.push({ item, mode: "map", payloadJson: null, targetTransactionId: readTargetTxnId(item) });
      } else if (includeUpdates && isEligibleUpdate(item)) {
        eligible.push(toMutateCandidate(item, "update"));
      }
    }
  }

  if (eligible.length === 0) {
    throw new ApplyPreflightError("no_eligible_items", "No eligible create or repair candidates were selected.");
  }

  // Write-capability gate only matters when we actually create (repair/map write
  // no Actual entity - they only record a mapping to an existing target).
  const willCreate = eligible.some((e) => e.mode === "create");
  try {
    adapter.assertCanApply(caps.capabilities, willCreate);
  } catch (err) {
    if (err instanceof SyncKindError) throw new ApplyPreflightError("unsupported_connection", err.message);
    throw err;
  }

  // Update/delete need both the target capability and an adapter that implements
  // the mutation (RD-057). Fail fast with a clear reason if either is missing.
  if (eligible.some((e) => e.mode === "update")) {
    if (!caps.capabilities.updateTransaction) {
      throw new ApplyPreflightError("unsupported_connection", "Target connection cannot update existing transactions.");
    }
    if (!adapter.updateBatch) {
      throw new ApplyPreflightError("ineligible_selection", "This sync type does not support updating targets.");
    }
  }
  if (eligible.some((e) => e.mode === "delete")) {
    if (!caps.capabilities.deleteTransaction) {
      throw new ApplyPreflightError("unsupported_connection", "Target connection cannot delete transactions.");
    }
    if (!adapter.deleteBatch) {
      throw new ApplyPreflightError("ineligible_selection", "This sync type does not support deleting targets.");
    }
  }

  return { flow, config, adapter, eligible };
}

function toCreateCandidate(item: SyncFlowRunItem): EligibleItem {
  // The persisted create payload (transaction has an imported_id; entity has a
  // name). The planner already blocked transaction items lacking a marker, so no
  // marker check is needed here - the adapter's createBatch consumes the JSON.
  const payloadJson = (item.plannedTargetPayload?.data as JsonObject | undefined) ?? null;
  if (!payloadJson) {
    throw new ApplyPreflightError("ineligible_selection", `Item ${item.id} has no usable planned payload.`);
  }
  return { item, mode: "create", payloadJson, targetTransactionId: null };
}

// --- Per-item apply ---------------------------------------------------------

type ItemContext = {
  config: SyncFlowPlanConfig;
  adapter: SyncKindAdapter;
  flow: SyncFlow;
  transport: ActualBenchTransport;
  markerIndex: Map<string, string>;
};

/** Repair/map items perform no Actual write; they are applied one at a time. */
async function applyOneItem(
  eligible: EligibleItem,
  ctx: ItemContext,
  store: ApplyStore
): Promise<ApplyItemResult> {
  if (eligible.mode === "map") return mapExactDuplicateItem(eligible, ctx, store);
  return repairOneItem(eligible, ctx, store);
}

/**
 * Apply create candidates as a batch: resolve which items still need a write
 * (skipping already-mapped items and repairing marker hits - no writes), then
 * create the remainder in **one** `createTransactionsForSync` call (one insert +
 * one id-recovery read in the transport) instead of a round-trip per item.
 */
async function applyCreateBatch(
  createItems: EligibleItem[],
  ctx: ItemContext,
  store: ApplyStore
): Promise<ApplyItemResult[]> {
  const results: ApplyItemResult[] = [];
  const toCreate: { item: SyncFlowRunItem; payloadJson: JsonObject; marker: string | null }[] = [];

  // Phase A - no writes: skip already-mapped items; for transactions, repair a
  // lost mapping when the marker is already on the target; queue the rest.
  for (const eligible of createItems) {
    const item = eligible.item;
    const payloadJson = eligible.payloadJson ?? {};
    // Only transaction payloads carry a durable marker; entities are marker-less.
    const marker = typeof payloadJson.importedId === "string" ? payloadJson.importedId : null;
    const base = { itemId: item.id, sourceItemKey: item.sourceItemKey ?? "" };
    try {
      const existingMapping = await store.getMappingBySource(ctx.config.flowId, item.sourceItemKey ?? "");
      if (existingMapping) {
        await store.updateRunItemStatus(item.id, {
          status: "skipped",
          applyState: "skipped",
          message: "Already mapped; skipped to avoid a duplicate.",
        });
        results.push({ ...base, outcome: "skipped", targetTransactionId: existingMapping.targetTransactionId, message: "already mapped" });
        continue;
      }
      const markerHit = marker ? ctx.markerIndex.get(marker) : undefined;
      if (marker && markerHit) {
        await recordMapping(store, ctx.config, item, markerHit, marker, null);
        await store.updateRunItemStatus(item.id, {
          status: "skipped",
          applyState: "skipped",
          message: "Target already has this marker; repaired mapping without creating a duplicate.",
          warnings: flagEnvelope(["target_marker_match_repair"]),
          createdTargetTransactionId: markerHit,
          createdTargetMarker: marker,
        });
        results.push({ ...base, outcome: "repaired", targetTransactionId: markerHit, message: "repaired mapping" });
        continue;
      }
      toCreate.push({ item, payloadJson, marker });
    } catch (err) {
      await store.updateRunItemStatus(item.id, {
        status: "failed",
        applyState: "failed",
        message: describe(err, "Apply failed for this item."),
        errors: envelope({ code: "create_failed", message: describe(err, "unknown error") }),
      });
      results.push({ ...base, outcome: "failed", targetTransactionId: null, message: describe(err, "apply failed") });
    }
  }

  if (toCreate.length === 0) return results;

  // Phase B - the adapter creates the batch (transactions: one insert + one
  // id-recovery read; entities: create payees/categories) and returns per-item ids.
  let created: AdapterCreateResult[];
  try {
    created = await ctx.adapter.createBatch(
      ctx.transport,
      ctx.flow,
      toCreate.map(({ item, payloadJson }) => ({ itemId: item.id, payload: payloadJson }))
    );
  } catch (err) {
    for (const { item } of toCreate) {
      await store.updateRunItemStatus(item.id, {
        status: "failed",
        applyState: "failed",
        message: describe(err, "Batch create failed."),
        errors: envelope({ code: "create_failed", message: describe(err, "unknown error") }),
      });
      results.push({ itemId: item.id, sourceItemKey: item.sourceItemKey ?? "", outcome: "failed", targetTransactionId: null, message: describe(err, "apply failed") });
    }
    return results;
  }
  const resultByItem = new Map(created.map((r) => [r.itemId, r]));

  // Phase C - per created item: verify id, record the mapping, set status.
  for (const { item, marker } of toCreate) {
    const base = { itemId: item.id, sourceItemKey: item.sourceItemKey ?? "" };
    const res = resultByItem.get(item.id);
    const targetId = res?.targetId ?? null;

    if (!targetId) {
      await store.updateRunItemStatus(item.id, {
        status: "failed",
        applyState: "failed",
        message: "Created item could not be resolved on the target.",
        errors: envelope({ code: "unresolved_target_id", marker }),
        createdTargetMarker: marker,
      });
      results.push({ ...base, outcome: "failed", targetTransactionId: null, message: "target id unresolved; the item may exist but was not confirmed" });
      continue;
    }

    const changedFields = res?.changedFields ?? [];
    try {
      // Store the persisted target field hash so a later update can detect a
      // manual edit before overwriting (RD-057 §4).
      await recordMapping(store, ctx.config, item, targetId, marker, res?.targetFingerprint ?? null);
    } catch (err) {
      await store.updateRunItemStatus(item.id, {
        status: "failed",
        applyState: "failed",
        message: describe(err, "Mapping failed after create."),
        errors: envelope({ code: "map_failed", message: describe(err, "unknown error") }),
        createdTargetTransactionId: targetId,
        createdTargetMarker: marker,
      });
      results.push({ ...base, outcome: "failed", targetTransactionId: targetId, message: describe(err, "mapping failed") });
      continue;
    }

    // New live marker on the target - guard later items against duplicating it.
    if (marker) ctx.markerIndex.set(marker, targetId);

    const hasWarnings = changedFields.length > 0;
    await store.updateRunItemStatus(item.id, {
      status: "applied",
      applyState: "applied",
      message: hasWarnings ? "Synced; target rules modified some fields." : "Synced.",
      warnings: hasWarnings ? flagEnvelope(["target_rules_modified"], { changedFields }) : null,
      createdTargetTransactionId: targetId,
      createdTargetMarker: marker,
      targetItemRef: { version: 1, data: { targetTransactionId: targetId } },
    });
    results.push({ ...base, outcome: hasWarnings ? "applied_with_warnings" : "applied", targetTransactionId: targetId, changedFields: hasWarnings ? changedFields : undefined });
  }

  return results;
}

/**
 * Apply update or delete candidates as a batch (RD-057 §4/§5). The adapter
 * re-reads each live target and skips any that was edited outside sync, so a
 * manual edit is never overwritten or deleted. On success the mapping is
 * refreshed (update) or disabled (delete) so a re-run is a clean no-op.
 */
async function applyMutateBatch(
  mode: "update" | "delete",
  mutateItems: EligibleItem[],
  ctx: ItemContext,
  store: ApplyStore
): Promise<ApplyItemResult[]> {
  const results: ApplyItemResult[] = [];
  if (mutateItems.length === 0) return results;
  const batch = mode === "update" ? ctx.adapter.updateBatch : ctx.adapter.deleteBatch;
  if (!batch) return results; // preflight already guarded this; defensive.

  // Resolve each item's mapping (for the expected fingerprint + patch target).
  const meta = new Map<string, { item: SyncFlowRunItem; mapping: SyncMapping | null }>();
  const inputs: AdapterMutateInput[] = [];
  for (const eligible of mutateItems) {
    const item = eligible.item;
    const mapping = await store.getMappingBySource(ctx.config.flowId, item.sourceItemKey ?? "");
    meta.set(item.id, { item, mapping });
    inputs.push({
      itemId: item.id,
      targetId: eligible.targetTransactionId ?? "",
      expectedTargetFingerprint: mapping?.targetFingerprint ?? null,
      payload: eligible.payloadJson ?? undefined,
    });
  }

  let mutated;
  try {
    mutated = await batch(ctx.transport, ctx.flow, inputs);
  } catch (err) {
    for (const { item } of meta.values()) {
      await store.updateRunItemStatus(item.id, {
        status: "failed",
        applyState: "failed",
        message: describe(err, `Batch ${mode} failed.`),
        errors: envelope({ code: `${mode}_failed`, message: describe(err, "unknown error") }),
      });
      results.push({ itemId: item.id, sourceItemKey: item.sourceItemKey ?? "", outcome: "failed", targetTransactionId: null, message: describe(err, `${mode} failed`) });
    }
    return results;
  }

  for (const res of mutated) {
    const entry = meta.get(res.itemId);
    if (!entry) continue;
    const { item, mapping } = entry;
    const base = { itemId: item.id, sourceItemKey: item.sourceItemKey ?? "" };
    try {
      if (res.outcome === "failed") {
        await store.updateRunItemStatus(item.id, {
          status: "failed",
          applyState: "failed",
          message: res.message ?? `${mode} failed for this item.`,
          errors: envelope({ code: `${mode}_failed`, message: res.message ?? "unknown error" }),
        });
        results.push({ ...base, outcome: "failed", targetTransactionId: res.targetId, message: res.message });
        continue;
      }
      if (res.outcome === "skipped") {
        await store.updateRunItemStatus(item.id, {
          status: "skipped",
          applyState: "skipped",
          message: res.message ?? "Target left unchanged.",
          warnings: flagEnvelope(["target_changed_since_sync"]),
        });
        results.push({ ...base, outcome: "skipped", targetTransactionId: res.targetId, message: res.message });
        continue;
      }
      if (mode === "update") {
        if (mapping) {
          await store.updateMapping(mapping.id, {
            sourceFingerprint: item.sourceFingerprint ?? mapping.sourceFingerprint,
            targetFingerprint: res.targetFingerprint ?? null,
            lastAppliedAt: nowIso(),
          });
        }
        await store.updateRunItemStatus(item.id, {
          status: "updated",
          applyState: "applied",
          message: "Target updated to match the changed source.",
          createdTargetTransactionId: res.targetId,
          targetItemRef: { version: 1, data: { targetTransactionId: res.targetId } },
        });
        results.push({ ...base, outcome: "updated", targetTransactionId: res.targetId });
      } else {
        if (mapping) {
          await store.updateMapping(mapping.id, { status: "disabled", lastAppliedAt: nowIso() });
        }
        await store.updateRunItemStatus(item.id, {
          status: "deleted",
          applyState: "applied",
          message: "Target deleted; source no longer exists.",
          createdTargetTransactionId: res.targetId,
        });
        results.push({ ...base, outcome: "deleted", targetTransactionId: res.targetId });
      }
    } catch (err) {
      await store.updateRunItemStatus(item.id, {
        status: "failed",
        applyState: "failed",
        message: describe(err, `Post-${mode} bookkeeping failed.`),
        errors: envelope({ code: `${mode}_failed`, message: describe(err, "unknown error") }),
      });
      results.push({ ...base, outcome: "failed", targetTransactionId: res.targetId, message: describe(err, `${mode} failed`) });
    }
  }
  return results;
}

async function recordMapping(
  store: ApplyStore,
  config: SyncFlowPlanConfig,
  item: SyncFlowRunItem,
  targetTransactionId: string,
  targetMarker: string | null,
  targetFingerprint: string | null
): Promise<void> {
  const entityType: SyncEntityType = item.sourceEntityType ?? "transaction";
  // Master-data entities map to a same-type target; transactions/splits to a txn.
  const isEntity = entityType === "payee" || entityType === "category" || entityType === "category_group";
  const targetEntityType: SyncEntityType = isEntity ? entityType : "transaction";
  const targetItemKey = isEntity ? `${entityType}:${targetTransactionId}` : "txn:" + targetTransactionId;
  await store.createMapping({
    flowId: config.flowId,
    sourceConnectionFingerprint: config.sourceConnectionFingerprint,
    sourceBudgetId: config.sourceBudgetId,
    sourceAccountId: config.sourceAccountId || null,
    sourceEntityType: entityType,
    sourceTransactionId: item.sourceTransactionId,
    sourceSplitId: item.sourceSplitId,
    sourceItemKey: item.sourceItemKey ?? "",
    sourceFingerprint: item.sourceFingerprint ?? "",
    targetConnectionFingerprint: config.targetConnectionFingerprint,
    targetBudgetId: config.targetBudgetId,
    targetAccountId: config.targetAccountId || null,
    targetEntityType,
    targetTransactionId,
    targetItemKey,
    targetFingerprint,
    targetMarker,
    createdRunId: item.runId,
    lastAppliedAt: nowIso(),
  });
}

/**
 * Repair a lost DB mapping for a `target_marker_match` item: the target already
 * has our deterministic marker, so we map the source item to that existing
 * target transaction - no Actual write, no duplicate.
 */
async function repairOneItem(
  eligible: EligibleItem,
  ctx: ItemContext,
  store: ApplyStore
): Promise<ApplyItemResult> {
  const { item } = eligible;
  const base = { itemId: item.id, sourceItemKey: item.sourceItemKey ?? "" };
  const targetId = eligible.targetTransactionId as string;
  // Transactions carry a deterministic marker to re-validate; entity name matches
  // (target_name_match) do not - the planner already resolved the target id.
  const isNameMatch = item.classification === "target_name_match";
  const marker = isNameMatch
    ? null
    : generateSyncMarker({
        sourceBudgetId: ctx.config.sourceBudgetId,
        targetBudgetId: ctx.config.targetBudgetId,
        targetAccountId: ctx.config.targetAccountId,
        sourceItemKey: item.sourceItemKey ?? "",
      });

  try {
    const existingMapping = await store.getMappingBySource(ctx.config.flowId, item.sourceItemKey ?? "");
    if (existingMapping) {
      await store.updateRunItemStatus(item.id, {
        status: "skipped",
        applyState: "skipped",
        message: "Already mapped; nothing to repair.",
      });
      return { ...base, outcome: "skipped", targetTransactionId: existingMapping.targetTransactionId, message: "already mapped" };
    }

    // Transactions only: repair just when the marker still maps to the previewed
    // target. Entity name matches trust the planner-resolved target id.
    if (!isNameMatch && (!marker || ctx.markerIndex.get(marker) !== targetId)) {
      await store.updateRunItemStatus(item.id, {
        status: "skipped",
        applyState: "skipped",
        message: "Target marker no longer matches; mapping not repaired.",
      });
      return { ...base, outcome: "skipped", targetTransactionId: null, message: "marker no longer present" };
    }

    await recordMapping(store, ctx.config, item, targetId, marker, null);
    await store.updateRunItemStatus(item.id, {
      status: "repaired",
      applyState: "skipped",
      message: "Repaired mapping to the existing target transaction.",
      warnings: flagEnvelope(["target_marker_match_repair"]),
      createdTargetTransactionId: targetId,
      createdTargetMarker: marker,
    });
    return { ...base, outcome: "repaired", targetTransactionId: targetId, message: "repaired mapping" };
  } catch (err) {
    await store.updateRunItemStatus(item.id, {
      status: "failed",
      applyState: "failed",
      message: describe(err, "Repair failed for this item."),
      errors: envelope({ code: "repair_failed", message: describe(err, "unknown error") }),
    });
    return { ...base, outcome: "failed", targetTransactionId: null, message: describe(err, "repair failed") };
  }
}

/**
 * Auto-map an exact-duplicate item to its existing target transaction (RD-054):
 * record a mapping to the previewed target, with no Actual write. Unlike a
 * marker repair there is no sync marker on the target (it is a coincidental
 * match), so existence is re-validated against the live target instead.
 */
async function mapExactDuplicateItem(
  eligible: EligibleItem,
  ctx: ItemContext,
  store: ApplyStore
): Promise<ApplyItemResult> {
  const { item } = eligible;
  const base = { itemId: item.id, sourceItemKey: item.sourceItemKey ?? "" };
  const targetId = eligible.targetTransactionId as string;
  const date = readPayload(item)?.date ?? null;

  try {
    const existingMapping = await store.getMappingBySource(ctx.config.flowId, item.sourceItemKey ?? "");
    if (existingMapping) {
      await store.updateRunItemStatus(item.id, {
        status: "skipped",
        applyState: "skipped",
        message: "Already mapped; nothing to map.",
      });
      return { ...base, outcome: "skipped", targetTransactionId: existingMapping.targetTransactionId, message: "already mapped" };
    }

    // Re-validate the matched target still exists before linking to it.
    const stillPresent = date
      ? (await ctx.transport.listTransactionsForSync({ accountId: ctx.config.targetAccountId, startDate: date, endDate: date })).some((t) => t.id === targetId)
      : false;
    if (!stillPresent) {
      await store.updateRunItemStatus(item.id, {
        status: "skipped",
        applyState: "skipped",
        message: "Exact-duplicate target is no longer present; not mapped.",
      });
      return { ...base, outcome: "skipped", targetTransactionId: null, message: "duplicate target gone" };
    }

    await recordMapping(store, ctx.config, item, targetId, null, null);
    await store.updateRunItemStatus(item.id, {
      status: "mapped",
      applyState: "skipped",
      message: "Mapped to the existing exact-duplicate transaction.",
      warnings: flagEnvelope(["exact_duplicate_auto_mapped"]),
      createdTargetTransactionId: targetId,
    });
    return { ...base, outcome: "repaired", targetTransactionId: targetId, message: "mapped to exact duplicate" };
  } catch (err) {
    await store.updateRunItemStatus(item.id, {
      status: "failed",
      applyState: "failed",
      message: describe(err, "Mapping failed for this item."),
      errors: envelope({ code: "map_failed", message: describe(err, "unknown error") }),
    });
    return { ...base, outcome: "failed", targetTransactionId: null, message: describe(err, "map failed") };
  }
}

// --- Small helpers ----------------------------------------------------------

function tally(counts: ApplyCounts, outcome: ApplyItemOutcome): void {
  if (outcome === "applied") counts.applied += 1;
  else if (outcome === "applied_with_warnings") {
    counts.applied += 1;
    counts.appliedWithWarnings += 1;
  } else if (outcome === "repaired") counts.repaired += 1;
  else if (outcome === "updated") counts.updated += 1;
  else if (outcome === "deleted") counts.deleted += 1;
  else if (outcome === "skipped") counts.skipped += 1;
  else counts.failed += 1;
}

function deriveRunStatus(counts: ApplyCounts): "applied" | "partial" | "failed" {
  if (counts.failed === 0) return "applied";
  if (counts.applied + counts.repaired + counts.updated + counts.deleted > 0) return "partial";
  return "failed";
}

function applyCountsToJson(counts: ApplyCounts): JsonObject {
  return { ...counts };
}

function flagEnvelope(flags: string[], extra: JsonObject = {}): JsonEnvelope {
  return { version: 1, data: { flags: [...flags], ...extra } };
}

function envelope(data: JsonObject): JsonEnvelope {
  return { version: 1, data };
}

function describe(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message;
  // Server-side HTTP calls throw a structured ApiError object (not an Error
  // instance); without this its real message was lost and callers saw only the
  // generic fallback (e.g. "target_open_failed" with no HTTP reason).
  if (err && typeof err === "object" && "message" in err) {
    const message = (err as { message?: unknown }).message;
    if (typeof message === "string" && message) return message;
  }
  return fallback;
}

function nowIso(): string {
  return new Date().toISOString();
}

async function safePersistFailure(store: ApplyStore, runId: string, error: ApplyError): Promise<void> {
  try {
    await store.persistApplyFailure(runId, error);
  } catch {
    // best-effort audit only
  }
}
