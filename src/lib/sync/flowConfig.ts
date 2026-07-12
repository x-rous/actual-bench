import type { SyncFlow, SyncReviewPolicy } from "@/lib/app-db/types";

/**
 * Typed planner view of a saved sync flow (RD-053 / PR-019).
 *
 * The app DB stores a flow's route/filter/transform/options as generic,
 * versioned JSON envelopes (flexible for future domains). The planner needs a
 * concrete, defaulted shape; this module is the single decode point from the
 * loose envelope model into that typed config. Filters are intentionally out of
 * scope here - the planner operates on an already-filtered source snapshot
 * (source filtering happens during load in Slice 3).
 */

/** Amount sign handling from source to target. */
export type SyncAmountDirection = "reverse" | "same";

/** What to do when a source payee has no normalized-name match on the target. */
export type SyncMissingPayeePolicy = "create" | "leave_empty";

export type SyncFlowPlanConfig = {
  flowId: string;
  // Non-secret route references (fingerprints, ids, display names).
  sourceConnectionFingerprint: string;
  sourceBudgetId: string;
  sourceAccountId: string;
  sourceBudgetName: string;
  sourceAccountName: string;
  targetConnectionFingerprint: string;
  targetBudgetId: string;
  targetAccountId: string;
  targetBudgetName: string;
  targetAccountName: string;
  // Transform options.
  amountDirection: SyncAmountDirection;
  missingPayee: SyncMissingPayeePolicy;
  /** Append the visible `[Synced from …]` marker to target notes. */
  notesMarkerEnabled: boolean;
  /**
   * Custom text for the visible notes marker (RD-057 polish). Empty means use
   * the default `[Synced from <budget> / <account>]`. Kept as literal text so a
   * user can word it however they like.
   */
  notesMarker: string;
  /** Copy the source notes before appending the visible marker. */
  copySourceNotes: boolean;
  /**
   * Automation policy (RD-054). Carried here so the single flow-decode point also
   * yields the policy for the safe-only executor; the planner itself ignores it.
   */
  reviewPolicy: SyncReviewPolicy;
  /**
   * Interval, in minutes, for `auto_sync_on_interval` flows. Clamped to a floor
   * because each run re-opens/syncs the whole budget. Ignored for other policies.
   */
  intervalMinutes: number;
  /**
   * ISO timestamp set when automation paused the flow after repeated failures
   * (RD-054 flow health); cleared when the user re-enables it. Null when healthy.
   */
  autoPausedAt: string | null;
  /**
   * When true, an exact duplicate on the target is auto-mapped to that existing
   * transaction (mapping recorded, no write) instead of waiting for review
   * (RD-054). Fuzzy (strong/weak) duplicates are never auto-mapped.
   */
  exactDuplicateAutoMap: boolean;
  /**
   * When true, a mapped item whose source changed since the last sync becomes an
   * opt-in `update` candidate that overwrites the target (RD-057 §4). Off by
   * default: the safe behavior is to warn and leave the target unchanged. Apply
   * never overwrites a target that was edited outside sync, regardless.
   */
  updateMappedTargets: boolean;
  /**
   * When true, a mapped item whose source transaction was deleted is surfaced as
   * a review-first `source_missing` delete candidate (RD-057 §5). Off by default,
   * and only acted on for whole-account flows (no date filter) so a transaction
   * merely outside the synced window is never mistaken for a deletion. Deletes
   * always require explicit selection - they are never applied in bulk.
   */
  detectDeletedSource: boolean;
  /**
   * When true, a source split transaction is synced as ONE grouped target split
   * (parent + child lines) instead of exploding into separate transactions
   * (RD-057 §6). Off by default (the explode behavior); requires a target that
   * can create split transactions.
   */
  createTargetSplits: boolean;
  /**
   * Multi-currency consolidation (RD-056 / PR-025). When true, target amounts are
   * FX-converted from `fxSourceCurrency` to `fxTargetCurrency` using the rate for
   * each transaction's date. Off by default (amounts copied as-is). Both are ISO
   * 4217 codes; when they match, conversion is a rate-1 no-op.
   */
  fxEnabled: boolean;
  fxSourceCurrency: string;
  fxTargetCurrency: string;
  /** Allow the FX provider (Frankfurter) to fetch missing rates; else registry-only. */
  fxAllowProvider: boolean;
};

/** Smallest allowed auto-sync interval - a budget sync per run is expensive. */
export const MIN_SYNC_INTERVAL_MINUTES = 15;
/** Default auto-sync interval when a flow opts in without choosing one. */
export const DEFAULT_SYNC_INTERVAL_MINUTES = 60;

