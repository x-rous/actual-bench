import { NextResponse } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { appDbErrorResponse } from "@/lib/app-db/routeResponses";
import { listAutomations } from "@/lib/app-db/automationRepository";
import { getSyncFlow } from "@/lib/app-db/syncFlowRepository";
import { ensureAutomationJobTypesRegistered } from "@/lib/automation/bootstrap";
import { reconcileJobTypes, startAutomationRun } from "@/lib/automation/engine";
import { BUDGET_FILE_SYNC_JOB_TYPE } from "@/lib/automation/jobs/budgetFileSyncType";
import { vaultEnabled } from "@/lib/sync/vault";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ flowId: string }> };

/**
 * Run one unattended safe-sync for a flow now, instead of waiting for its next
 * scheduled run.
 *
 * It starts the flow's automation, exactly as the schedule does. This route
 * used to call the sync directly (F-190), which skipped the engine's
 * single-run claim, left no automation run behind, never updated the
 * automation's health, and could overlap a scheduled run of the same flow -
 * relying on duplicate markers to make that harmless. Now there is one way a
 * flow runs unattended.
 *
 * Answers 202 with the run's id; the page follows the run through
 * `GET /api/automations/runs/[runId]`.
 */
export async function POST(_request: Request, context: RouteContext) {
  try {
    if (!vaultEnabled()) {
      return NextResponse.json(
        { error: "The server vault is disabled (SYNC_VAULT_KEY unset), so unattended sync cannot run." },
        { status: 400 }
      );
    }
    const { flowId } = await context.params;
    const db = getAppDb();

    const flow = getSyncFlow(db, flowId);
    if (!flow) return NextResponse.json({ error: "This flow no longer exists." }, { status: 404 });
    // A disabled flow must not sync - mirror the scheduler, which skips it.
    if (!flow.enabled) {
      return NextResponse.json({ error: "This flow is disabled. Enable it to run a sync." }, { status: 409 });
    }

    // A flow switched to unattended moments ago may not have its automation
    // yet: the engine creates it on its next tick. Reconciling here is the
    // same idempotent step the read paths take.
    ensureAutomationJobTypesRegistered();
    await reconcileJobTypes(db);

    const automation = listAutomations(db, { type: BUDGET_FILE_SYNC_JOB_TYPE }).find(
      (entry) => entry.config.data.flowId === flowId
    );
    if (!automation) {
      return NextResponse.json({ error: "This flow isn't set to sync unattended." }, { status: 409 });
    }

    const start = startAutomationRun(db, automation.id, { trigger: "manual" });
    if (!start.started) {
      return NextResponse.json({ error: start.outcome.message ?? "The sync did not start." }, { status: 409 });
    }

    return NextResponse.json({ runId: start.runId, automationId: automation.id }, { status: 202 });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}
