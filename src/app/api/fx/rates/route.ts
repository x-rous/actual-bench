import { NextResponse } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { appDbErrorResponse, readJsonBody } from "@/lib/app-db/routeResponses";
import { findFxRatesForDateRange, replaceActiveFxRate } from "@/lib/fx/repositories/fxRateRepository";
import { normalizeCurrency, assertValidDate } from "@/lib/fx/validation";
import { isValidRate } from "@/lib/fx/fxMath";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET: list registry rates for a pair + date range (RD-056 / PR-025d). */
export function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const base = url.searchParams.get("base");
    const quote = url.searchParams.get("quote");
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    if (!base || !quote || !from || !to) {
      return NextResponse.json({ error: "base, quote, from and to are required." }, { status: 400 });
    }
    const rates = findFxRatesForDateRange(getAppDb(), {
      baseCurrency: normalizeCurrency(base),
      quoteCurrency: normalizeCurrency(quote),
      fromDate: assertValidDate(from),
      toDate: assertValidDate(to),
    });
    return NextResponse.json({ rates });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}

/** POST: manual daily rate adjustment — versioned supersede + insert (FX doc §15). */
export async function POST(request: Request) {
  try {
    const body = (await readJsonBody(request)) as { baseCurrency?: string; quoteCurrency?: string; date?: string; rate?: string; notes?: string } | null;
    if (!body?.baseCurrency || !body?.quoteCurrency || !body?.date || !body?.rate) {
      return NextResponse.json({ error: "baseCurrency, quoteCurrency, date and rate are required." }, { status: 400 });
    }
    const base = normalizeCurrency(body.baseCurrency);
    const quote = normalizeCurrency(body.quoteCurrency);
    assertValidDate(body.date);
    if (base === quote) return NextResponse.json({ error: "Base and quote currencies must differ." }, { status: 400 });
    if (!isValidRate(body.rate)) return NextResponse.json({ error: "Rate must be a positive number." }, { status: 400 });

    const rate = replaceActiveFxRate(getAppDb(), {
      baseCurrency: base,
      quoteCurrency: quote,
      requestedDate: body.date,
      effectiveDate: body.date,
      rate: body.rate,
      source: "manual",
      isUserOverride: true,
      notes: body.notes ?? null,
    });
    return NextResponse.json({ rate }, { status: 201 });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}
