import { NextResponse } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { appDbErrorResponse, readJsonBody } from "@/lib/app-db/routeResponses";
import {
  updateSyncFlowRunItem,
  type UpdateSyncFlowRunItemPatch,
} from "@/lib/app-db/syncRunRepository";

type RouteContext = { params: Promise<{ itemId: string }> };

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { itemId } = await context.params;
    const patch = (await readJsonBody(request)) as UpdateSyncFlowRunItemPatch;
    const item = updateSyncFlowRunItem(getAppDb(), itemId, patch);
    if (!item) return NextResponse.json({ error: "Run item not found" }, { status: 404 });
    return NextResponse.json({ item });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}
