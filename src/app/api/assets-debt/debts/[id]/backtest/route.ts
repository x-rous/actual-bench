import { NextResponse } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { readJsonBody } from "@/lib/app-db/routeResponses";
import { assetsDebtErrorResponse, debtBacktestRequestSchema, draftBacktestRequestSchema, parseBody } from "@/lib/assets-debt/api/schemas";
import { backtestDraftMatchingRule, backtestStoredMatchingRule } from "@/lib/assets-debt/services/matchingService";

type RouteContext = { params: Promise<{ id: string }> };

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const body = await readJsonBody(request);
    // A saved rule (its result is recorded on the rule) or an unsaved draft from the editor (nothing stored).
    if (body && typeof body === "object" && "rule" in body) {
      const { rule, ...backtest } = parseBody(draftBacktestRequestSchema, body);
      return NextResponse.json({ backtest: backtestDraftMatchingRule(getAppDb(), id, rule, backtest) });
    }
    const { ruleId, ...backtest } = parseBody(debtBacktestRequestSchema, body);
    return NextResponse.json({ backtest: backtestStoredMatchingRule(getAppDb(), id, ruleId, backtest) });
  } catch (error) {
    return assetsDebtErrorResponse(error);
  }
}
