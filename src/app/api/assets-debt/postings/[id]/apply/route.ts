import { NextResponse } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { readJsonBody } from "@/lib/app-db/routeResponses";
import { applyRequestSchema, assetsDebtErrorResponse, parseBody } from "@/lib/assets-debt/api/schemas";
import { approveAndBeginApply, beginCompleteLink, PostingNotApproved, PreflightRefused } from "@/lib/assets-debt/services/postingWorkflowService";

type Context = { params: Promise<{ id: string }> };
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The user's explicit **Apply this change** (RD-084 P1.6 T136; SC-018). The
 * only route that can lead to an Actual write: it re-runs preflight, records
 * the decision (`approved`, `decided_at` from the server clock) and starts
 * applying, then hands the browser a ticket its executor will accept. Refuses
 * a Blocked proposal. `complete-link` is the user's explicit completion of an
 * interrupted transfer link on a posting they already approved.
 */
export async function POST(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const body = parseBody(applyRequestSchema, await readJsonBody(request));
    const db = getAppDb();
    const ticket = body.action === "complete-link"
      ? beginCompleteLink(db, id)
      : approveAndBeginApply(db, id, { fresh: body.fresh, decidedAt: new Date().toISOString() });
    return NextResponse.json({ ticket });
  } catch (error) {
    if (error instanceof PreflightRefused) return NextResponse.json({ error: error.message, code: "POSTING_PREFLIGHT_REFUSED", differences: error.differences }, { status: 409 });
    if (error instanceof PostingNotApproved) return NextResponse.json({ error: error.message, code: "POSTING_NOT_APPROVED" }, { status: 409 });
    return assetsDebtErrorResponse(error);
  }
}
