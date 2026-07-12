import { FxError } from "../errors";
import { normalizeCurrency, assertValidDate } from "../validation";
import { fallbackFromDate, pickEffectiveRate } from "../dateFallback";
import type { FxRateProvider } from "./fxRateProvider";
import type { FxRateResult } from "../types";

/**
 * Frankfurter provider (RD-056 / PR-025a, FX doc §2–3). Free, no API key,
 * historical daily rates. `getRate` uses a fallback window (latest rate on or
 * before the requested date); `getRateSeries` returns every available day in a
 * range (for the "fill range" pre-fetch).
 *
 * Server-only (network). Do not hard-code rates. `fetch` is injectable for tests.
 */

const DEFAULT_BASE_URL = "https://api.frankfurter.dev/v2";
const TIMEOUT_MS = 10_000;

/** Frankfurter v2 range response: a flat array of daily rates. */
type FrankfurterRangeRow = { date: string; base: string; quote: string; rate: number };

export function createFrankfurterProvider(options?: {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}): FxRateProvider {
  const baseUrl = (options?.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
  const doFetch = options?.fetchImpl ?? fetch;

  /** Fetch and parse the daily rate rows for a pair over [from, to]. */
  async function fetchSeries(base: string, quote: string, from: string, to: string): Promise<{ date: string; value: number }[]> {
    const url = `${baseUrl}/rates?from=${from}&to=${to}&base=${base}&quotes=${quote}`;
    let response: Response;
    try {
      response = await doFetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (err) {
      if (err instanceof Error && err.name === "TimeoutError") throw new FxError("PROVIDER_TIMEOUT", "The FX rate provider timed out.");
      throw new FxError("PROVIDER_UNAVAILABLE", "Could not reach the FX rate provider.");
    }
    if (!response.ok) throw new FxError("PROVIDER_UNAVAILABLE", `FX provider returned HTTP ${response.status}.`);

    let body: FrankfurterRangeRow[];
    try {
      body = (await response.json()) as FrankfurterRangeRow[];
    } catch {
      throw new FxError("INVALID_PROVIDER_RESPONSE", "The FX provider returned an unreadable response.");
    }
    if (!Array.isArray(body)) throw new FxError("INVALID_PROVIDER_RESPONSE", "Unexpected FX provider response shape.");
    return body
      .filter((row) => typeof row?.rate === "number" && row.rate > 0 && typeof row?.date === "string")
      .map((row) => ({ date: row.date, value: row.rate }));
  }

  return {
    name: "frankfurter",
    async getRate({ baseCurrency, quoteCurrency, date }): Promise<FxRateResult> {
      const base = normalizeCurrency(baseCurrency);
      const quote = normalizeCurrency(quoteCurrency);
      assertValidDate(date);
      const series = await fetchSeries(base, quote, fallbackFromDate(date), date);
      const effective = pickEffectiveRate(series, date);
      if (!effective) throw new FxError("RATE_NOT_FOUND", `No ${base}/${quote} rate on or before ${date}.`);
      return {
        provider: "frankfurter",
        baseCurrency: base,
        quoteCurrency: quote,
        requestedDate: date,
        effectiveDate: effective.date,
        rate: String(effective.value),
        source: "frankfurter",
        isManual: false,
        fxRateId: null,
      };
    },
    async getRateSeries({ baseCurrency, quoteCurrency, from, to }) {
      const base = normalizeCurrency(baseCurrency);
      const quote = normalizeCurrency(quoteCurrency);
      assertValidDate(from);
      assertValidDate(to);
      const series = await fetchSeries(base, quote, from, to);
      return series.map((s) => ({ date: s.date, rate: String(s.value) }));
    },
  };
}
