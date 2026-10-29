import { NextResponse } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { getDebt } from "@/lib/app-db/debtRepository";
import { listDebtWrites, listLedgerEntries, listPaymentRules } from "@/lib/app-db/debtTrackingRepository";
import { getDebtObservation } from "@/lib/app-db/debtObservationRepository";
import { listDebtAnchors } from "@/lib/app-db/debtAnchorRepository";
import { assetsDebtErrorResponse } from "@/lib/assets-debt/api/schemas";

type RouteContext = { params: Promise<{ id: string }> };

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Everything Bench keeps about a loan's tracking in one read: classifications, payment rules, recent writes, the opening
 * statement and the restarts of the calculation.
 */
export async function GET(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const db = getAppDb();
    const debt = getDebt(db, id);
    if (!debt) return NextResponse.json({ error: "Loan not found" }, { status: 404 });
    const statement = debt.openingObservationId ? getDebtObservation(db, debt.openingObservationId) : null;
    return NextResponse.json({
      entries: listLedgerEntries(db, id), rules: listPaymentRules(db, id), writes: listDebtWrites(db, id, 100),
      openingStatement: statement ? { id: statement.id, date: statement.observedOn, principalMinor: statement.principalMinor } : null,
      anchors: listDebtAnchors(db, id).map((a) => ({ id: a.id, date: a.anchorDate, principalMinor: a.principalMinor, source: a.source })),
    });
  } catch (error) {
    return assetsDebtErrorResponse(error);
  }
}
