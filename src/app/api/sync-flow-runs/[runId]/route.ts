import { NextResponse } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { appDbErrorResponse, readJsonBody } from "@/lib/app-db/routeResponses";
import {
  getAllSyncFlowRunItems,
  getSyncFlowRun,
  updateSyncFlowRun,
  type UpdateSyncFlowRunPatch,
} from "@/lib/app-db/syncRunRepository";

type RouteContext = { params: Promise<{ runId: string }> };

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { runId } = await context.params;
    const db = getAppDb();
    const run = getSyncFlowRun(db, runId);
    if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });
    // Complete item set: apply reads this route and must see every planned item.
    return NextResponse.json({ run, items: getAllSyncFlowRunItems(db, runId) });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { runId } = await context.params;
    const patch = (await readJsonBody(request)) as UpdateSyncFlowRunPatch;
    const run = updateSyncFlowRun(getAppDb(), runId, patch);
    if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });
    return NextResponse.json({ run });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}
