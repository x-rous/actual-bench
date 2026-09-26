import { contentSecurityPolicy, createNonce } from "./contentSecurityPolicy";

function directives(policy: string): Record<string, string[]> {
  return Object.fromEntries(
    policy.split("; ").map((part) => {
      const [name, ...values] = part.split(" ");
      return [name, values];
    })
  );
}

describe("contentSecurityPolicy (RD-096)", () => {
  it("allows only this response's scripts, and WebAssembly but not eval, in production", () => {
    const policy = directives(contentSecurityPolicy({ nonce: "abc", dev: false }));
    expect(policy["script-src"]).toEqual(["'self'", "'nonce-abc'", "'strict-dynamic'", "'wasm-unsafe-eval'"]);
    expect(policy["script-src"]).not.toContain("'unsafe-inline'");
    expect(policy["script-src"]).not.toContain("'unsafe-eval'");
  });

  it("keeps the rules the app relies on", () => {
    const policy = directives(contentSecurityPolicy({ nonce: "abc", dev: false }));
    expect(policy["frame-ancestors"]).toEqual(["'none'"]);
    expect(policy["object-src"]).toEqual(["'none'"]);
    expect(policy["base-uri"]).toEqual(["'self'"]);
    // Direct mode reaches the Actual Server the user typed, from the browser.
    expect(policy["connect-src"]).toEqual(["'self'", "https:", "http:"]);
    // Actual's browser runtime starts its worker from a blob (or data) URL.
    expect(policy["worker-src"]).toEqual(["'self'", "blob:", "data:"]);
    expect(policy).not.toHaveProperty("upgrade-insecure-requests");
  });

  it("adds eval and the hot-reload socket only in development", () => {
    const policy = directives(contentSecurityPolicy({ nonce: "abc", dev: true }));
    expect(policy["script-src"]).toContain("'unsafe-eval'");
    expect(policy["connect-src"]).toEqual(expect.arrayContaining(["ws:", "wss:"]));
  });

  it("makes a different nonce each time", () => {
    const nonces = new Set(Array.from({ length: 20 }, () => createNonce()));
    expect(nonces.size).toBe(20);
    for (const nonce of nonces) expect(nonce).toMatch(/^[A-Za-z0-9+/]{22}==$/);
  });
});
