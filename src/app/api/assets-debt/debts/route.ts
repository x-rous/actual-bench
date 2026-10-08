import { NextResponse } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { readJsonBody } from "@/lib/app-db/routeResponses";
import { assetsDebtErrorResponse, debtSaveRequestSchema, parseBody } from "@/lib/assets-debt/api/schemas";
import { createDebtConfiguration, listDebtSummaries } from "@/lib/assets-debt/services/debtConfigService";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Debts in one budget. Configuration only: nothing here reads or writes Actual. */
export function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const budgetSyncId = url.searchParams.get("budgetSyncId");
    if (!budgetSyncId) return NextResponse.json({ error: "budgetSyncId is required" }, { status: 400 });
    return NextResponse.json({ debts: listDebtSummaries(getAppDb(), budgetSyncId, url.searchParams.get("includeArchived") === "1") });
  } catch (error) {
    return assetsDebtErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const { debt, accountDirectory } = parseBody(debtSaveRequestSchema, await readJsonBody(request));
    return NextResponse.json({ debt: createDebtConfiguration(getAppDb(), debt, accountDirectory) }, { status: 201 });
  } catch (error) {
    return assetsDebtErrorResponse(error);
  }
}
