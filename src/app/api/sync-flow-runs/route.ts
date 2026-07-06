import { NextResponse, type NextRequest } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { appDbErrorResponse } from "@/lib/app-db/routeResponses";
import { listSyncFlowRuns } from "@/lib/app-db/syncRunRepository";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(request: NextRequest) {
  try {
    const flowId = request.nextUrl.searchParams.get("flowId") ?? undefined;
    const rawLimit = request.nextUrl.searchParams.get("limit");
    const limit = rawLimit ? Number(rawLimit) : undefined;
    return NextResponse.json({ runs: listSyncFlowRuns(getAppDb(), { flowId, limit }) });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}
