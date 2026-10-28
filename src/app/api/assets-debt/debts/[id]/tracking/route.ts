import { NextResponse } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { getDebt } from "@/lib/app-db/debtRepository";
import { listDebtWrites, listLedgerEntries, listPaymentRules } from "@/lib/app-db/debtTrackingRepository";
import { assetsDebtErrorResponse } from "@/lib/assets-debt/api/schemas";

type RouteContext = { params: Promise<{ id: string }> };

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Everything Bench keeps about a loan's tracking in one read: classifications, payment rules and recent writes. */
export async function GET(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const db = getAppDb();
    if (!getDebt(db, id)) return NextResponse.json({ error: "Loan not found" }, { status: 404 });
    return NextResponse.json({ entries: listLedgerEntries(db, id), rules: listPaymentRules(db, id), writes: listDebtWrites(db, id, 100) });
  } catch (error) {
    return assetsDebtErrorResponse(error);
  }
}
