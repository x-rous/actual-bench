import { getBudgetFileSyncCapabilities } from "./capabilities";
import { connectionFingerprint } from "./connectionRef";
import { decodeFlowPlanConfig, type SyncFlowPlanConfig } from "./flowConfig";
import { planExpandedItems } from "./syncPlanner";
import { expandSourceTransactions, type SyncSourceItem } from "./sourceItems";
import {
  DEFAULT_SOURCE_FILTER,
  decodeSourceFilter,
  filterSourceItems,
  filterSourceTransactions,
  type SyncSourceFilter,
} from "./sourceFilter";
import type { ActualBenchTransport } from "@/lib/actual/transport";
import type { ConnectionInstance } from "@/store/connection";
import type { JsonObject, SyncFlow, SyncMapping } from "@/lib/app-db/types";
import type {
  SyncPlannerTargetSnapshot,
  SyncPlanResult,
} from "./plannedChanges";

/**
 * Live dry-run orchestration for Budget File Sync (RD-053 / PR-019 Slice 3).
 *
 * Connects the Slice 1 transport primitives with the Slice 2 planner to produce
 * a real, persisted `draft_preview` — with NO Actual writes. Cross-budget access
 * follows Pattern A: the source snapshot is fully materialized before the target
 * budget is opened, because the browser runtime holds only one budget at a time.
 *
 * The service is dependency-injected (ports) so it stays testable and so it does
 * not hard-couple the browser-side transport to the server-side app DB.
 */

// --- Ports ------------------------------------------------------------------

export type PreviewTransportProvider = {
  /**
   * Open and return the transport for a connection. Opening the target may
   * close the source runtime (single-runtime constraint), so callers must have
   * finished all source reads before requesting the target.
   */
  openTransport(connection: ConnectionInstance): Promise<ActualBenchTransport>;
};

export type PreviewPersistMeta = {
  summary: JsonObject;
  sourceSnapshotSummary: JsonObject;
};

export type PreviewStore = {
  loadFlow(flowId: string): Promise<SyncFlow | null>;
  loadMappings(flowId: string): Promise<SyncMapping[]>;
  persistPlan(plan: SyncPlanResult, meta: PreviewPersistMeta): Promise<{ runId: string }>;
  persistFailedRun(
    flowId: string | null,
    error: DryRunError,
    meta: PreviewPersistMeta
  ): Promise<string | null>;
};

export type LiveDryRunContext = {
  sourceConnection: ConnectionInstance;
  targetConnection: ConnectionInstance;
};

export type LiveDryRunInput = {
  flowId: string;
  context: LiveDryRunContext;
  /** Allow running a disabled flow (e.g. preview-before-enable). Default false. */
  allowDisabled?: boolean;
};

// --- Result / error shapes --------------------------------------------------

export type DryRunErrorCode =
  | "flow_not_found"
  | "flow_disabled"
  | "missing_route"
  | "connection_mismatch"
  | "unsupported_connection"
  | "source_load_failed"
  | "target_load_failed"
  | "persistence_failed";

export type DryRunError = {
  code: DryRunErrorCode;
  message: string;
};

export type DryRunSummary = {
  sourceTransactionsScanned: number;
  generatedTransactionsExcluded: number;
  sourceItemsScanned: number;
  sourceItemsFilteredOut: number;
  plannedItems: number;
  createCandidates: number;
  alreadySynced: number;
  duplicatesSkipped: number;
  sourceChangedWarnings: number;
  targetMarkerMatches: number;
  blocked: number;
};

export type LiveDryRunResult =
  | {
      status: "draft_preview";
      runId: string;
      flowId: string;
      counts: Record<string, number>;
      summary: DryRunSummary;
      warnings: string[];
      errors: [];
    }
  | {
      status: "failed";
      runId: string | null;
      flowId: string;
      error: DryRunError;
      warnings: string[];
    };

class DryRunPreviewError extends Error {
  constructor(public readonly code: DryRunErrorCode, message: string) {
    super(message);
    this.name = "DryRunPreviewError";
  }

  toError(): DryRunError {
    return { code: this.code, message: this.message };
  }
}

// --- Orchestration ----------------------------------------------------------

