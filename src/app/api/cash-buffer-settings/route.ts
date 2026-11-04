import { NextResponse } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { appDbErrorResponse, readJsonBody } from "@/lib/app-db/routeResponses";
import { readCashBufferSettings, saveCashBufferSettings } from "@/lib/app-db/cashBufferSettingsRepository";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** The cash buffer settings are Bench metadata scoped to one budget; nothing is read from or written to Actual here. */
export function GET(request: Request) {
  try {
    const budget = new URL(request.url).searchParams.get("budgetSyncId")?.trim();
    if (!budget) return NextResponse.json({ error: "budgetSyncId is required" }, { status: 400 });
    return NextResponse.json({ settings: readCashBufferSettings(getAppDb(), budget) });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}

/** Saves the budget's settings and returns them. */
export async function PUT(request: Request) {
  try {
    return NextResponse.json({ settings: saveCashBufferSettings(getAppDb(), await readJsonBody(request)) });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}
