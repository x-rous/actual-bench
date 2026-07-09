import { NextResponse, type NextRequest } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { appDbErrorResponse, readJsonBody } from "@/lib/app-db/routeResponses";
import { createSyncFlowRun, listSyncFlowRuns } from "@/lib/app-db/syncRunRepository";
import { persistDraftPreviewRun } from "@/lib/sync/persistPlan";
import type { JsonObject, SyncRunTrigger } from "@/lib/app-db/types";
import type { SyncPlanResult } from "@/lib/sync/plannedChanges";

/** Triggers a client orchestrator is allowed to stamp on a persisted run. */
const ALLOWED_TRIGGERS: readonly SyncRunTrigger[] = ["manual_preview", "interval_safe_only"];

function normalizeTrigger(value: unknown): SyncRunTrigger {
  return typeof value === "string" && (ALLOWED_TRIGGERS as readonly string[]).includes(value)
    ? (value as SyncRunTrigger)
    : "manual_preview";
}

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(request: NextRequest) {
  try {
    const flowId = request.nextUrl.searchParams.get("flowId") ?? undefined;
    const rawLimit = request.nextUrl.searchParams.get("limit");
    let limit: number | undefined;
    if (rawLimit !== null) {
      const parsed = Number(rawLimit);
      if (!Number.isFinite(parsed) || parsed < 1) {
        return NextResponse.json({ error: "limit must be a positive number" }, { status: 400 });
      }
      limit = parsed;
    }
    return NextResponse.json({ runs: listSyncFlowRuns(getAppDb(), { flowId, limit }) });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}

type PreviewRunBody =
  | { kind: "draft"; plan: SyncPlanResult; summary?: JsonObject; sourceSnapshotSummary?: JsonObject; trigger?: SyncRunTrigger }
  | { kind: "failed"; flowId: string | null; summary?: JsonObject; error?: JsonObject };

/**
 * Persist a dry-run preview from a client-run orchestrator (RD-053 / PR-019
 * Slice 5). The planner/orchestrator runs in the browser (Direct transport);
 * this endpoint only writes the resulting plan to the server-side app DB.
 */
export async function POST(request: Request) {
  try {
    const body = (await readJsonBody(request)) as PreviewRunBody;
    const db = getAppDb();

    if (body.kind === "failed") {
      const run = createSyncFlowRun(db, {
        flowId: body.flowId ?? null,
        status: "failed",
        createdByTrigger: "manual_preview",
        finishedAt: new Date().toISOString(),
        summary: { version: 1, data: { ...body.summary } },
        error: { version: 1, data: { ...body.error } },
      });
      return NextResponse.json({ runId: run.id }, { status: 201 });
    }

    const { run } = persistDraftPreviewRun(db, body.plan, {
      summary: body.summary,
      sourceSnapshotSummary: body.sourceSnapshotSummary,
      trigger: normalizeTrigger(body.trigger),
    });
    return NextResponse.json({ runId: run.id }, { status: 201 });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}
