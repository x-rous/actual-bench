import type { ActualBenchTransport, SyncAppliedSnapshot } from "@/lib/actual/transport";
import type { ConnectionInstance } from "@/store/connection";
import type { JsonObject, SyncCapabilitySet, SyncDomain, SyncFlow, SyncMapping, SyncMappingPatch } from "@/lib/app-db/types";
import type { SyncPlanResult } from "./plannedChanges";

/**
 * The unified Cross Budget Sync engine (RD-055): ONE preview/apply/automation
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

/**
 * Extract a real message from a caught error, whatever shape it arrives in.
 * Server-side HTTP calls (`apiRequest` in `src/lib/api/client.ts`) throw a
 * structured `ApiError` plain object, not an `Error` instance, so a naive
 * `err instanceof Error ? err.message : fallback` always falls through to the
 * fallback for every HTTP failure - hiding exactly the detail (a real HTTP
 * status/reason) someone needs to tell "the network is down" apart from
 * "the account id is wrong" apart from "the API key was revoked".
 */
export function describeSyncError(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message;
  if (err && typeof err === "object" && "message" in err) {
    const message = (err as { message?: unknown }).message;
    if (typeof message === "string" && message) return message;
  }
  return fallback;
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
  /** Mapped rows whose target transaction no longer exists. */
  targetMissing?: number;
};

/** Every registered kind: a flow's type, or a run kind that works on a flow's route. */
export type SyncAdapterKind = SyncDomain | "category_return";

export type AdapterApplyContext = {
  /** Transaction adapter fills this with the target imported_id index; empty otherwise. */
  markerIndex: Map<string, string>;
  /** The target account's rows as read for this apply, by id (transactions only). */
  liveTargets?: Map<string, AdapterLiveTarget>;
};

/** A target row as apply needs it: its fields, plus split lines when it is a split. */
export type AdapterLiveTarget = SyncAppliedSnapshot & {
  transferId: string | null;
  reconciled?: boolean;
  isParent?: boolean;
  splitLines?: { id: string | null; amount: number; notes: string | null; payeeId: string | null; categoryId: string | null; reconciled?: boolean }[];
};

/** Optional limits on a read: a recent window instead of the whole account. */
export type AdapterScanOptions = { sinceDate?: string };

/** Lets a long write loop stop as soon as the apply no longer owns its run. */
export type AdapterWriteOptions = { shouldStop?: () => boolean };

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
  /** The run item's source key. */
  sourceItemKey?: string;
  /** The source fingerprint this item was planned with; a skip that settles the item records it. */
  sourceFingerprint?: string | null;
  /** The mapping says this sync created the target transfer's other leg. */
  ownsTransferLeg?: boolean;
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
  /**
   * When set, replaces the default mapping refresh after an update. On a skip it
   * settles the item, so the next preview does not offer the same change again.
   */
  mappingPatch?: SyncMappingPatch;
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
  readonly flowType: SyncAdapterKind;
  /** Which of the flow's budgets this kind writes to. Defaults to the target. */
  readonly writeSide?: "source" | "target";

  /** Route + capability validation; throws SyncKindError on failure. */
  validate(input: AdapterValidateInput): void;

  /** Read + materialize the source (runs on the source transport). */
  loadSource(transport: ActualBenchTransport, flow: SyncFlow, options?: AdapterScanOptions): Promise<AdapterSourceResult>;

  /** Read the target snapshot (runs on the target transport). */
  loadTarget(transport: ActualBenchTransport, flow: SyncFlow, options?: AdapterScanOptions): Promise<unknown>;

  /**
   * The distinct FX conversions this materialized source needs (RD-056), so the
   * orchestrator can resolve rates before planning. Only the transaction adapter
   * implements it; others convert nothing.
   */
  collectFxNeeds?(materialized: unknown, flow: SyncFlow): { baseCurrency: string; quoteCurrency: string; date: string }[];

  /** Pure plan/classification from materialized source + target + mappings. */
  plan(input: {
    flow: SyncFlow;
    materialized: unknown;
    target: unknown;
    mappings: SyncMapping[];
    targetCapabilities: SyncCapabilitySet;
    /** Resolved FX rate info per transaction date (RD-056); omitted when FX is off. */
    fxRateByDate?: Map<string, import("./plannedChanges").FxRateInfo>;
    /** Why a date has no rate, for its pending rows. */
    fxPendingByDate?: Map<string, string>;
    /** The rate recorded for each synced row, by target transaction id. */
    manualFxRates?: Map<string, import("./plannedChanges").ManualFxRate>;
  }): SyncPlanResult;

  /**
   * Optional checks of a finished plan that need more of the target than
   * `loadTarget` reads, such as the other account of a planned transfer. A failure
   * leaves the plan as it was.
   */
  reviewPlan?(transport: ActualBenchTransport, flow: SyncFlow, plan: SyncPlanResult): Promise<SyncPlanResult>;

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
    inputs: AdapterMutateInput[],
    options?: AdapterWriteOptions
  ): Promise<AdapterMutateResult[]>;

  /**
   * Delete/void targets whose source item was removed (RD-057 §5). Optional and
   * review-first: only invoked for explicitly selected `source_missing` items.
   */
  deleteBatch?(
    transport: ActualBenchTransport,
    flow: SyncFlow,
    inputs: AdapterMutateInput[],
    options?: AdapterWriteOptions
  ): Promise<AdapterMutateResult[]>;
}

const registry = new Map<SyncAdapterKind, SyncKindAdapter>();

/** Register a data-type adapter (called once per adapter module at import). */
export function registerSyncKindAdapter(adapter: SyncKindAdapter): void {
  registry.set(adapter.flowType, adapter);
}

/** Resolve the adapter for a flow type, or null if the type is unsupported. */
export function getSyncKindAdapter(flowType: SyncAdapterKind): SyncKindAdapter | null {
  return registry.get(flowType) ?? null;
}
