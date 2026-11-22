import { NextResponse } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { appDbErrorResponse, readJsonBody } from "@/lib/app-db/routeResponses";
import { saveTransactionFx, updateTransactionFxSnapshot } from "@/lib/fx/repositories/transactionFxRepository";
import type { SqliteDatabase } from "@/lib/app-db/types";
import type { FxRateSource, TransactionFxInput } from "@/lib/fx/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const FX_SOURCES: readonly FxRateSource[] = ["frankfurter", "user-upload", "manual", "derived"];

type SnapshotBody = Partial<TransactionFxInput> & { isManual?: boolean };

function snapshotError(body: SnapshotBody | null): string | null {
  const missing = (["transactionId", "sourceCurrency", "targetCurrency", "appliedRate", "requestedDate", "effectiveDate"] as const).filter(
    (k) => typeof body?.[k] !== "string" || (body[k] as string) === ""
  );
  if (missing.length > 0) return `Missing or invalid: ${missing.join(", ")}.`;
  if (typeof body?.sourceAmount !== "number" || typeof body?.convertedAmount !== "number") {
    return "sourceAmount and convertedAmount must be numbers.";
  }
  if (!FX_SOURCES.includes(body.source as FxRateSource)) return `source must be one of ${FX_SOURCES.join(", ")}.`;
  return null;
}

function saveSnapshot(db: SqliteDatabase, body: SnapshotBody) {
  return saveTransactionFx(db, {
    ...(body as TransactionFxInput),
    provider: body.provider ?? null,
    isManual: body.isManual ?? false,
  });
}

/**
 * Persist an immutable per-transaction FX snapshot after a converted create
 * (RD-056 / PR-025c). Called by the client apply; the server apply writes the
 * snapshot directly. Idempotent on transaction_id.
 */
export async function POST(request: Request) {
  try {
    const body = (await readJsonBody(request)) as (SnapshotBody & { snapshots?: unknown }) | null;
    // A batch from one apply run: all valid or none written, in one commit.
    if (Array.isArray(body?.snapshots)) {
      const snapshots = body.snapshots as SnapshotBody[];
      for (const snapshot of snapshots) {
        const error = snapshotError(snapshot);
        if (error) return NextResponse.json({ error }, { status: 400 });
      }
      const db = getAppDb();
      db.transaction(() => { for (const snapshot of snapshots) saveSnapshot(db, snapshot); })();
      return NextResponse.json({ saved: snapshots.length });
    }
    const error = snapshotError(body);
    if (error) return NextResponse.json({ error }, { status: 400 });
    return NextResponse.json({ snapshot: saveSnapshot(getAppDb(), body as SnapshotBody) });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}

/** Revalue an existing snapshot after a confirmed rate-change re-sync (RD-056). */
export async function PATCH(request: Request) {
  try {
    const body = (await readJsonBody(request)) as (Partial<TransactionFxInput> & { appliedRate?: string }) | null;
    if (typeof body?.transactionId !== "string" || body.transactionId === "" || typeof body?.appliedRate !== "string" || body.appliedRate === "") {
      return NextResponse.json({ error: "transactionId and appliedRate are required." }, { status: 400 });
    }
    if (typeof body.convertedAmount !== "number" || !FX_SOURCES.includes(body.source as FxRateSource)) {
      return NextResponse.json({ error: "convertedAmount (number) and a valid source are required." }, { status: 400 });
    }
    if (typeof body.requestedDate !== "string" || body.requestedDate === "" || typeof body.effectiveDate !== "string" || body.effectiveDate === "") {
      return NextResponse.json({ error: "requestedDate and effectiveDate are required." }, { status: 400 });
    }
    const updated = updateTransactionFxSnapshot(getAppDb(), body.transactionId, {
      fxRateId: body.fxRateId ?? null,
      sourceAmount: typeof body.sourceAmount === "number" ? body.sourceAmount : undefined,
      appliedRate: body.appliedRate,
      convertedAmount: body.convertedAmount,
      requestedDate: body.requestedDate,
      effectiveDate: body.effectiveDate,
      source: body.source as FxRateSource,
      provider: body.provider ?? null,
    });
    return NextResponse.json({ ok: updated != null });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}
