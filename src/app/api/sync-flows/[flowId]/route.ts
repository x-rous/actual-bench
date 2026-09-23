import { NextResponse } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { appDbErrorResponse, readJsonBody } from "@/lib/app-db/routeResponses";
import { deleteSyncFlow, getSyncFlow, updateSyncFlow } from "@/lib/app-db/syncFlowRepository";
import { syncAutomationsWithFlows } from "@/lib/sync/enrollment";

type RouteContext = {
  params: Promise<{ flowId: string }>;
};

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { flowId } = await context.params;
    const flow = getSyncFlow(getAppDb(), flowId);
    if (!flow) return NextResponse.json({ error: "Sync flow not found" }, { status: 404 });
    return NextResponse.json({ flow });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { flowId } = await context.params;
    const body = await readJsonBody(request);
    const db = getAppDb();
    const flow = updateSyncFlow(db, flowId, body);
    if (!flow) return NextResponse.json({ error: "Sync flow not found" }, { status: 404 });
    await syncAutomationsWithFlows(db);
    return NextResponse.json({ flow });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const { flowId } = await context.params;
    const db = getAppDb();
    const deleted = deleteSyncFlow(db, flowId);
    if (!deleted) return NextResponse.json({ error: "Sync flow not found" }, { status: 404 });
    // Takes the flow's automation with it, rather than leaving one enabled
    // against a flow that no longer exists.
    await syncAutomationsWithFlows(db);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}
