import { NextResponse } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { appDbErrorResponse, readJsonBody } from "@/lib/app-db/routeResponses";
import {
  deleteAutomation,
  getAutomation,
  resumeAutomation,
  updateAutomation,
} from "@/lib/app-db/automationRepository";
import { isAutomationRunning } from "@/lib/automation/engine";
import { describeSchedule } from "@/lib/automation/schedule";

type RouteContext = { params: Promise<{ automationId: string }> };

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { automationId } = await context.params;
    const automation = getAutomation(getAppDb(), automationId);
    if (!automation) return NextResponse.json({ error: "Automation not found" }, { status: 404 });
    return NextResponse.json({
      automation: {
        ...automation,
        scheduleLabel: describeSchedule(automation),
        running: isAutomationRunning(automation),
      },
    });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}

/**
 * Edit an automation. `resume: true` is handled separately from `enabled: true`
 * on purpose: resuming clears the auto-pause and the failure streak, which is a
 * decision the user is making about a broken automation, not a config edit.
 */
export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { automationId } = await context.params;
    const db = getAppDb();
    const body = (await readJsonBody(request)) as Record<string, unknown>;

    if (body.resume === true) {
      const resumed = resumeAutomation(db, automationId);
      if (!resumed) return NextResponse.json({ error: "Automation not found" }, { status: 404 });
      return NextResponse.json({ automation: resumed });
    }

    const automation = updateAutomation(db, automationId, body);
    if (!automation) return NextResponse.json({ error: "Automation not found" }, { status: 404 });
    return NextResponse.json({ automation });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const { automationId } = await context.params;
    const deleted = deleteAutomation(getAppDb(), automationId);
    if (!deleted) return NextResponse.json({ error: "Automation not found" }, { status: 404 });
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}
