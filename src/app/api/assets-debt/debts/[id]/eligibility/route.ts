import { NextResponse } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { assetsDebtErrorResponse } from "@/lib/assets-debt/api/schemas";
import { storedDebtEligibility } from "@/lib/assets-debt/services/projectionService";

type RouteContext = { params: Promise<{ id: string }> };

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Strategy eligibility with a reason for each rejected strategy (FR-026, FR-030).
 * The client reports what the connected Actual can do; anything not reported
 * counts as unavailable, so the formula-rule strategy is never overclaimed.
 */
export async function GET(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const q = new URL(request.url).searchParams;
    const flag = (name: string) => q.get(name) === "1";
    const result = storedDebtEligibility(getAppDb(), id, {
      formulaRules: flag("formulaRules"),
      splitActions: flag("splitActions"),
      transferPayees: flag("transferPayees"),
      ruleReadback: flag("ruleReadback"),
    });
    if (!result.ok) return "notFound" in result ? NextResponse.json({ error: "Debt not found" }, { status: 404 }) : NextResponse.json({ blocked: result.blocked }, { status: 409 });
    return NextResponse.json({ eligibility: result.eligibility });
  } catch (error) {
    return assetsDebtErrorResponse(error);
  }
}
