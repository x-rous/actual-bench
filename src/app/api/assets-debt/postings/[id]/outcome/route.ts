import { NextResponse } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { readJsonBody } from "@/lib/app-db/routeResponses";
import { applyOutcomeSchema, assetsDebtErrorResponse, parseBody } from "@/lib/assets-debt/api/schemas";
import { recordApplyOutcome } from "@/lib/assets-debt/services/postingWorkflowService";

type Context = { params: Promise<{ id: string }> };
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Record what happened in Actual after the browser's executor or a read-only
 * recovery (T125–T131). It only records; it cannot start a write. Allowed only
 * from `applying` or `indeterminate`, which only an approved posting reaches.
 */
export async function POST(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const body = parseBody(applyOutcomeSchema, await readJsonBody(request));
    return NextResponse.json({ posting: recordApplyOutcome(getAppDb(), id, body) });
  } catch (error) { return assetsDebtErrorResponse(error); }
}
