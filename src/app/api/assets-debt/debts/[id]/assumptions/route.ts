import { NextResponse } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { readJsonBody } from "@/lib/app-db/routeResponses";
import { assetsDebtErrorResponse, assumptionsRequestSchema, parseBody } from "@/lib/assets-debt/api/schemas";
import { saveBaselineAssumptions } from "@/lib/assets-debt/services/debtConfigService";

type RouteContext = { params: Promise<{ id: string }> };

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Save a calculator result as the baseline assumptions (FR-110): assumptions and a revision only. */
export async function PUT(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const { assumptions, changeSummary } = parseBody(assumptionsRequestSchema, await readJsonBody(request));
    return NextResponse.json({ debt: saveBaselineAssumptions(getAppDb(), id, assumptions, changeSummary) });
  } catch (error) {
    return assetsDebtErrorResponse(error);
  }
}
