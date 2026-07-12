import { FxError } from "../errors";
import { normalizeCurrency, assertValidDate } from "../validation";
import { fallbackFromDate, pickEffectiveRate } from "../dateFallback";
import type { FxRateProvider } from "./fxRateProvider";
import type { FxRateResult } from "../types";

/**
 * Frankfurter provider (RD-056 / PR-025a, FX doc §2–3). Free, no API key,
 * historical daily rates. Uses a date-range request from up to
 * `FX_FALLBACK_DAYS` before the requested date and selects the latest rate on or
 * before it (weekend/holiday fallback), never a rate after the requested date.
 *
 * Server-only (network). Do not hard-code rates. `fetch` is injectable for tests.
 */

const DEFAULT_BASE_URL = "https://api.frankfurter.dev/v2";
const TIMEOUT_MS = 10_000;

/** Frankfurter range response shape (rates keyed by date, then quote). */
type FrankfurterRangeResponse = {
  base?: string;
  rates?: Record<string, Record<string, number>>;
};

export function createFrankfurterProvider(options?: {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}): FxRateProvider {
  const baseUrl = (options?.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
  const doFetch = options?.fetchImpl ?? fetch;

  return {
    name: "frankfurter",
    async getRate({ baseCurrency, quoteCurrency, date }): Promise<FxRateResult> {
      const base = normalizeCurrency(baseCurrency);
      const quote = normalizeCurrency(quoteCurrency);
      assertValidDate(date);
      const from = fallbackFromDate(date);
      const url = `${baseUrl}/rates?from=${from}&to=${date}&base=${base}&quotes=${quote}`;

      let response: Response;
      try {
        response = await doFetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      } catch (err) {
        if (err instanceof Error && err.name === "TimeoutError") {
          throw new FxError("PROVIDER_TIMEOUT", "The FX rate provider timed out.");
        }
        throw new FxError("PROVIDER_UNAVAILABLE", "Could not reach the FX rate provider.");
      }
      if (!response.ok) {
        throw new FxError("PROVIDER_UNAVAILABLE", `FX provider returned HTTP ${response.status}.`);
      }

      let body: FrankfurterRangeResponse;
      try {
        body = (await response.json()) as FrankfurterRangeResponse;
      } catch {
        throw new FxError("INVALID_PROVIDER_RESPONSE", "The FX provider returned an unreadable response.");
      }

      const entries = Object.entries(body.rates ?? {})
        .map(([d, quotes]) => ({ date: d, value: quotes?.[quote] }))
        .filter((e): e is { date: string; value: number } => typeof e.value === "number" && e.value > 0);
      const effective = pickEffectiveRate(entries, date);
      if (!effective) {
        throw new FxError("RATE_NOT_FOUND", `No ${base}/${quote} rate on or before ${date}.`);
      }

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
  };
}
