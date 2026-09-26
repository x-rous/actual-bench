import { NextRequest } from "next/server";
import { VAULT_COOKIE } from "@/lib/connectionVault/cookies";
import { clearAllSessions, createSession } from "@/lib/connectionVault/session";
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

  it("refuses an http:// page writing to the https:// app on the same host", () => {
    expect(isCrossSiteWrite(request("/api/x", "POST", { origin: "http://bench.example" }))).toBe(true);
    const behindProxy = new NextRequest("http://bench:3000/api/x", {
      method: "POST",
      headers: { host: "bench.example", "x-forwarded-proto": "https", origin: "http://bench.example" },
    });
    expect(isCrossSiteWrite(behindProxy)).toBe(true);
  });

  it("compares only the host when a TLS-terminating proxy doesn't say the scheme", () => {
    const noForwardedProto = new NextRequest("http://bench:3000/api/x", {
      method: "POST",
      headers: { host: "bench.example", origin: "https://bench.example" },
    });
    expect(isCrossSiteWrite(noForwardedProto)).toBe(false);
  });

  it("lets a request with neither header through (not from a browser page)", () => {
    expect(isCrossSiteWrite(request("/api/x", "POST"))).toBe(false);
  });
});

describe("proxy", () => {
  const savedAuth = process.env.ACTUAL_BENCH_AUTH;
  beforeEach(() => {
    process.env.ACTUAL_BENCH_AUTH = "none";
  });
  afterEach(() => {
    if (savedAuth === undefined) delete process.env.ACTUAL_BENCH_AUTH;
    else process.env.ACTUAL_BENCH_AUTH = savedAuth;
  });

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

describe("sign-in gate (RD-096)", () => {
  const savedAuth = process.env.ACTUAL_BENCH_AUTH;
  beforeEach(() => {
    delete process.env.ACTUAL_BENCH_AUTH;
  });
  afterEach(() => {
    clearAllSessions();
    if (savedAuth === undefined) delete process.env.ACTUAL_BENCH_AUTH;
    else process.env.ACTUAL_BENCH_AUTH = savedAuth;
  });

  function signedIn(path: string, method = "GET"): NextRequest {
    const token = createSession(Buffer.alloc(32));
    return request(path, method, { cookie: `${VAULT_COOKIE}=${token}`, "sec-fetch-site": "same-origin" });
  }

  it("sends a signed-out visitor to sign in, and back to where they were going", () => {
    const response = proxy(request("/budget-management?month=2026-09", "GET"));
    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location")!);
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("next")).toBe("/budget-management?month=2026-09");
  });

  it("answers a signed-out API call with a marked 401", async () => {
    const response = proxy(request("/api/backups", "GET"));
    expect(response.status).toBe(401);
    expect(response.headers.get("x-bench-auth")).toBe("signed-out");
    expect(await response.json()).toEqual({ error: "Sign in to continue.", code: "SIGNED_OUT" });
  });

  it("lets the sign-in page, its API and the health probe through", () => {
    for (const path of ["/login", "/api/health", "/api/connection-vault", "/_next/static/x.js"]) {
      expect(proxy(request(path, "GET")).status).toBe(200);
    }
    expect(proxy(request("/api/connection-vault/unlock", "POST", { "sec-fetch-site": "same-origin" })).status).toBe(200);
  });

  it("lets a signed-in browser through, pages keeping their isolation headers", () => {
    expect(proxy(signedIn("/api/backups")).status).toBe(200);
    const page = proxy(signedIn("/connect"));
    expect(page.status).toBe(200);
    expect(page.headers.get("cross-origin-embedder-policy")).toBe("require-corp");
  });

  it("sends a signed-in visitor on from the sign-in page", () => {
    const token = createSession(Buffer.alloc(32));
    const response = proxy(request("/login?next=/rules", "GET", { cookie: `${VAULT_COOKIE}=${token}` }));
    expect(response.status).toBe(307);
    expect(new URL(response.headers.get("location")!).pathname).toBe("/rules");
  });

  it("treats an unknown or expired session as signed out", () => {
    const response = proxy(request("/api/backups", "GET", { cookie: `${VAULT_COOKIE}=not-a-session` }));
    expect(response.status).toBe(401);
  });

  it("renews the session cookie on a page load, not on API calls", () => {
    const page = proxy(signedIn("/rules"));
    expect(page.headers.get("set-cookie")).toContain(`${VAULT_COOKIE}=`);
    expect(proxy(signedIn("/api/backups")).headers.get("set-cookie")).toBeNull();
  });

  it("sends a signed-out visit to / on to the connect page after sign-in", () => {
    const location = new URL(proxy(request("/", "GET")).headers.get("location")!);
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("next")).toBe("/connect");
  });

  it("is off with ACTUAL_BENCH_AUTH=none", () => {
    process.env.ACTUAL_BENCH_AUTH = "none";
    expect(proxy(request("/api/backups", "GET")).status).toBe(200);
  });
});
