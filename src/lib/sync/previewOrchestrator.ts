import { getBudgetFileSyncCapabilities } from "./capabilities";
import "./adapters"; // register all data-type adapters (side-effect)
import { getSyncKindAdapter, SyncKindError } from "./syncKind";
import type { ActualBenchTransport } from "@/lib/actual/transport";
import type { ConnectionInstance } from "@/store/connection";
import type { JsonObject, SyncFlow, SyncMapping, SyncRunTrigger } from "@/lib/app-db/types";
import type { SyncPlanResult } from "./plannedChanges";

/**
 * Live dry-run orchestration for Budget File Sync (RD-053 / PR-019 Slice 3).
 *
 * Connects the Slice 1 transport primitives with the Slice 2 planner to produce
 * a real, persisted `draft_preview` - with NO Actual writes. Cross-budget access
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
  /** What created this run; defaults to a manual preview when unset (RD-054). */
  trigger?: SyncRunTrigger;
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
  /** What created this run; stamped on the persisted run (RD-054). */
  trigger?: SyncRunTrigger;
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
  /** Exact duplicates the flow will auto-map (safe; excluded from duplicatesSkipped). */
  exactDuplicatesAutoMapped: number;
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

  // 1. Load flow (generic).
  let flow: SyncFlow | null;
  try {
    flow = await deps.store.loadFlow(flowId);
  } catch (err) {
    return failedResult(flowId, { code: "persistence_failed", message: describe(err, "Failed to load the flow.") }, warnings);
  }
  if (!flow) return failedResult(flowId, { code: "flow_not_found", message: `Sync flow ${flowId} was not found.` }, warnings);
  if (!flow.enabled && !input.allowDisabled) {
    return failedResult(flowId, { code: "flow_disabled", message: "This sync flow is disabled." }, warnings);
  }

  // 2. Resolve the data-type adapter and validate the route/capabilities.
  const adapter = getSyncKindAdapter(flow.flowType);
  if (!adapter) {
    return failedResult(flowId, { code: "unsupported_connection", message: `Unsupported sync type: ${flow.flowType}.` }, warnings);
  }
  try {
    adapter.validate({ flow, sourceConnection: input.context.sourceConnection, targetConnection: input.context.targetConnection });
  } catch (err) {
    if (err instanceof SyncKindError) return failedResult(flowId, { code: err.code, message: err.message }, warnings);
    throw err;
  }

  // Everything past validation can create a run; on failure persist a failed run.
  try {
    // 3. Source phase (Pattern A): the adapter reads + materializes.
    let sourceTransport: ActualBenchTransport;
    try {
      sourceTransport = await deps.transport.openTransport(input.context.sourceConnection);
    } catch (err) {
      throw new SyncKindError("source_load_failed", describe(err, "Failed to open the source budget."));
    }
    const source = await adapter.loadSource(sourceTransport, flow);

    // 4. Target phase: open target (may close source), load its snapshot + mappings.
    // Opening the target must surface as a target failure, not the source fallback.
    let targetTransport: ActualBenchTransport;
    try {
      targetTransport = await deps.transport.openTransport(input.context.targetConnection);
    } catch (err) {
      throw new SyncKindError("target_load_failed", describe(err, "Failed to open the target budget."));
    }
    const target = await adapter.loadTarget(targetTransport, flow);
    let mappings: SyncMapping[];
    try {
      mappings = await deps.store.loadMappings(flowId);
    } catch (err) {
      throw new DryRunPreviewError("persistence_failed", describe(err, "Failed to load existing mappings."));
    }

    // 5. Plan (pure) + summary.
    const targetCapabilities = getBudgetFileSyncCapabilities({ mode: input.context.targetConnection.mode }).capabilities;
    const plan = adapter.plan({ flow, materialized: source.materialized, target, mappings, targetCapabilities });
    const summary = adapter.buildSummary(plan, source.stats);

    // 6. Persist the draft preview run (one transaction).
    let runId: string;
    try {
      ({ runId } = await deps.store.persistPlan(plan, {
        summary: { ...summary },
        sourceSnapshotSummary: adapter.sourceSummary(flow),
        trigger: input.trigger,
      }));
    } catch (err) {
      throw new DryRunPreviewError("persistence_failed", describe(err, "Failed to persist the preview run."));
    }

    return { status: "draft_preview", runId, flowId, counts: plan.counts, summary, warnings, errors: [] };
  } catch (err) {
    const error: DryRunError =
      err instanceof SyncKindError
        ? { code: err.code, message: err.message }
        : err instanceof DryRunPreviewError
          ? err.toError()
          : { code: "source_load_failed", message: describe(err, "Dry-run failed.") };
    return persistFailure(deps.store, flowId, error, warnings);
  }
}

// --- Helpers ----------------------------------------------------------------

function describe(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message;
  // Server-side HTTP calls throw a structured ApiError object (not an Error
  // instance); surface its real message instead of the generic fallback.
  if (err && typeof err === "object" && "message" in err) {
    const message = (err as { message?: unknown }).message;
    if (typeof message === "string" && message) return message;
  }
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
