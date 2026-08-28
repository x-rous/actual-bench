import { NextResponse } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { appDbErrorResponse } from "@/lib/app-db/routeResponses";
import { listAutomations } from "@/lib/app-db/automationRepository";
import { listAutomationRuns } from "@/lib/app-db/automationRunRepository";
import { ensureAutomationJobTypesRegistered } from "@/lib/automation/bootstrap";
import { listAutomationJobTypes } from "@/lib/automation/registry";
import type { AutomationRunStatus } from "@/lib/app-db/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const STATUSES: AutomationRunStatus[] = [
  "running",
  "succeeded",
  "partial",
  "failed",
  "cancelled",
  "no_changes",
];

/**
 * Every run, across every automation, filtered.
 *
 * The per-automation endpoint answers "how has this one been doing"; this one
 * answers the question people actually arrive with after a bad night - "what
 * failed?" - which no amount of opening automations one at a time answers well.
 *
 * Each run carries its automation's name and job type, so the list is readable
 * without a second request per row.
 */
export async function GET(request: Request) {
  try {
    ensureAutomationJobTypesRegistered();
    const db = getAppDb();
    const params = new URL(request.url).searchParams;

    const requested = params.getAll("status").filter((value): value is AutomationRunStatus =>
      STATUSES.includes(value as AutomationRunStatus)
    );
    const automationId = params.get("automation") ?? undefined;
    const type = params.get("type") ?? undefined;
    const limit = Number(params.get("limit") ?? "100");

    const runs = listAutomationRuns(db, {
      automationId,
      type,
      statuses: requested.length > 0 ? requested : undefined,
      limit: Number.isFinite(limit) ? limit : 100,
    });

    const names = new Map(listAutomations(db).map((automation) => [automation.id, automation.name]));
    const typeLabels = new Map(listAutomationJobTypes().map((jobType) => [jobType.type, jobType.label]));

    return NextResponse.json({
      runs: runs.map((run) => ({
        ...run,
        // Deleting an automation cascades to its runs, so this is a fallback
        // rather than the deletion story: a run whose automation cannot be
        // resolved still belongs in the history, named as best we can.
        automationName: (run.automationId && names.get(run.automationId)) || "Deleted automation",
        typeLabel: typeLabels.get(run.type) ?? run.type,
      })),
      automations: listAutomations(db).map((automation) => ({
        id: automation.id,
        name: automation.name,
        type: automation.type,
      })),
      jobTypes: listAutomationJobTypes().map((jobType) => ({
        type: jobType.type,
        label: jobType.label,
      })),
    });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}
