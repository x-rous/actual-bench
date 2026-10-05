import { NextResponse } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { assetsDebtErrorResponse } from "@/lib/assets-debt/api/schemas";
import { listNeedsAttention } from "@/lib/assets-debt/services/attentionService";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** What needs the user across this budget's loans (T293). Read-only; never reads Actual. */
export function GET(request: Request) {
  try {
    const budgetSyncId = new URL(request.url).searchParams.get("budgetSyncId");
    if (!budgetSyncId) return NextResponse.json({ error: "budgetSyncId is required" }, { status: 400 });
    return NextResponse.json({ items: listNeedsAttention(getAppDb(), budgetSyncId) });
  } catch (error) {
    return assetsDebtErrorResponse(error);
  }
}
