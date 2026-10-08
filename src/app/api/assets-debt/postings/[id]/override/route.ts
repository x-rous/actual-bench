import { NextResponse } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { AppDbValidationError } from "@/lib/app-db/errors";
import { assetsDebtErrorResponse } from "@/lib/assets-debt/api/schemas";
import { overrideRepaymentSplit } from "@/lib/assets-debt/services/postingWorkflowService";

type Context = { params: Promise<{ id: string }> };
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** The user's edit of a proposed split's interest (FR-069d). Records a new Review proposal; no Actual access. */
export async function POST(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const body = (await request.json().catch(() => null)) as { interestMinor?: unknown; reason?: unknown } | null;
    if (!body || typeof body.interestMinor !== "number") throw new AppDbValidationError("interestMinor must be a number of minor units");
    const reason = typeof body.reason === "string" ? body.reason : null;
    return NextResponse.json({ posting: overrideRepaymentSplit(getAppDb(), id, { interestMinor: body.interestMinor, reason }, new Date().toISOString()) });
  } catch (error) { return assetsDebtErrorResponse(error); }
}
