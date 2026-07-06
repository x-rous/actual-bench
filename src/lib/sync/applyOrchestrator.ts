import { getBudgetFileSyncCapabilities } from "./capabilities";
import { connectionFingerprint } from "./connectionRef";
import { decodeFlowPlanConfig, type SyncFlowPlanConfig } from "./flowConfig";
import { transactionFingerprint } from "./sourceItems";
import type {
  ActualBenchTransport,
  SyncTargetTransactionInput,
} from "@/lib/actual/transport";
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
} from "@/lib/app-db/types";
import type { PlannedTargetPayload } from "./plannedChanges";

/**
 * Headless apply engine for Budget File Sync (RD-053 / PR-019 Slice 4).
 *
 * Takes a persisted `draft_preview` run and applies its safe `new` create
 * candidates to the target budget in Direct mode. It re-validates target-side
 * safety before every create, records a mapping immediately after each success,
 * and reports partial failures cleanly. It never opens the source budget — apply
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
  updateRunStatus(runId: string, patch: RunStatusPatch): Promise<void>;
  updateRunItemStatus(itemId: string, patch: RunItemStatusPatch): Promise<void>;
  persistApplyFailure(runId: string, error: ApplyError): Promise<void>;
};

export type RunStatusPatch = {
  status: "applying" | "applied" | "partial" | "failed";
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
  | { selection: "all_safe_new" };

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
  | "target_open_failed";

export type ApplyError = { code: ApplyErrorCode; message: string };

export type ApplyItemOutcome =
  | "applied"
  | "applied_with_warnings"
  | "repaired"
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

  const { config, eligible } = prepared;
  const counts: ApplyCounts = { ...EMPTY_COUNTS, selected: eligible.length };
  const items: ApplyItemResult[] = [];

  await deps.store.updateRunStatus(runId, { status: "applying" });

  let transport: ActualBenchTransport;
  let markerIndex: Map<string, string>;
  try {
    transport = await deps.transport.openTransport(input.targetConnection);
    // Fresh target marker index for stale-preview revalidation.
    const lookup = await transport.getTargetLookupForSync({ accountId: config.targetAccountId });
    markerIndex = lookup.importedIdIndex;
  } catch (err) {
    const error: ApplyError = {
      code: "target_open_failed",
      message: describe(err, "Failed to open the target budget for apply."),
    };
    await deps.store.updateRunStatus(runId, { status: "failed", finishedAt: nowIso() });
    await safePersistFailure(deps.store, runId, error);
    return { status: "failed", runId, error, counts, items };
  }

  // Writes to the same target are serialized (single-runtime, deterministic).
  for (const item of eligible) {
    const result = await applyOneItem(item, { config, transport, markerIndex }, deps.store);
    items.push(result);
    tally(counts, result.outcome);
    // A create adds a live marker; guard against intra-run duplicates.
    if (result.outcome !== "failed" && result.targetTransactionId && item.payload.importedId) {
      markerIndex.set(item.payload.importedId, result.targetTransactionId);
    }
  }

  const status = deriveRunStatus(counts);
  await deps.store.updateRunStatus(runId, {
    status,
    finishedAt: nowIso(),
    counts: { version: 1, data: applyCountsToJson(counts) },
  });

  return { status, runId, counts, items };
}

// --- Validation / preparation ----------------------------------------------

type EligibleItem = {
  item: SyncFlowRunItem;
  payload: PlannedTargetPayload;
};

type PreparedApply = {
  flow: SyncFlow;
  config: SyncFlowPlanConfig;
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
  const run = await store.loadRun(input.runId);
  if (!run) throw new ApplyPreflightError("run_not_found", `Run ${input.runId} was not found.`);
  if (run.status !== "draft_preview") {
    throw new ApplyPreflightError("run_not_applyable", `Run is ${run.status}; only draft_preview runs can be applied.`);
  }
  if (!run.flowId) throw new ApplyPreflightError("flow_not_found", "Run has no associated flow.");

  const flow = await store.loadFlow(run.flowId);
  if (!flow) throw new ApplyPreflightError("flow_not_found", `Flow ${run.flowId} was not found.`);

  const config = decodeFlowPlanConfig(flow);
  if (!config.targetAccountId) {
    throw new ApplyPreflightError("route_mismatch", "Flow has no target account.");
  }

  // Direct-only support gate first — an unsupported mode can never apply,
  // regardless of route. (Create/payee capability checks come after eligibility.)
  const caps = getBudgetFileSyncCapabilities({ mode: input.targetConnection.mode });
  if (!caps.supported) {
    throw new ApplyPreflightError("unsupported_connection", caps.reason ?? "Target connection is unsupported.");
  }

  if (
    config.targetConnectionFingerprint &&
    connectionFingerprint(input.targetConnection) !== config.targetConnectionFingerprint
  ) {
    throw new ApplyPreflightError("route_mismatch", "Target connection does not match the flow's saved route.");
  }

  const allItems = await store.loadRunItems(input.runId);
  const byId = new Map(allItems.map((item) => [item.id, item]));

  let candidates: SyncFlowRunItem[];
  if (input.selection && "selectedItemIds" in input.selection) {
    candidates = [];
    for (const id of input.selection.selectedItemIds) {
      const item = byId.get(id);
      if (!item) {
        throw new ApplyPreflightError("ineligible_selection", `Selected item ${id} does not belong to this run.`);
      }
      if (!isEligibleNew(item)) {
        throw new ApplyPreflightError("ineligible_selection", `Selected item ${id} is not an applyable create candidate.`);
      }
      candidates.push(item);
    }
  } else {
    // Default / "all_safe_new": every eligible new create candidate.
    candidates = allItems.filter(isEligibleNew);
  }

  const eligible: EligibleItem[] = [];
  for (const item of candidates) {
    const payload = readPayload(item);
    if (!payload) {
      throw new ApplyPreflightError("ineligible_selection", `Item ${item.id} has no usable planned payload.`);
    }
    if (!payload.importedId) {
      // No deterministic marker ⇒ never create (idempotency guarantee).
      throw new ApplyPreflightError("ineligible_selection", `Item ${item.id} has no imported_id marker; refusing to create.`);
    }
    eligible.push({ item, payload });
  }

  if (eligible.length === 0) {
    throw new ApplyPreflightError("no_eligible_items", "No eligible create candidates were selected.");
  }

  // Write-capability gate (mode-derived; no runtime needed).
  if (!caps.capabilities.createTransaction || !caps.capabilities.createTransactionWithImportedId) {
    throw new ApplyPreflightError("unsupported_connection", "Target cannot create transactions with a durable marker.");
  }
  const needsPayeeCreate = eligible.some((e) => !e.payload.payeeId && e.payload.payeeName);
  if (needsPayeeCreate && !caps.capabilities.createPayee) {
    throw new ApplyPreflightError("unsupported_connection", "Target cannot create the payees this run requires.");
  }

  return { flow, config, eligible };
}

// --- Per-item apply ---------------------------------------------------------

type ItemContext = {
  config: SyncFlowPlanConfig;
  transport: ActualBenchTransport;
  markerIndex: Map<string, string>;
};

async function applyOneItem(
  eligible: EligibleItem,
  ctx: ItemContext,
  store: ApplyStore
): Promise<ApplyItemResult> {
  const { item, payload } = eligible;
  const marker = payload.importedId as string;
  const base = { itemId: item.id, sourceItemKey: item.sourceItemKey ?? "" };

  try {
    // 1. Existing DB mapping ⇒ already applied; skip (idempotent rerun).
    const existingMapping = await store.getMappingBySource(ctx.config.flowId, item.sourceItemKey ?? "");
    if (existingMapping) {
      await store.updateRunItemStatus(item.id, {
        status: "skipped",
        applyState: "skipped",
        message: "Already mapped; skipped to avoid a duplicate.",
      });
      return { ...base, outcome: "skipped", targetTransactionId: existingMapping.targetTransactionId, message: "already mapped" };
    }

    // 2. Marker already on target (mapping lost) ⇒ repair, do not duplicate.
    const markerHit = ctx.markerIndex.get(marker);
    if (markerHit) {
      await recordMapping(store, ctx.config, item, payload, markerHit, null);
      await store.updateRunItemStatus(item.id, {
        status: "skipped",
        applyState: "skipped",
        message: "Target already has this marker; repaired mapping without creating a duplicate.",
        warnings: flagEnvelope(["target_marker_match_repair"]),
        createdTargetTransactionId: markerHit,
        createdTargetMarker: marker,
      });
      return { ...base, outcome: "repaired", targetTransactionId: markerHit, message: "repaired mapping" };
    }

    // 3. Resolve payee per policy, then create.
    let payeeId = payload.payeeId;
    if (!payeeId && payload.payeeName) {
      payeeId = (await ctx.transport.createOrResolvePayee({ name: payload.payeeName })).id;
    }

    const createInput: SyncTargetTransactionInput = {
      accountId: ctx.config.targetAccountId,
      date: payload.date,
      amount: payload.amount,
      payeeId: payeeId ?? null,
      categoryId: payload.categoryId,
      notes: payload.notes,
      cleared: payload.cleared,
      importedId: marker,
    };

    const created = await ctx.transport.createTransactionsForSync([createInput]);
    const targetId = created.created[0]?.transactionId ?? null;

    if (!targetId) {
      await store.updateRunItemStatus(item.id, {
        status: "failed",
        applyState: "failed",
        message: "Created transaction could not be resolved by imported_id.",
        errors: envelope({ code: "unresolved_target_id", marker }),
        createdTargetMarker: marker,
      });
      return {
        ...base,
        outcome: "failed",
        targetTransactionId: null,
        message: "target id unresolved; a transaction may exist but was not confirmed",
      };
    }

    // 4. Compare planned vs actual (target rules run on create).
    const actual = await findCreatedTransaction(ctx.transport, ctx.config.targetAccountId, payload.date, marker);
    const changedFields = actual ? diffPlannedVsActual(payload, payeeId ?? null, actual) : [];
    const targetFingerprint = actual ? transactionFingerprint(actual) : null;

    // 5. Record the mapping immediately (before touching later items).
    await recordMapping(store, ctx.config, item, payload, targetId, targetFingerprint);

    const hasWarnings = changedFields.length > 0;
    await store.updateRunItemStatus(item.id, {
      status: "applied",
      applyState: "applied",
      message: hasWarnings ? "Applied; target rules modified some fields." : "Applied.",
      warnings: hasWarnings ? flagEnvelope(["target_rules_modified"], { changedFields }) : null,
      createdTargetTransactionId: targetId,
      createdTargetMarker: marker,
      targetItemRef: { version: 1, data: { targetTransactionId: targetId } },
    });

    return {
      ...base,
      outcome: hasWarnings ? "applied_with_warnings" : "applied",
      targetTransactionId: targetId,
      changedFields: hasWarnings ? changedFields : undefined,
    };
  } catch (err) {
    await store.updateRunItemStatus(item.id, {
      status: "failed",
      applyState: "failed",
      message: describe(err, "Apply failed for this item."),
      errors: envelope({ code: "create_failed", message: describe(err, "unknown error") }),
    });
    return { ...base, outcome: "failed", targetTransactionId: null, message: describe(err, "apply failed") };
  }
}

async function findCreatedTransaction(
  transport: ActualBenchTransport,
  accountId: string,
  date: string,
  marker: string
) {
  const rows = await transport.listTransactionsForSync({ accountId, startDate: date, endDate: date });
  return rows.find((row) => row.importedId === marker) ?? null;
}

function diffPlannedVsActual(
  payload: PlannedTargetPayload,
  resolvedPayeeId: string | null,
  actual: { amount: number; date: string; cleared: boolean; categoryId: string | null; payeeId: string | null; notes: string | null }
): string[] {
  const changed: string[] = [];
  if (payload.amount !== actual.amount) changed.push("amount");
  if (payload.date !== actual.date) changed.push("date");
  if (payload.cleared !== actual.cleared) changed.push("cleared");
  if ((payload.categoryId ?? null) !== (actual.categoryId ?? null)) changed.push("category");
  if ((resolvedPayeeId ?? null) !== (actual.payeeId ?? null)) changed.push("payee");
  if ((payload.notes ?? null) !== (actual.notes ?? null)) changed.push("notes");
  return changed;
}

async function recordMapping(
  store: ApplyStore,
  config: SyncFlowPlanConfig,
  item: SyncFlowRunItem,
  payload: PlannedTargetPayload,
  targetTransactionId: string,
  targetFingerprint: string | null
): Promise<void> {
  const entityType: SyncEntityType = item.sourceEntityType ?? "transaction";
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
    targetEntityType: "transaction",
    targetTransactionId,
    targetItemKey: "txn:" + targetTransactionId,
    targetFingerprint,
    targetMarker: payload.importedId,
    createdRunId: item.runId,
    lastAppliedAt: nowIso(),
  });
}

// --- Small helpers ----------------------------------------------------------

function tally(counts: ApplyCounts, outcome: ApplyItemOutcome): void {
  if (outcome === "applied") counts.applied += 1;
  else if (outcome === "applied_with_warnings") {
    counts.applied += 1;
    counts.appliedWithWarnings += 1;
  } else if (outcome === "repaired") counts.repaired += 1;
  else if (outcome === "skipped") counts.skipped += 1;
  else counts.failed += 1;
}

function deriveRunStatus(counts: ApplyCounts): "applied" | "partial" | "failed" {
  if (counts.failed === 0) return "applied";
  if (counts.applied + counts.repaired > 0) return "partial";
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
