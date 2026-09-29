import { NextResponse } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { readJsonBody } from "@/lib/app-db/routeResponses";
import { assetsDebtErrorResponse, parseBody, scheduleRequestSchema } from "@/lib/assets-debt/api/schemas";
import { projectStoredDebt } from "@/lib/assets-debt/services/projectionService";

type RouteContext = { params: Promise<{ id: string }> };

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Calculator and forecast (FR-105–FR-113). Temporary overrides apply to this
 * projection only and are never stored; a projection writes nothing anywhere.
 */
export async function POST(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const body = parseBody(scheduleRequestSchema, await readJsonBody(request));
    const result = projectStoredDebt(getAppDb(), id, body);
    if (!result.ok) return "notFound" in result ? NextResponse.json({ error: "Debt not found" }, { status: 404 }) : NextResponse.json({ blocked: result.blocked }, { status: 409 });
    return NextResponse.json({ projection: result.projection });
  } catch (error) {
    return assetsDebtErrorResponse(error);
  }
}
