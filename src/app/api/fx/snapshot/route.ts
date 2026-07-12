import { NextResponse } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { appDbErrorResponse, readJsonBody } from "@/lib/app-db/routeResponses";
import { saveTransactionFx } from "@/lib/fx/repositories/transactionFxRepository";
import type { TransactionFxInput } from "@/lib/fx/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Persist an immutable per-transaction FX snapshot after a converted create
 * (RD-056 / PR-025c). Called by the client apply; the server apply writes the
 * snapshot directly. Idempotent on transaction_id.
 */
export async function POST(request: Request) {
  try {
    const body = (await readJsonBody(request)) as (TransactionFxInput & { isManual?: boolean }) | null;
    if (!body?.transactionId || !body?.appliedRate) {
      return NextResponse.json({ error: "transactionId and appliedRate are required." }, { status: 400 });
    }
    const snapshot = saveTransactionFx(getAppDb(), { ...body, source: body.source as import("@/lib/fx/types").FxRateSource, isManual: body.isManual ?? false });
    return NextResponse.json({ snapshot });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}
