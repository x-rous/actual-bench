/** @jest-environment node */
import { X509Certificate } from "crypto";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { generateSelfSignedCertificate, httpsEnabled, resolveTlsMaterial } from "./https.mjs";

describe("built-in HTTPS certificate", () => {
  let dir: string;
  const env = (extra: Record<string, string> = {}) => ({ ACTUAL_BENCH_DB_PATH: join(dir, "actual-bench.sqlite"), ...extra });

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "bench-https-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("generates a valid self-signed certificate for names and IPv4/IPv6 addresses", () => {
    const { cert } = generateSelfSignedCertificate({ hosts: ["bench.lan", "192.168.1.50", "fd00::12"] });
    const x509 = new X509Certificate(cert);
    expect(x509.verify(x509.publicKey)).toBe(true);
    expect(x509.ca).toBe(false);
    expect(x509.checkHost("bench.lan")).toBe("bench.lan");
    expect(x509.checkIP("192.168.1.50")).toBe("192.168.1.50");
    expect(x509.checkIP("fd00::12")).toBe("fd00::12");
    expect(x509.checkIP("192.168.1.51")).toBeUndefined();
  });

  it("keeps the stored certificate across restarts, so the browser exception still applies", () => {
    const first = resolveTlsMaterial(env());
    const second = resolveTlsMaterial(env());
    expect(first.source).toBe("generated");
    expect(second.source).toBe("existing");
    expect(second.fingerprint).toBe(first.fingerprint);
  });

  it("replaces the certificate when a configured host is not covered, or it is near its end", () => {
    const first = resolveTlsMaterial(env());
    const withHost = resolveTlsMaterial(env({ ACTUAL_BENCH_HTTPS_HOSTS: "10.0.0.9" }));
    expect(withHost.source).toBe("generated");
    expect(new X509Certificate(withHost.cert).checkIP("10.0.0.9")).toBe("10.0.0.9");
    expect(withHost.fingerprint).not.toBe(first.fingerprint);

    const later = new Date(Date.now() + 820 * 24 * 60 * 60 * 1000);
    expect(resolveTlsMaterial(env({ ACTUAL_BENCH_HTTPS_HOSTS: "10.0.0.9" }), { now: later }).source).toBe("generated");
  });

  it("refuses only one of the operator's certificate and key", () => {
    expect(() => resolveTlsMaterial(env({ ACTUAL_BENCH_HTTPS_CERT: "/x/cert.pem" }))).toThrow(/both/);
  });

  it("reads the switch case-insensitively and is off by default", () => {
    expect(httpsEnabled({})).toBe(false);
    expect(httpsEnabled({ ACTUAL_BENCH_HTTPS: "TRUE" })).toBe(true);
    expect(httpsEnabled({ ACTUAL_BENCH_HTTPS: "false" })).toBe(false);
  });
});
