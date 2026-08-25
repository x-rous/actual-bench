import { NextResponse } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { appDbErrorResponse, readJsonBody } from "@/lib/app-db/routeResponses";
import { createAutomation, listAutomations } from "@/lib/app-db/automationRepository";
import { ensureAutomationJobTypesRegistered } from "@/lib/automation/bootstrap";
import { listAutomationJobTypes } from "@/lib/automation/registry";
import { describeSchedule } from "@/lib/automation/schedule";
import { isAutomationRunning } from "@/lib/automation/engine";
import { listAutomationRuns } from "@/lib/app-db/automationRunRepository";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The Automations list. Each row carries what the UI needs to be honest about
 * an automation without a second request: its plain-language schedule, whether
 * it is running right now, and its most recent run.
 */
export function GET() {
  try {
    ensureAutomationJobTypesRegistered();
    const db = getAppDb();

    const automations = listAutomations(db).map((automation) => {
      const [lastRun] = listAutomationRuns(db, { automationId: automation.id, limit: 1 });
      return {
        ...automation,
        scheduleLabel: describeSchedule(automation),
        running: isAutomationRunning(automation.id),
        lastRun: lastRun ?? null,
      };
    });

    return NextResponse.json({
      automations,
      jobTypes: listAutomationJobTypes().map((jobType) => ({
        type: jobType.type,
        label: jobType.label,
        supportsReview: Boolean(jobType.classification),
      })),
    });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    ensureAutomationJobTypesRegistered();
    const body = await readJsonBody(request);
    const automation = createAutomation(getAppDb(), body);
    return NextResponse.json({ automation }, { status: 201 });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}
