import { getAppDb } from "@/lib/app-db/connection";
import { classifySafeSyncOutcome } from "@/features/sync/lib/flowHealth";
import { isServerSafeSyncBlocked, runServerSafeSync } from "@/lib/sync/serverSafeSync";
import { registerAutomationJobType } from "../registry";
import type { AutomationJobType, AutomationRunContext } from "../registry";
import type { ServerSafeSyncResult } from "@/lib/sync/serverSafeSync";
import type { AutomationRunRollup, JsonEnvelope } from "@/lib/app-db/types";

/**
 * Budget File Sync as an automation job type (RD-079 / PR-043c).
 *
 * The first registered type, and the proof the engine is general: it adds
 * scheduling, locking, retries, health and history *around* `runServerSafeSync`
 * without changing what a sync does. Everything sync-specific — flow config,
 * preview, safe-apply, the 15-minute floor's rationale — stays where it was.
 *
 * **Run-history continuity.** `runServerSafeSync` already writes a
 * `sync_flow_runs` row per run, and the Sync UI reads those. Rather than
 * dual-writing history or migrating old rows into `automation_runs`, this type
 * records the sync run's id in its own result payload as a back-reference. Both
 * surfaces then stay truthful with no copying: Sync history is unchanged and
 * complete (including everything from before the engine existed), and an
 * automation run can link straight to the sync run it produced.
 */

export const BUDGET_FILE_SYNC_JOB_TYPE = "budget-file-sync";

export type BudgetFileSyncConfig = {
  flowId: string;
};

export type BudgetFileSyncResult = {
  flowId: string;
  status: ServerSafeSyncResult["status"];
  /** Back-reference into `sync_flow_runs`, when the run got that far. */
  syncRunId: string | null;
  applied: number;
  updated: number;
  deleted: number;
  failed: number;
  blocked: number;
  message?: string;
};

function readCounts(result: ServerSafeSyncResult): Pick<
  BudgetFileSyncResult,
  "applied" | "updated" | "deleted" | "failed" | "blocked"
> {
  if (isServerSafeSyncBlocked(result)) {
    return { applied: 0, updated: 0, deleted: 0, failed: 0, blocked: 0 };
  }

  const blocked = "preview" in result ? result.preview.blocked : 0;
  if (result.status === "applied" || result.status === "partial" || result.status === "failed") {
    const counts = result.apply.counts;
    return {
      applied: counts.applied + counts.appliedWithWarnings,
      updated: counts.updated,
      deleted: counts.deleted,
      failed: counts.failed,
      blocked,
    };
  }

  return { applied: 0, updated: 0, deleted: 0, failed: 0, blocked };
}

function readMessage(result: ServerSafeSyncResult): string | undefined {
  if (isServerSafeSyncBlocked(result)) return result.message;
  if (result.status === "preview_failed") return result.error.message;
  if (result.status === "failed" || result.status === "partial") return result.apply.error?.message;
  return undefined;
}

function readRunId(result: ServerSafeSyncResult): string | null {
  if (isServerSafeSyncBlocked(result)) return null;
  return "runId" in result ? result.runId : null;
}

