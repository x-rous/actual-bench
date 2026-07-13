import { NextResponse } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { appDbErrorResponse, readJsonBody } from "@/lib/app-db/routeResponses";
import { resolveFxBatch, type FxNeed } from "@/lib/fx/services/resolveFxBatch";
import { createFrankfurterProvider } from "@/lib/fx/providers/frankfurter";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Batch FX rate resolution for the preview (RD-056 / PR-025b). The preview posts
 * the distinct (base, quote, date) needs; the server resolves them against the
 * app-DB registry (Frankfurter fallback when allowed) and persists provider
 * fetches. Pending outcomes come back per-need so the caller can route those
 * items to review without failing the whole preview.
 */
export async function POST(request: Request) {
  try {
    const body = (await readJsonBody(request)) as { needs?: unknown; allowProvider?: boolean };
    const raw = Array.isArray(body?.needs) ? body.needs : [];
    if (raw.length === 0) {
      return NextResponse.json({ resolved: {}, pending: {} });
    }
    const isNeed = (n: unknown): n is FxNeed =>
      !!n && typeof n === "object" &&
      typeof (n as FxNeed).baseCurrency === "string" &&
      typeof (n as FxNeed).quoteCurrency === "string" &&
      typeof (n as FxNeed).date === "string";
    if (!raw.every(isNeed)) {
      return NextResponse.json({ error: "each need must have string baseCurrency, quoteCurrency and date." }, { status: 400 });
    }
    const needs = raw as FxNeed[];
    const provider = body?.allowProvider === false ? undefined : createFrankfurterProvider();
    const result = await resolveFxBatch(getAppDb(), needs, { provider });
    return NextResponse.json(result);
  } catch (error) {
    return appDbErrorResponse(error);
  }
}
