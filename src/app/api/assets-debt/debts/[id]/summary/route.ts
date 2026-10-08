import { NextResponse } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { readJsonBody } from "@/lib/app-db/routeResponses";
import { assetsDebtErrorResponse, loanSummaryRequestSchema, parseBody } from "@/lib/assets-debt/api/schemas";
import { summarizeStoredLoan } from "@/lib/assets-debt/services/loanSummaryService";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const result = summarizeStoredLoan(getAppDb(), id, parseBody(loanSummaryRequestSchema, await readJsonBody(request)));
    if (!result.ok) return NextResponse.json(result, { status: "notFound" in result ? 404 : 409 });
    return NextResponse.json(result);
  } catch (error) { return assetsDebtErrorResponse(error); }
}
