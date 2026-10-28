import { NextResponse } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { readJsonBody } from "@/lib/app-db/routeResponses";
import { startDebtWrite } from "@/lib/app-db/debtTrackingRepository";
import { assetsDebtErrorResponse } from "@/lib/assets-debt/api/schemas";

type RouteContext = { params: Promise<{ id: string }> };

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Record that the user started a write to Actual (one at a time per loan). The browser then writes and reports back. */
export async function POST(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    return NextResponse.json({ write: startDebtWrite(getAppDb(), id, await readJsonBody(request)) });
  } catch (error) {
    return assetsDebtErrorResponse(error);
  }
}
