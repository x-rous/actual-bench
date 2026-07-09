import { decodeFlowPlanConfig } from "./flowConfig";
import {
  runLiveDryRunPreview,
  type DryRunError,
  type DryRunSummary,
  type LiveDryRunContext,
  type PreviewStore,
  type PreviewTransportProvider,
} from "./previewOrchestrator";
import {
  applySyncRun,
  type ApplyRunResult,
  type ApplyStore,
  type ApplyTransportProvider,
} from "./applyOrchestrator";
import type { SyncReviewPolicy, SyncRunTrigger } from "@/lib/app-db/types";

/**
 * Safe-only run executor for Budget File Sync automation (RD-054 / PR-020 Slice 2).
 *
 * This is **not a second sync engine**. It composes the two existing RD-053
 * orchestrators - `runLiveDryRunPreview` (plan, no writes) then `applySyncRun`
 * with `{ selection: "all_safe" }` (apply only safe classes) - behind a single
 * headless call, gated by the flow's automation policy.
 *
 * Safety guarantees:
 * - **Policy is a gate, never a bypass.** The `reviewPolicy` check runs here,
 *   server-side, before any preview or apply. A `manual_preview_required` flow
 *   can never be auto-applied through this path, whatever the caller passes.
 * - **Safe classes only.** Apply uses `all_safe`, which resolves to `new`
 *   create candidates plus repairable `target_marker_match` rows. Every
 *   uncertain class (duplicates, source-changed, source-missing, blocked,
 *   warning) is planned and left pending for the review queue.
 * - **RD-053 preflight intact.** The composed apply still re-checks route,
 *   capabilities, marker presence, and preview freshness before writing.
 *
 * There is no UI here (that is Slice 4) and no review-queue surface (Slice 3);
 * this slice only makes the safe-only behavior exist and be testable.
 */

export type SafeSyncInput = {
  flowId: string;
  context: LiveDryRunContext;
  /** Allow running a disabled flow (e.g. an explicit "run now" on a paused flow). */
  allowDisabled?: boolean;
  /** Trigger stamped on the run; both "Run now" and the interval use the default. */
  trigger?: SyncRunTrigger;
};

export type SafeSyncDeps = {
  transport: PreviewTransportProvider & ApplyTransportProvider;
  previewStore: PreviewStore;
  applyStore: ApplyStore;
  /** Injectable for tests; default to the real orchestrators. */
  runPreview?: typeof runLiveDryRunPreview;
  runApply?: typeof applySyncRun;
};

export type SafeSyncResult =
  /** Flow is manual-only (or was not found); nothing was previewed or applied. */
  | { status: "skipped_manual_policy"; flowId: string; reviewPolicy: SyncReviewPolicy }
  /** Preview never produced an applyable run. */
  | { status: "preview_failed"; flowId: string; runId: string | null; error: DryRunError }
  /** Preview succeeded but there was nothing safe to apply - a benign no-op. */
  | {
      status: "no_safe_items";
      flowId: string;
      runId: string;
      reviewPolicy: SyncReviewPolicy;
      preview: DryRunSummary;
    }
  /** Safe apply ran; `apply.status` carries applied / partial / failed detail. */
  | {
      status: "applied" | "partial" | "failed";
      flowId: string;
      runId: string;
      reviewPolicy: SyncReviewPolicy;
      preview: DryRunSummary;
      apply: ApplyRunResult;
    };

export async function runSafeSync(
  input: SafeSyncInput,
  deps: SafeSyncDeps
): Promise<SafeSyncResult> {
  const { flowId } = input;
  const runPreview = deps.runPreview ?? runLiveDryRunPreview;
  const runApply = deps.runApply ?? applySyncRun;

  // 1. Policy gate - authoritative and first. A flow that has not opted into
  //    automation is never auto-applied here, regardless of caller intent. A
  //    missing flow is reported as a preview failure (the preview would fail the
  //    same way) rather than silently skipped.
  const flow = await deps.previewStore.loadFlow(flowId);
  if (!flow) {
    return {
      status: "preview_failed",
      flowId,
      runId: null,
      error: { code: "flow_not_found", message: `Sync flow ${flowId} was not found.` },
    };
  }
  const reviewPolicy = decodeFlowPlanConfig(flow).reviewPolicy;
  if (reviewPolicy === "manual_preview_required") {
    return { status: "skipped_manual_policy", flowId, reviewPolicy };
  }

  // 2. Preview (no Actual writes) - the RD-053 planner, unchanged. The run is
  //    stamped so history shows it was automated (default: interval_safe_only).
  const preview = await runPreview(
    {
      flowId,
      context: input.context,
      allowDisabled: input.allowDisabled,
      trigger: input.trigger ?? "interval_safe_only",
    },
    { transport: deps.transport, store: deps.previewStore }
  );
  if (preview.status !== "draft_preview") {
    return { status: "preview_failed", flowId, runId: preview.runId, error: preview.error };
  }

  // 3. Nothing safe to apply → benign no-op; don't reopen the target budget.
  const safeCount =
    preview.summary.createCandidates +
    preview.summary.targetMarkerMatches +
    preview.summary.exactDuplicatesAutoMapped;
  if (safeCount === 0) {
    return { status: "no_safe_items", flowId, runId: preview.runId, reviewPolicy, preview: preview.summary };
  }

  // 4. Apply safe classes only (new creates + target-marker repairs). Apply
  //    re-validates freshness/route/capabilities per RD-053.
  const apply = await runApply(
    {
      runId: preview.runId,
      targetConnection: input.context.targetConnection,
      selection: { selection: "all_safe" },
    },
    { transport: deps.transport, store: deps.applyStore }
  );

  // A "no eligible items" apply after a non-zero preview is still a benign no-op
  // (e.g. the only safe rows resolved away between preview and apply), not a real
  // failure - report it as such rather than surfacing an error.
  if (apply.status === "failed" && apply.error?.code === "no_eligible_items") {
    return { status: "no_safe_items", flowId, runId: preview.runId, reviewPolicy, preview: preview.summary };
  }

  return {
    status: apply.status,
    flowId,
    runId: preview.runId,
    reviewPolicy,
    preview: preview.summary,
    apply,
  };
}
