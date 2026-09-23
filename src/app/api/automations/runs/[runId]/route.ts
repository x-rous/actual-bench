import { NextResponse } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { appDbErrorResponse } from "@/lib/app-db/routeResponses";
import { getAutomationRun } from "@/lib/app-db/automationRunRepository";

type RouteContext = { params: Promise<{ runId: string }> };

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * One run, by id. "Run now" answers with a run id as soon as the run exists
 * rather than holding the request open until it ends (F-191); this is what the
 * page then follows it by.
 */
export async function GET(_request: Request, context: RouteContext) {
  try {
    const { runId } = await context.params;
    const run = getAutomationRun(getAppDb(), runId);
    if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });
    return NextResponse.json({ run });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}
