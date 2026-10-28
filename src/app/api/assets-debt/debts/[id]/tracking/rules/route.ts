import { NextResponse } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { readJsonBody } from "@/lib/app-db/routeResponses";
import { savePaymentRule } from "@/lib/app-db/debtTrackingRepository";
import { assetsDebtErrorResponse } from "@/lib/assets-debt/api/schemas";

type RouteContext = { params: Promise<{ id: string }> };

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Create, edit or delete a payment rule: `{ kind: "save", rule }` or `{ kind: "delete", id }`. */
export async function PUT(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    return NextResponse.json({ rules: savePaymentRule(getAppDb(), id, await readJsonBody(request)) });
  } catch (error) {
    return assetsDebtErrorResponse(error);
  }
}
