import { NextResponse } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { readJsonBody } from "@/lib/app-db/routeResponses";
import { assetsDebtErrorResponse, parseBody, reverseRequestSchema } from "@/lib/assets-debt/api/schemas";
import { proposeReversal } from "@/lib/assets-debt/services/postingWorkflowService";

type Context = { params: Promise<{ id: string }> };
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The user's **Undo** (FR-184, T132): creates a compensating reversal
 * proposal. It never writes to Actual; the reversal is applied only through
 * the apply route, on the user's own approval.
 */
export async function POST(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const body = parseBody(reverseRequestSchema, await readJsonBody(request));
    const posting = proposeReversal(getAppDb(), id, { ...body, today: new Date().toISOString().slice(0, 10) });
    return NextResponse.json({ posting });
  } catch (error) { return assetsDebtErrorResponse(error); }
}
