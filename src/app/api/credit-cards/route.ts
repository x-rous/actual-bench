import { NextResponse } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { appDbErrorResponse, readJsonBody } from "@/lib/app-db/routeResponses";
import { applyCreditCardChanges, readCreditCardWorkspace } from "@/lib/app-db/creditCardRepository";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Credit-card metadata for one budget: Bench-owned, kept in the app database and never written to
 * Actual. GET returns everything for the budget; POST applies one guarded change set atomically
 * (200 committed · 409 conflict · 400 invalid · 503 storage unavailable).
 */
export function GET(request: Request) {
  try {
    const budget = new URL(request.url).searchParams.get("budgetSyncId")?.trim();
    if (!budget) return NextResponse.json({ error: "budgetSyncId is required" }, { status: 400 });
    return NextResponse.json(readCreditCardWorkspace(getAppDb(), budget));
  } catch (error) {
    return appDbErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = await readJsonBody(request);
    return NextResponse.json({ workspace: applyCreditCardChanges(getAppDb(), body) });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}
