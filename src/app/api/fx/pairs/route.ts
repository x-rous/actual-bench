import { NextResponse } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { appDbErrorResponse } from "@/lib/app-db/routeResponses";
import { listFxPairsWithRates } from "@/lib/fx/repositories/fxRateRepository";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET: the currency pairs the registry holds rates for.
 *
 * The FX page's other source of pairs is the set of flows that convert
 * currency. That misses a pair somebody set up before building the flow: it
 * lived only in the page's state, so a reload lost it and its rates became
 * unreachable. A pair with a rate behind it is a pair.
 */
export function GET() {
  try {
    return NextResponse.json({ pairs: listFxPairsWithRates(getAppDb()) });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}
