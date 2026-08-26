import { NextResponse } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { appDbErrorResponse } from "@/lib/app-db/routeResponses";
import { listAutomationRuns } from "@/lib/app-db/automationRunRepository";

type RouteContext = { params: Promise<{ automationId: string }> };

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request, context: RouteContext) {
  try {
    const { automationId } = await context.params;
    const limit = Number(new URL(request.url).searchParams.get("limit") ?? "25");
    return NextResponse.json({ runs: listAutomationRuns(getAppDb(), { automationId, limit }) });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}
