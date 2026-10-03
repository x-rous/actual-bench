import { NextResponse } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { readJsonBody } from "@/lib/app-db/routeResponses";
import {
  assetsDebtErrorResponse,
  createMatchRuleRequestSchema,
  parseBody,
  updateMatchRuleRequestSchema,
} from "@/lib/assets-debt/api/schemas";
import {
  createMatchingRule,
  editMatchingRule,
  listMatchingRules,
  removeMatchingRule,
} from "@/lib/assets-debt/services/matchingService";

type RouteContext = { params: Promise<{ id: string }> };

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    return NextResponse.json({ rules: listMatchingRules(getAppDb(), id) });
  } catch (error) {
    return assetsDebtErrorResponse(error);
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const body = parseBody(createMatchRuleRequestSchema, await readJsonBody(request));
    return NextResponse.json({ rule: createMatchingRule(getAppDb(), id, body.rule, body.enableBacktest) }, { status: 201 });
  } catch (error) {
    return assetsDebtErrorResponse(error);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const body = parseBody(updateMatchRuleRequestSchema, await readJsonBody(request));
    return NextResponse.json({ rule: editMatchingRule(getAppDb(), id, body.ruleId, body.rule, body.enableBacktest) });
  } catch (error) {
    return assetsDebtErrorResponse(error);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const ruleId = new URL(request.url).searchParams.get("ruleId");
    if (!ruleId) return NextResponse.json({ error: "ruleId is required" }, { status: 400 });
    removeMatchingRule(getAppDb(), id, ruleId);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return assetsDebtErrorResponse(error);
  }
}