export const budgetFileSyncJobType: AutomationJobType<BudgetFileSyncConfig, BudgetFileSyncResult> = {
  type: BUDGET_FILE_SYNC_JOB_TYPE,
  label: "Budget File Sync",

  validateConfig(raw: JsonEnvelope): BudgetFileSyncConfig {
    const flowId = raw.data.flowId;
    if (typeof flowId !== "string" || !flowId.trim()) {
      throw new Error("This automation has no sync flow to run (flowId is missing).");
    }
    return { flowId: flowId.trim() };
  },

  async run(ctx: AutomationRunContext<BudgetFileSyncConfig>): Promise<BudgetFileSyncResult> {
    const db = getAppDb();
    ctx.logger.info(`Running safe sync for flow ${ctx.config.flowId}`);

    // `runServerSafeSync` opens the flow's own enrolled credentials through the
    // vault. The engine has already proven a credential exists and failed
    // closed if not, so this call is not the first line of defence.
    const result = await runServerSafeSync(db, ctx.config.flowId);

    const message = readMessage(result);
    if (message) ctx.logger.warn(message);

    return {
      flowId: ctx.config.flowId,
      status: result.status,
      syncRunId: readRunId(result),
      ...readCounts(result),
      message,
    };
  },

  summarize(result: BudgetFileSyncResult): AutomationRunRollup {
    const itemCount = result.applied + result.updated + result.deleted;

    // The flow is no longer set to sync unattended. That is a configuration
    // change, not a fault: report it plainly and leave the failure streak
    // alone, exactly as `classifySafeSyncOutcome` treats it (`ignored`).
    // Counting it as a failure would auto-pause an automation for the crime of
    // the user switching their flow back to manual review.
    if (result.status === "skipped_manual_policy") {
      return {
        outcome: "no_changes",
        itemCount: 0,
        message: "This flow is no longer set to sync automatically.",
      };
    }

    // A blocked result (vault locked, not enrolled, flow missing) is a failure:
    // the sync did not happen, whatever the wording of its status.
    if (isBlockedStatus(result.status)) {
      return { outcome: "failed", itemCount: 0, message: result.message ?? "The sync could not start." };
    }

    // Otherwise defer to the existing, tested health mapping rather than
    // inventing a second opinion about what a sync status means. Note its
    // vocabulary is success/failure/ignored, not the roll-up's own.
    const health = classifySafeSyncOutcome(result.status as Parameters<typeof classifySafeSyncOutcome>[0]);
    if (health === "failure" && result.status !== "partial") {
      return { outcome: "failed", itemCount, message: result.message };
    }

    if (result.status === "partial") {
      // RD-058's rule, preserved: for Budget File Sync a partial apply means
      // writes failed, and repeated partials should still auto-pause the flow.
      return {
        outcome: "partial",
        itemCount,
        message: result.message ?? `${result.failed} item(s) failed`,
        countsAsFailure: true,
      };
    }
    if (result.status === "no_safe_items" || itemCount === 0) {
      return { outcome: "no_changes", itemCount: 0, message: "Nothing safe to apply" };
    }
    return { outcome: "ok", itemCount, message: describeCounts(result) };
  },

  serializeResult(result: BudgetFileSyncResult): JsonEnvelope {
    return {
      version: 1,
      data: {
        flowId: result.flowId,
        status: result.status,
        syncRunId: result.syncRunId,
        applied: result.applied,
        updated: result.updated,
        deleted: result.deleted,
        failed: result.failed,
        blocked: result.blocked,
        message: result.message ?? null,
      },
    };
  },

  // Budget File Sync constructs writes through Bench, so it does take part in
  // the shared review queue — unlike a type that only triggers Actual's own
  // work (RD-080).
  classification: {
    reviewSubjects: ["transaction", "payee", "category"],
    supportsAutoApply: true,
  },
};

function isBlockedStatus(status: string): boolean {
  return (
    status === "vault_disabled" ||
    status === "vault_locked" ||
    status === "not_enrolled" ||
    status === "flow_not_found"
  );
}

function describeCounts(result: BudgetFileSyncResult): string {
  const parts: string[] = [];
  if (result.applied) parts.push(`${result.applied} added`);
  if (result.updated) parts.push(`${result.updated} updated`);
  if (result.deleted) parts.push(`${result.deleted} deleted`);
  return parts.length > 0 ? parts.join(", ") : "No changes";
}

let registered = false;

/** Idempotent: the boot path and tests can both call it. */
export function registerBudgetFileSyncJobType(): void {
  if (registered) return;
  registerAutomationJobType(budgetFileSyncJobType);
  registered = true;
}

/** Test-only: allow re-registration after the registry is reset. */
export function __resetBudgetFileSyncRegistrationForTests(): void {
  registered = false;
}
