import type { SyncFlow } from "@/lib/app-db/types";

/**
 * Typed planner view of a saved sync flow (RD-053 / PR-019).
 *
 * The app DB stores a flow's route/filter/transform/options as generic,
 * versioned JSON envelopes (flexible for future domains). The planner needs a
 * concrete, defaulted shape; this module is the single decode point from the
 * loose envelope model into that typed config. Filters are intentionally out of
 * scope here — the planner operates on an already-filtered source snapshot
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
  /** Copy the source notes before appending the visible marker. */
  copySourceNotes: boolean;
};

/** Product defaults (RD-053 §2 / PR-019 Product Defaults table). */
export const SYNC_PLAN_CONFIG_DEFAULTS = {
  amountDirection: "reverse" as SyncAmountDirection,
  missingPayee: "create" as SyncMissingPayeePolicy,
  notesMarkerEnabled: true,
  copySourceNotes: true,
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
        "amountDirection" | "missingPayee" | "notesMarkerEnabled" | "copySourceNotes"
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
    copySourceNotes: input.copySourceNotes ?? SYNC_PLAN_CONFIG_DEFAULTS.copySourceNotes,
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
    copySourceNotes: bool(transform.copySourceNotes),
  });
}
