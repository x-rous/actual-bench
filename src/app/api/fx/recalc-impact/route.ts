import { NextResponse } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { appDbErrorResponse } from "@/lib/app-db/routeResponses";
import { previewFxRecalcImpact } from "@/lib/fx/services/fxRecalcImpact";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Read-only impact of a rate change (RD-056 / PR-025f): the already-synced
 * transactions on a pair+date whose converted amount would differ under the
 * current active rate. Mutates nothing.
 */
export function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const base = url.searchParams.get("base");
    const quote = url.searchParams.get("quote");
    const date = url.searchParams.get("date");
    if (!base || !quote || !date) {
      return NextResponse.json({ error: "base, quote and date are required." }, { status: 400 });
    }
    return NextResponse.json(previewFxRecalcImpact(getAppDb(), { baseCurrency: base, quoteCurrency: quote, date }));
  } catch (error) {
    return appDbErrorResponse(error);
  }
}
