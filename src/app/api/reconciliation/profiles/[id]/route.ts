import { NextResponse } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { appDbErrorResponse } from "@/lib/app-db/routeResponses";
import { deleteReconciliationProfile } from "@/lib/app-db/reconciliationRepository";

type RouteContext = { params: Promise<{ id: string }> };

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Sessions that referenced the profile survive with a null profile link. */
export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    if (!deleteReconciliationProfile(getAppDb(), id)) {
      return NextResponse.json({ error: "Reconciliation profile not found" }, { status: 404 });
    }
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}
