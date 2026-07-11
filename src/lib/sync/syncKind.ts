import type { ActualBenchTransport } from "@/lib/actual/transport";
import type { ConnectionInstance } from "@/store/connection";
import type { JsonObject, SyncCapabilitySet, SyncDomain, SyncFlow, SyncMapping } from "@/lib/app-db/types";
import type { SyncPlanResult } from "./plannedChanges";

/**
 * The unified Budget File Sync engine (RD-055): ONE preview/apply/automation
 * pipeline across every data type. All type-specific behavior - what to read,
 * how to match/classify, how to create - lives in a `SyncKindAdapter`, resolved
 * by `flow.flowType`. The orchestrators (preview, apply, safe-sync, scheduler,
 * review queue, flow health, history) stay generic and therefore work
 * identically for transactions, payees, and categories.
 *
 * Do NOT add a parallel engine for a new data type - add an adapter.
 */

/** Error thrown by an adapter; the orchestrator maps `code` to its result. */
export class SyncKindError extends Error {
  constructor(
    public readonly code:
      | "missing_route"
      | "connection_mismatch"
      | "unsupported_connection"
      | "source_load_failed"
      | "target_load_failed",
    message: string
  ) {
    super(message);
    this.name = "SyncKindError";
  }
}

/** Materialized, JSON-serializable source snapshot + scan stats for the summary. */
export type AdapterSourceResult = {
  materialized: unknown;
  stats: { scanned: number; generatedExcluded: number; expandedCount: number; keptCount: number };
};

/** Coarse summary counts rendered in the preview/history (kind-agnostic keys). */
export type AdapterSummary = {
  sourceTransactionsScanned: number;
  generatedTransactionsExcluded: number;
  sourceItemsScanned: number;
  sourceItemsFilteredOut: number;
  plannedItems: number;
  createCandidates: number;
  alreadySynced: number;
  duplicatesSkipped: number;
  exactDuplicatesAutoMapped: number;
  sourceChangedWarnings: number;
  targetMarkerMatches: number;
  blocked: number;
};

export type AdapterApplyContext = {
  /** Transaction adapter fills this with the target imported_id index; empty otherwise. */
  markerIndex: Map<string, string>;
};

/** One create request the orchestrator asks the adapter to perform on the target. */
export type AdapterCreateInput = {
  /** Run item id, echoed back so the orchestrator can match results. */
  itemId: string;
  /** The persisted planned payload (transaction or entity) as plain JSON. */
  payload: JsonObject;
};

export type AdapterCreateResult = {
  itemId: string;
  targetId: string | null;
  /** Fields the target changed vs. the plan (e.g. rules); drives the warning. */
  changedFields?: string[];
  /** Hash of the persisted target fields, stored on the mapping (RD-057 §4). */
  targetFingerprint?: string | null;
};

/** One update/delete request against an existing target (RD-057 §4/§5). */
export type AdapterMutateInput = {
  itemId: string;
  /** Existing target transaction/entity id to mutate. */
  targetId: string;
  /** Persisted target field hash from the mapping, to guard manual edits. */
  expectedTargetFingerprint: string | null;
  /** The planned payload (update only); absent for delete. */
  payload?: JsonObject;
};

export type AdapterMutateResult = {
  itemId: string;
  /**
   * "updated" / "deleted" on success; "skipped" when a guard blocked it (e.g. the
   * target was edited outside sync); "failed" when the target write itself errored
   * - reported per item so one failure doesn't discard the batch's other results.
   */
  outcome: "updated" | "deleted" | "skipped" | "failed";
  targetId: string | null;
  targetFingerprint?: string | null;
  message?: string;
};

export type AdapterValidateInput = {
  flow: SyncFlow;
  sourceConnection: ConnectionInstance;
  targetConnection: ConnectionInstance;
};

/**
 * A data-type plugin for the unified engine. Everything a data type needs to be
 * previewed, applied, and automated is expressed here; nothing else in the
 * pipeline is type-aware.
 */
export interface SyncKindAdapter {
  readonly flowType: SyncDomain;

  /** Route + capability validation; throws SyncKindError on failure. */
  validate(input: AdapterValidateInput): void;

  /** Read + materialize the source (runs on the source transport). */
  loadSource(transport: ActualBenchTransport, flow: SyncFlow): Promise<AdapterSourceResult>;

  /** Read the target snapshot (runs on the target transport). */
  loadTarget(transport: ActualBenchTransport, flow: SyncFlow): Promise<unknown>;

  /** Pure plan/classification from materialized source + target + mappings. */
  plan(input: {
    flow: SyncFlow;
    materialized: unknown;
    target: unknown;
    mappings: SyncMapping[];
    targetCapabilities: SyncCapabilitySet;
  }): SyncPlanResult;

  /** Non-secret source snapshot summary stored on the run. */
  sourceSummary(flow: SyncFlow): JsonObject;

  /** Coarse summary counts for the run/preview. */
  buildSummary(plan: SyncPlanResult, stats: AdapterSourceResult["stats"]): AdapterSummary;

  /** Prepare per-run apply state (e.g. load the marker index). */
  prepareApply(transport: ActualBenchTransport, flow: SyncFlow): Promise<AdapterApplyContext>;

  /** Capability check for apply; throws SyncKindError if the target can't create. */
  assertCanApply(capabilities: SyncCapabilitySet, willCreate: boolean): void;

  /** Create a batch of items on the target; results are matched back by itemId. */
  createBatch(
    transport: ActualBenchTransport,
    flow: SyncFlow,
    inputs: AdapterCreateInput[]
  ): Promise<AdapterCreateResult[]>;

  /**
   * Overwrite existing targets whose source drifted (RD-057 §4). Optional: only
   * data types that support in-place update implement it. Each item re-checks the
   * live target against `expectedTargetFingerprint` and skips (never overwrites)
   * a target edited outside sync.
   */
  updateBatch?(
    transport: ActualBenchTransport,
    flow: SyncFlow,
    inputs: AdapterMutateInput[]
  ): Promise<AdapterMutateResult[]>;

  /**
   * Delete/void targets whose source item was removed (RD-057 §5). Optional and
   * review-first: only invoked for explicitly selected `source_missing` items.
   */
  deleteBatch?(
    transport: ActualBenchTransport,
    flow: SyncFlow,
    inputs: AdapterMutateInput[]
  ): Promise<AdapterMutateResult[]>;
}

const registry = new Map<SyncDomain, SyncKindAdapter>();

/** Register a data-type adapter (called once per adapter module at import). */
export function registerSyncKindAdapter(adapter: SyncKindAdapter): void {
  registry.set(adapter.flowType, adapter);
}

/** Resolve the adapter for a flow type, or null if the type is unsupported. */
export function getSyncKindAdapter(flowType: SyncDomain): SyncKindAdapter | null {
  return registry.get(flowType) ?? null;
}
