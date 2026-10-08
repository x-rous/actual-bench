import { NextResponse } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { assetsDebtErrorResponse } from "@/lib/assets-debt/api/schemas";
import { removeDebtObservation } from "@/lib/assets-debt/services/observationService";

type Context = { params: Promise<{ id: string; observationId: string }> };
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Remove a lender statement with its corrections and any restart made from it (nothing in Actual changes). */
export async function DELETE(_request: Request, context: Context) {
  try {
    const { id, observationId } = await context.params;
    return NextResponse.json({ removed: removeDebtObservation(getAppDb(), id, observationId) });
  } catch (error) { return assetsDebtErrorResponse(error); }
}
