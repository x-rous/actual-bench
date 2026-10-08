import { NextResponse } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { readJsonBody } from "@/lib/app-db/routeResponses";
import { assetsDebtErrorResponse, extraPaymentRequestSchema, parseBody } from "@/lib/assets-debt/api/schemas";
import { recordExtraPayment } from "@/lib/assets-debt/services/extraPaymentService";

type Context = { params: Promise<{ id: string }> };
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Record a payment found in Actual as this loan's extra payment (link + Terms & Schedule event; nothing in Actual). */
export async function POST(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const body = parseBody(extraPaymentRequestSchema, await readJsonBody(request));
    return NextResponse.json({ debt: recordExtraPayment(getAppDb(), id, body) }, { status: 201 });
  } catch (error) { return assetsDebtErrorResponse(error); }
}
