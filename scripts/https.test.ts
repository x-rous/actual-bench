/** @jest-environment node */
import { X509Certificate } from "crypto";
import { mkdtempSync, rmSync } from "fs";
import http from "http";
import https from "https";
import { connect, type AddressInfo } from "net";
import { tmpdir } from "os";
import { join } from "path";
import {
  findFreeLoopbackPort,
  generateSelfSignedCertificate,
  httpsEnabled,
  resolveTlsMaterial,
  startHttpsFrontDoor,
} from "./https.mjs";

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

  it("encodes an IPv6 address with a dotted IPv4 ending", () => {
    const x509 = new X509Certificate(generateSelfSignedCertificate({ hosts: ["::ffff:192.168.1.50"] }).cert);
    expect(x509.subjectAltName).toContain("IP Address:0:0:0:0:0:FFFF:C0A8:132");
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

describe("HTTPS front door", () => {
  type Seen = { headers: http.IncomingHttpHeaders };
  let upstream: http.Server;
  let front: { address: AddressInfo; close: () => void };
  let seen: Seen[];
  let warnings: string[];

  beforeEach(async () => {
    seen = [];
    warnings = [];
    upstream = http.createServer((req, res) => {
      seen.push({ headers: req.headers });
      if (req.url === "/broken") {
        res.writeHead(200, { "content-length": "100" });
        res.write("partial");
        setTimeout(() => res.destroy(), 20);
        return;
      }
      res.end("ok");
    });
    const upstreamPort = await findFreeLoopbackPort();
    await new Promise<void>((resolve) => upstream.listen(upstreamPort, "127.0.0.1", resolve));
    const { cert, key } = generateSelfSignedCertificate({ hosts: ["localhost", "127.0.0.1"] });
    front = await startHttpsFrontDoor({
      port: 0,
      hostname: "127.0.0.1",
      upstreamPort,
      tls: { cert, key },
      firstByteTimeoutMs: 100,
      warn: (message: string) => warnings.push(message),
    });
  });

  afterEach(async () => {
    front.close();
    await new Promise((resolve) => upstream.close(resolve));
    upstream.closeAllConnections();
  });

  const get = (secure: boolean, path: string, headers: Record<string, string> = {}) =>
    new Promise<{ status?: number; location?: string; body: string }>((resolve, reject) => {
      const client = secure ? https : http;
      const req = client.get(
        { host: "127.0.0.1", port: front.address.port, path, headers, rejectUnauthorized: false, agent: false },
        (res) => {
          let body = "";
          res.on("data", (chunk) => (body += chunk));
          res.on("end", () => resolve({ status: res.statusCode, location: res.headers.location, body }));
          res.on("error", reject);
        },
      );
      req.on("error", reject);
    });

  it("redirects a direct plain-HTTP request to HTTPS", async () => {
    const res = await get(false, "/connect?x=1", { host: "192.168.1.50:3000" });
    expect(res.status).toBe(308);
    expect(res.location).toBe("https://192.168.1.50:3000/connect?x=1");
    expect(seen).toHaveLength(0);
  });

  it("forwards HTTPS requests with its own forwarded headers, dropping the client's", async () => {
    const res = await get(true, "/", { host: "bench.lan:3000", "x-forwarded-host": "evil.example" });
    expect(res.body).toBe("ok");
    expect(seen[0].headers["x-forwarded-proto"]).toBe("https");
    expect(seen[0].headers["x-forwarded-host"]).toBe("bench.lan:3000");
  });

  it("passes a reverse proxy's plain-HTTP request through unchanged, and warns once", async () => {
    const proxyHeaders = { host: "bench.example.com", "x-forwarded-proto": "https", "x-forwarded-host": "bench.example.com" };
    const first = await get(false, "/", proxyHeaders);
    await get(false, "/", proxyHeaders);
    expect(first.status).toBe(200);
    expect(seen[0].headers["x-forwarded-proto"]).toBe("https");
    expect(seen[0].headers["x-forwarded-host"]).toBe("bench.example.com");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/reverse proxy/);
  });

  it("closes a connection that sends nothing", async () => {
    const socket = connect(front.address.port, "127.0.0.1");
    const closedAfter = await new Promise<number>((resolve) => {
      const started = Date.now();
      socket.on("close", () => resolve(Date.now() - started));
    });
    expect(closedAfter).toBeLessThan(2000);
  });

  it("cuts the response off when the upstream fails mid-body, instead of hanging", async () => {
    await expect(get(true, "/broken")).rejects.toThrow();
  });
});
