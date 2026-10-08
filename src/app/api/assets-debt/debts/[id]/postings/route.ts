import { NextResponse } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { assetsDebtErrorResponse } from "@/lib/assets-debt/api/schemas";
import { listDebtPostings } from "@/lib/assets-debt/services/proposalService";

type Context = { params: Promise<{ id: string }> };
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Every posting of a debt, for the Activity timeline (T138). Read-only. */
export async function GET(_request: Request, context: Context) {
  try {
    const { id } = await context.params;
    return NextResponse.json({ postings: listDebtPostings(getAppDb(), id) });
  } catch (error) { return assetsDebtErrorResponse(error); }
}
