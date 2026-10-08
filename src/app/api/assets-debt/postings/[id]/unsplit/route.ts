import { NextResponse } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { readJsonBody } from "@/lib/app-db/routeResponses";
import { assetsDebtErrorResponse, parseBody, reverseRequestSchema } from "@/lib/assets-debt/api/schemas";
import { proposeUnsplit } from "@/lib/assets-debt/services/postingWorkflowService";

type Context = { params: Promise<{ id: string }> };
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** "Unsplit" a recorded split already in Actual: a Review proposal; nothing reaches Actual until applied. */
export async function POST(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const body = parseBody(reverseRequestSchema, await readJsonBody(request));
    return NextResponse.json({ posting: proposeUnsplit(getAppDb(), id, { ...body, today: body.today ?? new Date().toISOString().slice(0, 10) }) });
  } catch (error) { return assetsDebtErrorResponse(error); }
}
