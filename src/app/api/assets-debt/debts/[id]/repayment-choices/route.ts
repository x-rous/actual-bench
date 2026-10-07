import { NextResponse } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { readJsonBody } from "@/lib/app-db/routeResponses";
import { assetsDebtErrorResponse, parseBody, repaymentChoiceRequestSchema } from "@/lib/assets-debt/api/schemas";
import { clearRepaymentChoice, setRepaymentChoice } from "@/lib/assets-debt/services/repaymentChoiceService";
import { AppDbValidationError } from "@/lib/app-db/errors";

type Context = { params: Promise<{ id: string }> };
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** "This is the payment" for a due date (stored in Bench only; nothing in Actual changes). */
export async function POST(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const body = parseBody(repaymentChoiceRequestSchema, await readJsonBody(request));
    setRepaymentChoice(getAppDb(), id, body);
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) { return assetsDebtErrorResponse(error); }
}

/** Forget the choice for a due date (`?dueDate=`); matching decides again. */
export async function DELETE(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const dueDate = new URL(request.url).searchParams.get("dueDate");
    if (!dueDate || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) throw new AppDbValidationError("dueDate must be YYYY-MM-DD");
    clearRepaymentChoice(getAppDb(), id, dueDate);
    return NextResponse.json({ ok: true });
  } catch (error) { return assetsDebtErrorResponse(error); }
}
