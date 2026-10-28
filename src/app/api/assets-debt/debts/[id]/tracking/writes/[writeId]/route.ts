import { NextResponse } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { readJsonBody } from "@/lib/app-db/routeResponses";
import { finishDebtWrite } from "@/lib/app-db/debtTrackingRepository";
import { assetsDebtErrorResponse } from "@/lib/assets-debt/api/schemas";

type RouteContext = { params: Promise<{ id: string; writeId: string }> };

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Record how a write ended: applied, failed (nothing written) or uncertain (check Actual before anything else). */
export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { id, writeId } = await context.params;
    return NextResponse.json({ write: finishDebtWrite(getAppDb(), id, writeId, await readJsonBody(request)) });
  } catch (error) {
    return assetsDebtErrorResponse(error);
  }
}
