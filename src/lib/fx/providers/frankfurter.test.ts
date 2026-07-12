import { createFrankfurterProvider } from "./frankfurter";
import { FxError } from "../errors";

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as unknown as Response;
}

describe("FrankfurterFxRateProvider", () => {
  const provider = (fetchImpl: typeof fetch) => createFrankfurterProvider({ fetchImpl });

  it("returns the exact-date rate", async () => {
    const fetchImpl = jest.fn(async () => jsonResponse({ base: "AED", rates: { "2026-07-10": { AUD: 0.4162 } } }));
    const res = await provider(fetchImpl as unknown as typeof fetch).getRate({ baseCurrency: "aed", quoteCurrency: "aud", date: "2026-07-10" });
    expect(res).toMatchObject({ baseCurrency: "AED", quoteCurrency: "AUD", requestedDate: "2026-07-10", effectiveDate: "2026-07-10", rate: "0.4162", source: "frankfurter" });
  });

  it("falls back to the latest rate on or before the requested date (weekend)", async () => {
    // Sunday 2026-07-12 → use Friday 2026-07-10.
    const fetchImpl = jest.fn(async () => jsonResponse({ base: "AED", rates: { "2026-07-09": { AUD: 0.41 }, "2026-07-10": { AUD: 0.4162 } } }));
    const res = await provider(fetchImpl as unknown as typeof fetch).getRate({ baseCurrency: "AED", quoteCurrency: "AUD", date: "2026-07-12" });
    expect(res.effectiveDate).toBe("2026-07-10");
    expect(res.requestedDate).toBe("2026-07-12");
  });

  it("errors when no rate exists in the fallback window", async () => {
    const fetchImpl = jest.fn(async () => jsonResponse({ base: "AED", rates: {} }));
    await expect(provider(fetchImpl as unknown as typeof fetch).getRate({ baseCurrency: "AED", quoteCurrency: "AUD", date: "2026-07-10" })).rejects.toMatchObject({ code: "RATE_NOT_FOUND" });
  });

  it("maps timeout, network, non-ok, and bad JSON to typed errors", async () => {
    const timeout = jest.fn(async () => { throw Object.assign(new Error("t"), { name: "TimeoutError" }); });
    await expect(provider(timeout as unknown as typeof fetch).getRate({ baseCurrency: "AED", quoteCurrency: "AUD", date: "2026-07-10" })).rejects.toMatchObject({ code: "PROVIDER_TIMEOUT" });

    const network = jest.fn(async () => { throw new Error("ECONNREFUSED"); });
    await expect(provider(network as unknown as typeof fetch).getRate({ baseCurrency: "AED", quoteCurrency: "AUD", date: "2026-07-10" })).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });

    const notOk = jest.fn(async () => jsonResponse({}, false, 502));
    await expect(provider(notOk as unknown as typeof fetch).getRate({ baseCurrency: "AED", quoteCurrency: "AUD", date: "2026-07-10" })).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });

    const badJson = jest.fn(async () => ({ ok: true, status: 200, json: async () => { throw new Error("bad"); } }) as unknown as Response);
    await expect(provider(badJson as unknown as typeof fetch).getRate({ baseCurrency: "AED", quoteCurrency: "AUD", date: "2026-07-10" })).rejects.toMatchObject({ code: "INVALID_PROVIDER_RESPONSE" });
  });

  it("rejects an unsupported currency before fetching", async () => {
    const fetchImpl = jest.fn();
    await expect(provider(fetchImpl as unknown as typeof fetch).getRate({ baseCurrency: "AE", quoteCurrency: "AUD", date: "2026-07-10" })).rejects.toBeInstanceOf(FxError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
