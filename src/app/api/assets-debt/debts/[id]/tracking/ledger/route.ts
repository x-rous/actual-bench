import { NextResponse } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { readJsonBody } from "@/lib/app-db/routeResponses";
import { saveLedgerEntries } from "@/lib/app-db/debtTrackingRepository";
import { assetsDebtErrorResponse } from "@/lib/assets-debt/api/schemas";

type RouteContext = { params: Promise<{ id: string }> };

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Save the user's classifications of Actual rows (Bench only; Actual is not changed). */
export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const body = (await readJsonBody(request)) as { changes?: unknown };
    return NextResponse.json({ entries: saveLedgerEntries(getAppDb(), id, body?.changes) });
  } catch (error) {
    return assetsDebtErrorResponse(error);
  }
}