export async function runLiveDryRunPreview(
  input: LiveDryRunInput,
  deps: { transport: PreviewTransportProvider; store: PreviewStore }
): Promise<LiveDryRunResult> {
  const { flowId } = input;
  const warnings: string[] = [];

  // 1-2. Load flow + validate route/capabilities. Pre-run failures return a
  // typed error with no persisted run.
  let flow: SyncFlow | null;
  try {
    flow = await deps.store.loadFlow(flowId);
  } catch (err) {
    return failedResult(flowId, {
      code: "persistence_failed",
      message: describe(err, "Failed to load the flow."),
    }, warnings);
  }

  let validated: ValidatedFlow;
  try {
    validated = validateFlow(flow, input, warnings);
  } catch (err) {
    if (err instanceof DryRunPreviewError) {
      return failedResult(input.flowId, err.toError(), warnings);
    }
    throw err;
  }

  const { config, filter } = validated;

  // Everything past validation can create a run; on failure persist a failed run.
  try {
    // 3-5. Source phase (Pattern A): read, filter, expand, materialize.
    const sourceTransport = await deps.transport.openTransport(input.context.sourceConnection);
    let scanned: number;
    let materialized: SyncSourceItem[];
    let generatedExcluded: number;
    let expandedCount: number;
    try {
      const rawSource = await sourceTransport.listTransactionsForSync({
        accountId: config.sourceAccountId,
        startDate: filter.startDate ?? undefined,
        endDate: filter.endDate ?? undefined,
      });
      scanned = rawSource.length;

      const nonGenerated = filterSourceTransactions(rawSource, filter);
      generatedExcluded = scanned - nonGenerated.length;

      const expanded = expandSourceTransactions(nonGenerated);
      expandedCount = expanded.length;
      const kept = filterSourceItems(expanded, filter);

      // Materialize into a plain, serializable snapshot: no live source refs
      // may survive into the target phase.
      materialized = JSON.parse(JSON.stringify(kept)) as SyncSourceItem[];
    } catch (err) {
      throw new DryRunPreviewError("source_load_failed", describe(err, "Failed to read source transactions."));
    }

    // 6-8. Target phase: open target (may close source), load lookup + mappings.
    let target: SyncPlannerTargetSnapshot;
    let mappings: SyncMapping[];
    try {
      const targetTransport = await deps.transport.openTransport(input.context.targetConnection);
      target = await loadTargetSnapshot(targetTransport, config, filter);
    } catch (err) {
      throw new DryRunPreviewError("target_load_failed", describe(err, "Failed to read target lookup data."));
    }
    try {
      mappings = await deps.store.loadMappings(flowId);
    } catch (err) {
      throw new DryRunPreviewError("persistence_failed", describe(err, "Failed to load existing mappings."));
    }

    // 9. Plan.
    const plan = planExpandedItems({
      config,
      capabilities: getBudgetFileSyncCapabilities({ mode: input.context.targetConnection.mode }),
      sourceItems: materialized,
      target,
      existingMappings: mappings,
    });

    const summary = buildSummary(plan, {
      scanned,
      generatedExcluded,
      expandedCount,
      keptCount: materialized.length,
    });

    // 10. Persist the draft preview run.
    let runId: string;
    try {
      ({ runId } = await deps.store.persistPlan(plan, {
        summary: summaryToJson(summary),
        sourceSnapshotSummary: {
          accountId: config.sourceAccountId,
          budgetId: config.sourceBudgetId,
          connectionFingerprint: config.sourceConnectionFingerprint,
        },
      }));
    } catch (err) {
      throw new DryRunPreviewError("persistence_failed", describe(err, "Failed to persist the preview run."));
    }

    // 11. Return summary.
    return {
      status: "draft_preview",
      runId,
      flowId,
      counts: plan.counts,
      summary,
      warnings,
      errors: [],
    };
  } catch (err) {
    const error =
      err instanceof DryRunPreviewError
        ? err.toError()
        : { code: "source_load_failed" as DryRunErrorCode, message: describe(err, "Dry-run failed.") };
    return persistFailure(deps.store, flowId, error, warnings);
  }
}

// --- Helpers ----------------------------------------------------------------

type ValidatedFlow = { config: SyncFlowPlanConfig; filter: SyncSourceFilter };

