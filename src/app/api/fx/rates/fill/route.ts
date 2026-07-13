import { NextResponse } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { appDbErrorResponse, readJsonBody } from "@/lib/app-db/routeResponses";
import { fillFxRateRange } from "@/lib/fx/services/fillFxRateRange";
import { createFrankfurterProvider } from "@/lib/fx/providers/frankfurter";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Pre-fetch and store a continuous daily rate series for a pair (RD-056 / PR-025e). */
export async function POST(request: Request) {
  try {
    const body = (await readJsonBody(request)) as { baseCurrency?: string; quoteCurrency?: string; from?: string; to?: string } | null;
    if (!body?.baseCurrency || !body?.quoteCurrency || !body?.from || !body?.to) {
      return NextResponse.json({ error: "baseCurrency, quoteCurrency, from and to are required." }, { status: 400 });
    }
    const result = await fillFxRateRange(getAppDb(), body as { baseCurrency: string; quoteCurrency: string; from: string; to: string }, createFrankfurterProvider());
    return NextResponse.json({ result });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}
