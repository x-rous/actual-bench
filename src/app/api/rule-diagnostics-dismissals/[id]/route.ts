import { NextResponse } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { appDbErrorResponse } from "@/lib/app-db/routeResponses";
import { deleteRuleDiagnosticsDismissal } from "@/lib/app-db/ruleDiagnosticsDismissalRepository";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Restoring one dismissed finding, so a mistaken dismissal is recoverable. */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    // Budget-scoped like every other operation on this table: an id on its own
    // would let one budget delete another budget's decision.
    const budgetSyncId = new URL(request.url).searchParams.get("budgetSyncId");
    if (!budgetSyncId) {
      return NextResponse.json({ error: "budgetSyncId is required" }, { status: 400 });
    }
    const removed = deleteRuleDiagnosticsDismissal(getAppDb(), id, budgetSyncId);
    if (!removed) {
      return NextResponse.json({ error: "Dismissal not found" }, { status: 404 });
    }
    return NextResponse.json({ removed: true });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}
