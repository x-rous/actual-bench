import { NextResponse } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { assetsDebtErrorResponse } from "@/lib/assets-debt/api/schemas";
import { reproducePosting } from "@/lib/assets-debt/services/reproduceService";

type Context = { params: Promise<{ id: string }> };
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Recompute a posting from stored inputs (FR-182, T135). No transport, no Actual access. */
export async function POST(_request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const result = reproducePosting(getAppDb(), id);
    if (!result) return NextResponse.json({ error: "Posting not found" }, { status: 404 });
    return NextResponse.json({ reproduction: result });
  } catch (error) { return assetsDebtErrorResponse(error); }
}
