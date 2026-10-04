import { NextResponse } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { readJsonBody } from "@/lib/app-db/routeResponses";
import { assetsDebtErrorResponse, parseBody, previewRequestSchema } from "@/lib/assets-debt/api/schemas";
import { previewDebtPostings } from "@/lib/assets-debt/services/proposalService";

type Context = { params: Promise<{ id: string }> };
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Plan and record proposals (RD-084 P1.6 T136). Writes app-DB proposals only; never Actual. */
export async function POST(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const body = parseBody(previewRequestSchema, await readJsonBody(request));
    const result = previewDebtPostings(getAppDb(), id, body);
    if (!result.ok) return "notFound" in result ? NextResponse.json({ error: "Debt not found" }, { status: 404 }) : NextResponse.json({ blocked: result.blocked }, { status: 409 });
    return NextResponse.json(result);
  } catch (error) { return assetsDebtErrorResponse(error); }
}
