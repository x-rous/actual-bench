import { NextResponse } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { appDbErrorResponse, readJsonBody } from "@/lib/app-db/routeResponses";
import { deleteCashflowPlan, listCashflowPlans, saveCashflowPlan } from "@/lib/app-db/cashflowPlanRepository";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Cashflow plans are Bench planning data scoped to one budget; nothing is read from or written to Actual here. */
export function GET(request: Request) {
  try {
    const budget = new URL(request.url).searchParams.get("budgetSyncId")?.trim();
    if (!budget) return NextResponse.json({ error: "budgetSyncId is required" }, { status: 400 });
    return NextResponse.json({ plans: listCashflowPlans(getAppDb(), budget) });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}

/** Saves one plan (new when it has no id) and returns it with its new revision; a stale revision is a 409. */
export async function PUT(request: Request) {
  try {
    return NextResponse.json({ plan: saveCashflowPlan(getAppDb(), await readJsonBody(request)) });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}

export function DELETE(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    deleteCashflowPlan(getAppDb(), params.get("budgetSyncId") ?? "", params.get("id") ?? "");
    return NextResponse.json({ ok: true });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}
