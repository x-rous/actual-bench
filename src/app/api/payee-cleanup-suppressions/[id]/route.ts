import { NextResponse } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { appDbErrorResponse } from "@/lib/app-db/routeResponses";
import { deletePayeeCleanupSuppression } from "@/lib/app-db/payeeCleanupSuppressionRepository";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Undoing one decision, so a mistaken rejection is recoverable. */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const removed = deletePayeeCleanupSuppression(getAppDb(), id);
    if (!removed) {
      return NextResponse.json({ error: "Suppression not found" }, { status: 404 });
    }
    return NextResponse.json({ removed: true });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}
