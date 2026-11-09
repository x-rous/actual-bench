import { NextResponse } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { appDbErrorResponse, readJsonBody } from "@/lib/app-db/routeResponses";
import { applyAccountFlagChanges, listAccountFlags } from "@/lib/app-db/accountFlagRepository";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Account flags are Bench metadata scoped to one budget; nothing is read from or written to Actual here. */
export function GET(request: Request) {
  try {
    const budget = new URL(request.url).searchParams.get("budgetSyncId")?.trim();
    if (!budget) {
      return NextResponse.json({ error: "budgetSyncId is required" }, { status: 400 });
    }
    return NextResponse.json({ accountFlags: listAccountFlags(getAppDb(), budget) });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}

/** Applies a batch of changes atomically and returns the budget's full list. */
export async function PUT(request: Request) {
  try {
    const body = await readJsonBody(request);
    return NextResponse.json({ accountFlags: applyAccountFlagChanges(getAppDb(), body) });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}
