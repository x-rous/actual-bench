import { NextResponse } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { appDbErrorResponse, readJsonBody } from "@/lib/app-db/routeResponses";
import { deleteSyncFlow, getSyncFlow, updateSyncFlow } from "@/lib/app-db/syncFlowRepository";

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
    const flow = updateSyncFlow(getAppDb(), flowId, body);
    if (!flow) return NextResponse.json({ error: "Sync flow not found" }, { status: 404 });
    return NextResponse.json({ flow });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const { flowId } = await context.params;
    const deleted = deleteSyncFlow(getAppDb(), flowId);
    if (!deleted) return NextResponse.json({ error: "Sync flow not found" }, { status: 404 });
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}
