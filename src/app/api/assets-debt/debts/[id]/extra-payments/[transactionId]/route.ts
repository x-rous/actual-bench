import { NextResponse } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { AppDbValidationError } from "@/lib/app-db/errors";
import { assetsDebtErrorResponse } from "@/lib/assets-debt/api/schemas";
import { dismissExtraPayment, undismissExtraPayment } from "@/lib/assets-debt/services/extraPaymentService";

type Context = { params: Promise<{ id: string; transactionId: string }> };
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * "Not an extra payment" (`?date=` the transaction's date): stop counting it, take it out of Terms &
 * Schedule if it was recorded, and never record it automatically (owner decision 2026-10-07).
 */
export async function DELETE(request: Request, context: Context) {
  try {
    const { id, transactionId } = await context.params;
    const date = new URL(request.url).searchParams.get("date") ?? "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new AppDbValidationError("date must be YYYY-MM-DD");
    return NextResponse.json({ debt: dismissExtraPayment(getAppDb(), id, transactionId, date) });
  } catch (error) { return assetsDebtErrorResponse(error); }
}

/** Count it after all: the next refresh records it as an extra payment. */
export async function PATCH(_request: Request, context: Context) {
  try {
    const { id, transactionId } = await context.params;
    undismissExtraPayment(getAppDb(), id, transactionId);
    return NextResponse.json({ ok: true });
  } catch (error) { return assetsDebtErrorResponse(error); }
}
