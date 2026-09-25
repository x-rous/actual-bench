import nextConfig from "../next.config";

describe("next.config security settings", () => {
  it("does not announce the framework", () => {
    expect(nextConfig.poweredByHeader).toBe(false);
  });

  it("sends the baseline security headers on every path, API included", async () => {
    const rules = await nextConfig.headers!();
    expect(rules).toHaveLength(1);
    expect(rules[0].source).toBe("/:path*");

    const headers = Object.fromEntries(rules[0].headers.map(({ key, value }) => [key, value]));
    expect(headers).toEqual({
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "Permissions-Policy":
        "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()",
    });
    // The obsolete XSS filter is deliberately left unset.
    expect(headers).not.toHaveProperty("X-XSS-Protection");
  });

  it("redirects / to /connect temporarily", async () => {
    expect(await nextConfig.redirects!()).toEqual([
      { source: "/", destination: "/connect", permanent: false },
    ]);
  });
});
