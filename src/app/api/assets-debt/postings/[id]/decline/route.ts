import { NextResponse } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { assetsDebtErrorResponse } from "@/lib/assets-debt/api/schemas";
import { declinePosting } from "@/lib/assets-debt/services/postingWorkflowService";

type Context = { params: Promise<{ id: string }> };
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** The user's "Not now": records `declined` with the decision time. No Actual access. */
export async function POST(_request: Request, context: Context) {
  try {
    const { id } = await context.params;
    return NextResponse.json({ posting: declinePosting(getAppDb(), id, new Date().toISOString()) });
  } catch (error) { return assetsDebtErrorResponse(error); }
}
