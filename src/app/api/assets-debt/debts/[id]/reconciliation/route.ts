import { NextResponse } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { readJsonBody } from "@/lib/app-db/routeResponses";
import { assetsDebtErrorResponse, driftAcceptanceRequestSchema, parseBody, reconciliationRequestSchema } from "@/lib/assets-debt/api/schemas";
import { reconcileDebt } from "@/lib/assets-debt/services/reconciliationService";
import { getDebt, setDebtDriftAcceptedRevision } from "@/lib/app-db/debtRepository";

type Context = { params: Promise<{ id: string }> };
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const body = parseBody(reconciliationRequestSchema, await readJsonBody(request));
    const result = reconcileDebt(getAppDb(), { debtId: id, ...body });
    if (!result.ok) return "notFound" in result ? NextResponse.json({ error: "Debt not found" }, { status: 404 }) : NextResponse.json({ blocked: result.blocked }, { status: 409 });
    return NextResponse.json({ reconciliation: result });
  } catch (error) { return assetsDebtErrorResponse(error); }
}

export async function PATCH(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    parseBody(driftAcceptanceRequestSchema, await readJsonBody(request));
    const db = getAppDb();
    const debt = getDebt(db, id);
    if (!debt) return NextResponse.json({ error: "Debt not found" }, { status: 404 });
    return NextResponse.json({ debt: setDebtDriftAcceptedRevision(db, id, debt.currentRevision) });
  } catch (error) { return assetsDebtErrorResponse(error); }
}