/** Coerce a stored/user interval to a finite value at or above the floor. */
export function clampSyncInterval(value: unknown): number {
  // Blank/whitespace strings mean "unset" → default (Number("") is 0, not NaN).
  if (typeof value === "string" && value.trim() === "") return DEFAULT_SYNC_INTERVAL_MINUTES;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return DEFAULT_SYNC_INTERVAL_MINUTES;
  return Math.max(MIN_SYNC_INTERVAL_MINUTES, Math.round(n));
}

/** Recognised review-policy values; anything else decodes to the safe default. */
const REVIEW_POLICIES: readonly SyncReviewPolicy[] = [
  "manual_preview_required",
  "auto_apply_safe_only",
  "auto_sync_on_interval",
  "auto_sync_unattended",
];

function reviewPolicy(value: unknown): SyncReviewPolicy | undefined {
  return typeof value === "string" && (REVIEW_POLICIES as readonly string[]).includes(value)
    ? (value as SyncReviewPolicy)
    : undefined;
}

/** Product defaults (RD-053 §2 / PR-019 Product Defaults table). */
export const SYNC_PLAN_CONFIG_DEFAULTS = {
  amountDirection: "reverse" as SyncAmountDirection,
  missingPayee: "create" as SyncMissingPayeePolicy,
  notesMarkerEnabled: true,
  notesMarker: "",
  copySourceNotes: true,
  // RD-053 behavior is unchanged unless the user opts a flow into automation.
  reviewPolicy: "manual_preview_required" as SyncReviewPolicy,
  intervalMinutes: DEFAULT_SYNC_INTERVAL_MINUTES,
  autoPausedAt: null as string | null,
  exactDuplicateAutoMap: false,
  updateMappedTargets: false,
  detectDeletedSource: false,
  createTargetSplits: false,
  fxEnabled: false,
  fxSourceCurrency: "",
  fxTargetCurrency: "",
  fxAllowProvider: true,
};

type PartialRoute = Partial<
  Pick<
    SyncFlowPlanConfig,
    | "sourceConnectionFingerprint"
    | "sourceBudgetId"
    | "sourceAccountId"
    | "sourceBudgetName"
    | "sourceAccountName"
    | "targetConnectionFingerprint"
    | "targetBudgetId"
    | "targetAccountId"
    | "targetBudgetName"
    | "targetAccountName"
  >
>;

