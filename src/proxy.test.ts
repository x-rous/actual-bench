import { NextRequest } from "next/server";
import { isCrossSiteWrite, proxy } from "./proxy";

function request(path: string, method: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(`https://bench.example${path}`, {
    method,
    headers: { host: "bench.example", ...headers },
  });
}

describe("isCrossSiteWrite", () => {
  it("never refuses a safe method, whatever its origin", () => {
    for (const method of ["GET", "HEAD", "OPTIONS"]) {
      expect(isCrossSiteWrite(request("/api/x", method, { "sec-fetch-site": "cross-site" }))).toBe(false);
    }
  });

  it("trusts Sec-Fetch-Site when the browser sends it", () => {
    expect(isCrossSiteWrite(request("/api/x", "POST", { "sec-fetch-site": "same-origin" }))).toBe(false);
    expect(isCrossSiteWrite(request("/api/x", "POST", { "sec-fetch-site": "none" }))).toBe(false);
    expect(isCrossSiteWrite(request("/api/x", "POST", { "sec-fetch-site": "cross-site" }))).toBe(true);
    // A sibling subdomain is still another app.
    expect(isCrossSiteWrite(request("/api/x", "POST", { "sec-fetch-site": "same-site" }))).toBe(true);
  });

  it("falls back to comparing Origin with the addressed host", () => {
    expect(isCrossSiteWrite(request("/api/x", "POST", { origin: "https://bench.example" }))).toBe(false);
    expect(isCrossSiteWrite(request("/api/x", "DELETE", { origin: "https://evil.example" }))).toBe(true);
    expect(isCrossSiteWrite(request("/api/x", "POST", { origin: "null" }))).toBe(true);
  });

  it("accepts the host a reverse proxy forwarded", () => {
    const behindProxy = request("/api/x", "POST", {
      host: "bench:3000",
      "x-forwarded-host": "bench.example",
      origin: "https://bench.example",
    });
    expect(isCrossSiteWrite(behindProxy)).toBe(false);
  });

  it("lets a request with neither header through (not from a browser page)", () => {
    expect(isCrossSiteWrite(request("/api/x", "POST"))).toBe(false);
  });
});

describe("proxy", () => {
  it("refuses a cross-site API write before the route runs", async () => {
    const response = proxy(request("/api/connection-vault/reset", "POST", { "sec-fetch-site": "cross-site" }));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Cross-site request refused." });
  });

  it("passes same-origin API writes without the page isolation headers", () => {
    const response = proxy(request("/api/connection-vault/lock", "POST", { "sec-fetch-site": "same-origin" }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cross-origin-embedder-policy")).toBeNull();
  });

  it("keeps Direct mode's cross-origin isolation headers on pages", () => {
    const response = proxy(request("/connect", "GET"));
    expect(response.headers.get("cross-origin-opener-policy")).toBe("same-origin");
    expect(response.headers.get("cross-origin-embedder-policy")).toBe("require-corp");
    expect(response.headers.get("cross-origin-resource-policy")).toBe("same-origin");
  });
});