function validateFlow(
  flow: SyncFlow | null,
  input: LiveDryRunInput,
  warnings: string[]
): ValidatedFlow {
  if (!flow) {
    throw new DryRunPreviewError("flow_not_found", `Sync flow ${input.flowId} was not found.`);
  }
  if (!flow.enabled && !input.allowDisabled) {
    throw new DryRunPreviewError("flow_disabled", "This sync flow is disabled.");
  }

  const config = decodeFlowPlanConfig(flow);
  if (!config.sourceAccountId || !config.targetAccountId) {
    throw new DryRunPreviewError(
      "missing_route",
      "Source and target accounts must both be selected before previewing."
    );
  }

  // Route must still point at the live connections it was saved for.
  assertConnectionMatches(
    config.sourceConnectionFingerprint,
    input.context.sourceConnection,
    "source",
    warnings
  );
  assertConnectionMatches(
    config.targetConnectionFingerprint,
    input.context.targetConnection,
    "target",
    warnings
  );

  // Direct-only capability gate (mode-derived, no runtime needed).
  const sourceCaps = getBudgetFileSyncCapabilities({ mode: input.context.sourceConnection.mode });
  const targetCaps = getBudgetFileSyncCapabilities({ mode: input.context.targetConnection.mode });
  if (!sourceCaps.supported) {
    throw new DryRunPreviewError("unsupported_connection", sourceCaps.reason ?? "Source connection is unsupported.");
  }
  if (!targetCaps.supported) {
    throw new DryRunPreviewError("unsupported_connection", targetCaps.reason ?? "Target connection is unsupported.");
  }
  if (!sourceCaps.capabilities.listTransactions || !sourceCaps.capabilities.readSplitLines) {
    throw new DryRunPreviewError("unsupported_connection", "Source connection cannot list transactions or split lines.");
  }
  if (!targetCaps.capabilities.listTransactions) {
    throw new DryRunPreviewError("unsupported_connection", "Target connection cannot list transactions for lookup.");
  }

  return { config, filter: decodeFilterOrDefault(flow) };
}

function assertConnectionMatches(
  savedFingerprint: string,
  connection: ConnectionInstance,
  side: "source" | "target",
  warnings: string[]
): void {
  if (!savedFingerprint) return; // legacy/unsaved fingerprint: skip strict check.
  if (connectionFingerprint(connection) !== savedFingerprint) {
    throw new DryRunPreviewError(
      "connection_mismatch",
      `The ${side} connection does not match the one this flow was saved with.`
    );
  }
  void warnings;
}

function decodeFilterOrDefault(flow: SyncFlow): SyncSourceFilter {
  try {
    return decodeSourceFilter(flow);
  } catch {
    return { ...DEFAULT_SOURCE_FILTER };
  }
}

async function loadTargetSnapshot(
  transport: ActualBenchTransport,
  config: SyncFlowPlanConfig,
  filter: SyncSourceFilter
): Promise<SyncPlannerTargetSnapshot> {
  const range = { accountId: config.targetAccountId, startDate: filter.startDate ?? undefined, endDate: filter.endDate ?? undefined };
  const lookup = await transport.getTargetLookupForSync(range);
  const categoryGroups = await transport.getCategoryGroups();
  const targetTxns = await transport.listTransactionsForSync(range);

  return {
    payees: lookup.payees.map((p) => ({ id: p.id, name: p.name })),
    categories: categoryGroups.categories.map((c) => ({ id: c.id, name: c.name })),
    importedIdIndex: lookup.importedIdIndex,
    transactions: targetTxns.map((t) => ({
      id: t.id,
      date: t.date,
      amount: t.amount,
      payeeName: t.payeeName,
      categoryId: t.categoryId,
    })),
  };
}

function buildSummary(
  plan: SyncPlanResult,
  source: { scanned: number; generatedExcluded: number; expandedCount: number; keptCount: number }
): DryRunSummary {
  const c = plan.counts;
  const dup = (c.exact_duplicate ?? 0) + (c.strong_duplicate ?? 0) + (c.weak_duplicate ?? 0);
  return {
    sourceTransactionsScanned: source.scanned,
    generatedTransactionsExcluded: source.generatedExcluded,
    sourceItemsScanned: source.expandedCount,
    sourceItemsFilteredOut: source.expandedCount - source.keptCount,
    plannedItems: plan.items.length,
    createCandidates: c.new ?? 0,
    alreadySynced: c.already_synced ?? 0,
    duplicatesSkipped: dup,
    sourceChangedWarnings: c.source_changed_since_sync ?? 0,
    targetMarkerMatches: c.target_marker_match ?? 0,
    blocked: c.blocked ?? 0,
  };
}

function summaryToJson(summary: DryRunSummary): JsonObject {
  return { ...summary };
}

function describe(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

function failedResult(flowId: string, error: DryRunError, warnings: string[]): LiveDryRunResult {
  return { status: "failed", runId: null, flowId, error, warnings };
}

async function persistFailure(
  store: PreviewStore,
  flowId: string,
  error: DryRunError,
  warnings: string[]
): Promise<LiveDryRunResult> {
  let runId: string | null = null;
  try {
    runId = await store.persistFailedRun(flowId, error, {
      summary: { error: error.code },
      sourceSnapshotSummary: {},
    });
  } catch {
    // If even recording the failure fails, still return a clean typed error.
    runId = null;
  }
  return { status: "failed", runId, flowId, error, warnings };
}