/** Build a config from explicit fields, applying product defaults. */
export function buildPlanConfig(
  input: { flowId: string } & PartialRoute &
    Partial<
      Pick<
        SyncFlowPlanConfig,
        | "amountDirection"
        | "missingPayee"
        | "notesMarkerEnabled"
        | "notesMarker"
        | "copySourceNotes"
        | "reviewPolicy"
        | "intervalMinutes"
        | "autoPausedAt"
        | "exactDuplicateAutoMap"
        | "updateMappedTargets"
        | "detectDeletedSource"
        | "createTargetSplits"
        | "fxEnabled"
        | "fxSourceCurrency"
        | "fxTargetCurrency"
        | "fxAllowProvider"
      >
    >
): SyncFlowPlanConfig {
  return {
    flowId: input.flowId,
    sourceConnectionFingerprint: input.sourceConnectionFingerprint ?? "",
    sourceBudgetId: input.sourceBudgetId ?? "",
    sourceAccountId: input.sourceAccountId ?? "",
    sourceBudgetName: input.sourceBudgetName ?? "",
    sourceAccountName: input.sourceAccountName ?? "",
    targetConnectionFingerprint: input.targetConnectionFingerprint ?? "",
    targetBudgetId: input.targetBudgetId ?? "",
    targetAccountId: input.targetAccountId ?? "",
    targetBudgetName: input.targetBudgetName ?? "",
    targetAccountName: input.targetAccountName ?? "",
    amountDirection: input.amountDirection ?? SYNC_PLAN_CONFIG_DEFAULTS.amountDirection,
    missingPayee: input.missingPayee ?? SYNC_PLAN_CONFIG_DEFAULTS.missingPayee,
    notesMarkerEnabled:
      input.notesMarkerEnabled ?? SYNC_PLAN_CONFIG_DEFAULTS.notesMarkerEnabled,
    notesMarker: input.notesMarker ?? SYNC_PLAN_CONFIG_DEFAULTS.notesMarker,
    copySourceNotes: input.copySourceNotes ?? SYNC_PLAN_CONFIG_DEFAULTS.copySourceNotes,
    reviewPolicy: input.reviewPolicy ?? SYNC_PLAN_CONFIG_DEFAULTS.reviewPolicy,
    intervalMinutes:
      input.intervalMinutes != null
        ? clampSyncInterval(input.intervalMinutes)
        : SYNC_PLAN_CONFIG_DEFAULTS.intervalMinutes,
    autoPausedAt: input.autoPausedAt ?? SYNC_PLAN_CONFIG_DEFAULTS.autoPausedAt,
    exactDuplicateAutoMap:
      input.exactDuplicateAutoMap ?? SYNC_PLAN_CONFIG_DEFAULTS.exactDuplicateAutoMap,
    updateMappedTargets:
      input.updateMappedTargets ?? SYNC_PLAN_CONFIG_DEFAULTS.updateMappedTargets,
    detectDeletedSource:
      input.detectDeletedSource ?? SYNC_PLAN_CONFIG_DEFAULTS.detectDeletedSource,
    createTargetSplits:
      input.createTargetSplits ?? SYNC_PLAN_CONFIG_DEFAULTS.createTargetSplits,
    fxEnabled: input.fxEnabled ?? SYNC_PLAN_CONFIG_DEFAULTS.fxEnabled,
    fxSourceCurrency: input.fxSourceCurrency ?? SYNC_PLAN_CONFIG_DEFAULTS.fxSourceCurrency,
    fxTargetCurrency: input.fxTargetCurrency ?? SYNC_PLAN_CONFIG_DEFAULTS.fxTargetCurrency,
    fxAllowProvider: input.fxAllowProvider ?? SYNC_PLAN_CONFIG_DEFAULTS.fxAllowProvider,
  };
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function bool(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

/**
 * Best-effort decode of a saved flow's first leg into a planner config. Unknown
 * or missing fields fall back to product defaults, so a partially-populated
 * flow still plans sensibly. Secrets are never read (the DB rejects them).
 */
export function decodeFlowPlanConfig(flow: SyncFlow): SyncFlowPlanConfig {
  const leg = flow.legs[0];
  const source = (leg?.sourceRef.data ?? {}) as Record<string, unknown>;
  const target = (leg?.targetRef.data ?? {}) as Record<string, unknown>;
  const transform = (leg?.transform.data ?? {}) as Record<string, unknown>;
  const options = (leg?.options.data ?? {}) as Record<string, unknown>;

  const direction = str(transform.amountDirection);
  const missingPayee = str(transform.missingPayee);

  return buildPlanConfig({
    flowId: flow.id,
    sourceConnectionFingerprint: str(source.connectionFingerprint),
    sourceBudgetId: str(source.budgetId),
    sourceAccountId: str(source.accountId),
    sourceBudgetName: str(source.budgetName),
    sourceAccountName: str(source.accountName),
    targetConnectionFingerprint: str(target.connectionFingerprint),
    targetBudgetId: str(target.budgetId),
    targetAccountId: str(target.accountId),
    targetBudgetName: str(target.budgetName),
    targetAccountName: str(target.accountName),
    amountDirection: direction === "same" || direction === "reverse" ? direction : undefined,
    missingPayee:
      missingPayee === "create" || missingPayee === "leave_empty" ? missingPayee : undefined,
    notesMarkerEnabled: bool(transform.notesMarkerEnabled),
    notesMarker: str(transform.notesMarker) ?? "",
    copySourceNotes: bool(transform.copySourceNotes),
    reviewPolicy: reviewPolicy(options.reviewPolicy),
    intervalMinutes: options.intervalMinutes != null ? clampSyncInterval(options.intervalMinutes) : undefined,
    autoPausedAt: str(options.autoPausedAt) ?? null,
    exactDuplicateAutoMap: bool(options.exactDuplicateAutoMap),
    updateMappedTargets: bool(options.updateMappedTargets),
    detectDeletedSource: bool(options.detectDeletedSource),
    createTargetSplits: bool(options.createTargetSplits),
    fxEnabled: bool(transform.fxEnabled),
    fxSourceCurrency: (str(transform.fxSourceCurrency) ?? "").toUpperCase() || undefined,
    fxTargetCurrency: (str(transform.fxTargetCurrency) ?? "").toUpperCase() || undefined,
    fxAllowProvider: transform.fxAllowProvider == null ? undefined : bool(transform.fxAllowProvider),
  });
}
