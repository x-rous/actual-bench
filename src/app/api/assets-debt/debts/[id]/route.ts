import { NextResponse } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { readJsonBody } from "@/lib/app-db/routeResponses";
import { assetsDebtErrorResponse, debtSaveRequestSchema, parseBody } from "@/lib/assets-debt/api/schemas";
import { archiveDebtConfiguration, discardDraftDebt, getDebtDetail, updateDebtConfiguration } from "@/lib/assets-debt/services/debtConfigService";

type RouteContext = { params: Promise<{ id: string }> };

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const debt = getDebtDetail(getAppDb(), id);
    if (!debt) return NextResponse.json({ error: "Debt not found" }, { status: 404 });
    return NextResponse.json({ debt });
  } catch (error) {
    return assetsDebtErrorResponse(error);
  }
}

/** Edit a debt. A material change writes a new revision; a cosmetic one does not. */
export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const { debt, accountDirectory } = parseBody(debtSaveRequestSchema, await readJsonBody(request));
    return NextResponse.json({ debt: updateDebtConfiguration(getAppDb(), id, debt, accountDirectory) });
  } catch (error) {
    return assetsDebtErrorResponse(error);
  }
}

/** Archive a debt, or discard a draft (nothing can reference a draft). */
export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const db = getAppDb();
    const existing = getDebtDetail(db, id);
    if (!existing) return NextResponse.json({ error: "Debt not found" }, { status: 404 });
    if (existing.debt.status === "draft") {
      discardDraftDebt(db, id);
      return new NextResponse(null, { status: 204 });
    }
    return NextResponse.json({ debt: archiveDebtConfiguration(db, id) });
  } catch (error) {
    return assetsDebtErrorResponse(error);
  }
}
