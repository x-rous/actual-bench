import { NextResponse } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { appDbErrorResponse, readJsonBody } from "@/lib/app-db/routeResponses";
import { getBackupPolicy } from "@/lib/app-db/backupRepository";
import { listAutomations } from "@/lib/app-db/automationRepository";
import { listAutomationRuns } from "@/lib/app-db/automationRunRepository";
import { ensureAutomationJobTypesRegistered } from "@/lib/automation/bootstrap";
import { executeAutomation } from "@/lib/automation/engine";
import { BACKUP_JOB_TYPE } from "@/lib/automation/jobs/backupType";
import { runBackup } from "@/lib/backup/runBackup";

type RouteContext = { params: Promise<{ policyId: string }> };

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// A large budget takes a while to export, verify and upload to two places.
export const maxDuration = 300;

/**
 * Back up now.
 *
 * Runs **through the automation engine** whenever the rule has an automation,
 * which it does unless it was created seconds ago. That is not ceremony: the
 * engine is what records a run, holds the single-run lock and updates health,
 * so a manual backup that went straight to `runBackup` finished successfully
 * and left no trace in the run history the rule links to - which is exactly
 * what someone checking "did that work?" goes looking for.
 *
 * The direct path remains as a fallback for a rule with no automation yet.
 *
 * A run that happened answers 200 whatever it concluded: a backup that failed
 * is a result, not a transport error, and the caller needs the detail to say
 * which destination refused it.
 */
export async function POST(request: Request, context: RouteContext) {
  try {
    ensureAutomationJobTypesRegistered();
    const { policyId } = await context.params;
    const body = await readJsonBody(request).catch(() => ({}));
    const options = (body ?? {}) as { takenBefore?: string; notes?: string };

    const db = getAppDb();
    const policy = getBackupPolicy(db, policyId);
    if (!policy) return NextResponse.json({ error: "Backup rule not found" }, { status: 404 });

    const automation = listAutomations(db, { type: BACKUP_JOB_TYPE }).find(
      (entry) => entry.config.data.policyId === policyId
    );

    if (automation) {
      const outcome = await executeAutomation(db, automation.id, { trigger: "manual" });

      if (outcome.status === "skipped") {
        // Already running, or the engine refused before starting - a real
        // answer, not a failure to report.
        return NextResponse.json(
          { result: { stored: false, verified: false, message: outcome.message }, automationId: automation.id },
          { status: 409 }
        );
      }

      const [run] = listAutomationRuns(db, { automationId: automation.id, limit: 1 });
      const data = (run?.result?.data ?? {}) as { stored?: boolean; verified?: boolean; message?: string | null };

      return NextResponse.json({
        result: {
          stored: data.stored ?? outcome.status === "succeeded",
          verified: data.verified ?? outcome.status === "succeeded",
          message: data.message ?? run?.rollup?.message ?? outcome.message ?? null,
        },
        automationId: automation.id,
        runId: outcome.runId,
      });
    }

    const result = await runBackup(db, policy, {
      trigger: "manual",
      tier: "manual",
      takenBefore: options.takenBefore ?? null,
      notes: options.notes ?? null,
    });

    return NextResponse.json({
      result: { stored: result.stored, verified: result.verified, message: result.message ?? null },
      automationId: null,
    });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}
