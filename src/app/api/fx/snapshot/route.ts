import { NextResponse } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { appDbErrorResponse, readJsonBody } from "@/lib/app-db/routeResponses";
import { saveTransactionFx, updateTransactionFxSnapshot } from "@/lib/fx/repositories/transactionFxRepository";
import type { FxRateSource, TransactionFxInput } from "@/lib/fx/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const FX_SOURCES: readonly FxRateSource[] = ["frankfurter", "user-upload", "manual", "derived"];

/**
 * Persist an immutable per-transaction FX snapshot after a converted create
 * (RD-056 / PR-025c). Called by the client apply; the server apply writes the
 * snapshot directly. Idempotent on transaction_id.
 */
export async function POST(request: Request) {
  try {
    const body = (await readJsonBody(request)) as (Partial<TransactionFxInput> & { isManual?: boolean }) | null;
    const missing = (["transactionId", "sourceCurrency", "targetCurrency", "appliedRate", "requestedDate", "effectiveDate"] as const).filter(
      (k) => typeof body?.[k] !== "string" || (body[k] as string) === ""
    );
    if (missing.length > 0) {
      return NextResponse.json({ error: `Missing or invalid: ${missing.join(", ")}.` }, { status: 400 });
    }
    if (typeof body?.sourceAmount !== "number" || typeof body?.convertedAmount !== "number") {
      return NextResponse.json({ error: "sourceAmount and convertedAmount must be numbers." }, { status: 400 });
    }
    if (!FX_SOURCES.includes(body.source as FxRateSource)) {
      return NextResponse.json({ error: `source must be one of ${FX_SOURCES.join(", ")}.` }, { status: 400 });
    }
    const snapshot = saveTransactionFx(getAppDb(), {
      ...(body as TransactionFxInput),
      provider: body.provider ?? null,
      isManual: body.isManual ?? false,
    });
    return NextResponse.json({ snapshot });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}

/** Revalue an existing snapshot after a confirmed rate-change re-sync (RD-056). */
export async function PATCH(request: Request) {
  try {
    const body = (await readJsonBody(request)) as (Partial<TransactionFxInput> & { appliedRate?: string }) | null;
    if (typeof body?.transactionId !== "string" || typeof body?.appliedRate !== "string") {
      return NextResponse.json({ error: "transactionId and appliedRate are required." }, { status: 400 });
    }
    if (typeof body.convertedAmount !== "number" || !FX_SOURCES.includes(body.source as FxRateSource)) {
      return NextResponse.json({ error: "convertedAmount (number) and a valid source are required." }, { status: 400 });
    }
    const updated = updateTransactionFxSnapshot(getAppDb(), body.transactionId, {
      fxRateId: body.fxRateId ?? null,
      appliedRate: body.appliedRate,
      convertedAmount: body.convertedAmount,
      requestedDate: body.requestedDate ?? "",
      effectiveDate: body.effectiveDate ?? body.requestedDate ?? "",
      source: body.source as FxRateSource,
      provider: body.provider ?? null,
    });
    return NextResponse.json({ ok: updated != null });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}
