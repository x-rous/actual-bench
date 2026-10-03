import { NextResponse } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { readJsonBody } from "@/lib/app-db/routeResponses";
import { assetsDebtErrorResponse, debtBacktestRequestSchema, parseBody } from "@/lib/assets-debt/api/schemas";
import { backtestStoredMatchingRule } from "@/lib/assets-debt/services/matchingService";

type RouteContext = { params: Promise<{ id: string }> };

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const { ruleId, ...backtest } = parseBody(debtBacktestRequestSchema, await readJsonBody(request));
    return NextResponse.json({ backtest: backtestStoredMatchingRule(getAppDb(), id, ruleId, backtest) });
  } catch (error) {
    return assetsDebtErrorResponse(error);
  }
}
