import { NextResponse } from "next/server";
import { hasPostingLease } from "@/lib/app-db/debtPostingLeaseRepository";
import { AppDbValidationError } from "@/lib/app-db/errors";
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
    const db = getAppDb();
    if (hasPostingLease(db, id) && !body.executionToken) throw new AppDbValidationError("The running execution’s token is required to record its outcome.");
    return NextResponse.json({ posting: recordApplyOutcome(db, id, body, new Date().toISOString(), body.executionToken) });
  } catch (error) { return assetsDebtErrorResponse(error); }
}
