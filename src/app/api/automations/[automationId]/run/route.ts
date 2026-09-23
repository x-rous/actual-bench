import { NextResponse } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { appDbErrorResponse } from "@/lib/app-db/routeResponses";
import { startAutomationRun } from "@/lib/automation/engine";
import { ensureAutomationJobTypesRegistered } from "@/lib/automation/bootstrap";

type RouteContext = { params: Promise<{ automationId: string }> };

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Run now. Answers 202 with the run's id as soon as the run exists; the run
 * carries on in the background and the page follows it through
 * `GET /api/automations/runs/[runId]`. Holding the request open for the whole
 * run meant a reverse proxy could give up on a slow backup while it kept going.
 *
 * A run already in flight is refused with 409 rather than queued — the user
 * asked for a run, and silently doing nothing (or doubling up) is worse than
 * saying "it is already running".
 */
export async function POST(_request: Request, context: RouteContext) {
  try {
    ensureAutomationJobTypesRegistered();
    const { automationId } = await context.params;
    const start = startAutomationRun(getAppDb(), automationId, { trigger: "manual" });

    if (!start.started) {
      const notFound = start.outcome.message === "Automation not found";
      return NextResponse.json(
        { error: start.outcome.message ?? "The automation did not run." },
        { status: notFound ? 404 : 409 }
      );
    }

    return NextResponse.json({ runId: start.runId }, { status: 202 });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}
