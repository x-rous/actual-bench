import { NextResponse } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { appDbErrorResponse, readJsonBody } from "@/lib/app-db/routeResponses";
import { createAutomation, listAutomations } from "@/lib/app-db/automationRepository";
import { ensureAutomationJobTypesRegistered } from "@/lib/automation/bootstrap";
import { getAutomationJobType, listAutomationJobTypes } from "@/lib/automation/registry";
import { describeSchedule } from "@/lib/automation/schedule";
import { buildAutomationHealth } from "@/lib/automation/health";
import { isAutomationRunning, reconcileJobTypes } from "@/lib/automation/engine";
import { listAutomationRuns } from "@/lib/app-db/automationRunRepository";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The Automations list. Each row carries what the UI needs to be honest about
 * an automation without a second request: its plain-language schedule, whether
 * it is running right now, and its most recent run.
 */
export async function GET() {
  try {
    ensureAutomationJobTypesRegistered();
    const db = getAppDb();
    // Pick up anything enrolled since the last tick, so the page cannot tell
    // someone the flow they just created does not exist.
    await reconcileJobTypes(db);

    // Status comes from the health module rather than being re-derived in the
    // UI: "is this healthy" is a judgement with rules (a stale run is a warning,
    // a cancelled one is neither success nor failure), and two implementations
    // of it would eventually disagree on the same screen.
    const health = new Map(
      buildAutomationHealth(db).automations.map((entry) => [entry.id, entry])
    );

    const automations = listAutomations(db).map((automation) => {
      const [lastRun] = listAutomationRuns(db, { automationId: automation.id, limit: 1 });
      const entry = health.get(automation.id);
      return {
        ...automation,
        scheduleLabel: describeSchedule(automation),
        running: isAutomationRunning(automation),
        lastRun: lastRun ?? null,
        typeLabel: entry?.typeLabel ?? automation.type,
        status: entry?.status ?? "idle",
        statusSummary: entry?.summary ?? "",
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

    // `null` is valid JSON, so reading `type` off it would throw a TypeError and
    // surface as a 500 — an invalid payload is a 400.
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return NextResponse.json({ error: "Automation payload must be an object" }, { status: 400 });
    }
    const payload = body as Record<string, unknown>;

    // Refuse a type nothing can run, rather than accepting it and pausing the
    // automation the first time the engine reaches it.
    if (typeof payload.type === "string" && !getAutomationJobType(payload.type.trim())) {
      return NextResponse.json(
        {
          error: `No automation of type "${payload.type}" exists. Known types: ${listAutomationJobTypes()
            .map((jobType) => jobType.type)
            .join(", ")}.`,
        },
        { status: 400 }
      );
    }

    const automation = createAutomation(getAppDb(), payload);
    return NextResponse.json({ automation }, { status: 201 });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}
