import { NextResponse } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { assetsDebtErrorResponse } from "@/lib/assets-debt/api/schemas";
import { removeExtraPayment } from "@/lib/assets-debt/services/extraPaymentService";

type Context = { params: Promise<{ id: string; transactionId: string }> };
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Undo a recorded extra payment: unlink it and take its event out of Terms & Schedule. */
export async function DELETE(_request: Request, context: Context) {
  try {
    const { id, transactionId } = await context.params;
    return NextResponse.json({ debt: removeExtraPayment(getAppDb(), id, transactionId) });
  } catch (error) { return assetsDebtErrorResponse(error); }
}
