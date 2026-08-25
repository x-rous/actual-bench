import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { appDbErrorResponse } from "@/lib/app-db/routeResponses";
import { ensureAutomationJobTypesRegistered } from "@/lib/automation/bootstrap";
import { runEngineTick } from "@/lib/automation/engine";
import { buildAutomationHealth } from "@/lib/automation/health";
import { vaultEnabled } from "@/lib/sync/vault";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * External trigger for the scheduler. POST runs one pass; GET returns status.
 * POST is guarded by a shared secret so an external cron can drive it without
 * exposing an open trigger.
 *
 * Since PR-043c this drives the **automation engine**, not the sync-specific
 * scheduler — Budget File Sync is one registered job type among others. The URL
 * and response shape are kept as they were, because self-hosted installs have
 * external crons pointing at them; breaking those to rename a path would be a
 * gratuitous upgrade failure. `flowId` in the response is now the automation id.
 */

export function GET() {
  try {
    ensureAutomationJobTypesRegistered();
    const report = buildAutomationHealth(getAppDb());

    return NextResponse.json({
      enabled: report.vaultEnabled,
      lastTickAt: report.checkedAt,
      inFlight: report.runningIds,
      pausedByHealth: report.automations.filter((a) => a.autoPausedAt).map((a) => a.id),
      lastResults: Object.fromEntries(
        report.automations
          .filter((automation) => automation.lastRunAt)
          .map((automation) => [
            automation.id,
            {
              status: automation.lastRunStatus ?? "unknown",
              at: automation.lastRunAt as string,
              message: automation.summary,
            },
          ])
      ),
    });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const secret = process.env.SYNC_SCHEDULER_SECRET;
    if (!secret) {
      return NextResponse.json(
        { error: "The scheduler trigger endpoint is disabled. Set SYNC_SCHEDULER_SECRET to enable it." },
        { status: 403 }
      );
    }
    const provided = Buffer.from(request.headers.get("x-scheduler-secret") ?? "");
    const expected = Buffer.from(secret);
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    }
    if (!vaultEnabled()) {
      return NextResponse.json({ error: "Credential vault is disabled (SYNC_VAULT_KEY unset)." }, { status: 400 });
    }

    ensureAutomationJobTypesRegistered();
    const summary = await runEngineTick(getAppDb());

    return NextResponse.json({
      at: summary.at,
      due: summary.due,
      ran: summary.ran.map((outcome) => ({
        flowId: outcome.automationId,
        status: outcome.status,
        message: outcome.message,
      })),
    });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}
