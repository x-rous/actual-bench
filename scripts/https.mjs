/**
 * Built-in HTTPS for self-hosted installs without a reverse proxy
 * (`ACTUAL_BENCH_HTTPS=true`).
 *
 * Direct Actual Server mode runs Actual's engine in the browser, which needs a
 * cross-origin-isolated page, and browsers only isolate a secure context:
 * HTTPS, or localhost. Opening Bench at `http://<LAN address>:3000` therefore
 * can't use Direct mode however Bench's headers are set. Serving HTTPS here
 * with a self-signed certificate fixes that without a proxy, at the cost of a
 * one-off browser warning.
 *
 * Layout when enabled: this front door listens on `PORT` and forwards every
 * request to the Next.js server, which listens on a private loopback port.
 * Plain `http://` requests arriving on `PORT` are redirected to `https://`.
 *
 * The certificate is generated with `node:crypto` alone (no OpenSSL binary or
 * extra dependency) and kept in `tls/` beside the metadata database, so the
 * browser's exception for it survives restarts and upgrades.
 */

import { createPrivateKey, generateKeyPairSync, randomBytes, sign, X509Certificate } from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import http from "http";
import https from "https";
import { isIP, connect, createServer as createNetServer } from "net";
import { hostname as osHostname, networkInterfaces } from "os";
import { dirname, join } from "path";

const DEFAULT_DB_PATH = "/data/actual-bench.sqlite";
/** Under the 825-day ceiling Apple platforms put on a certificate they will trust. */
const VALIDITY_DAYS = 825;
/** A certificate closer than this to its end is replaced at start. */
const RENEW_BEFORE_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * True when the operator turned built-in HTTPS on.
 * @param {Record<string, string | undefined>} [env]
 */
export function httpsEnabled(env = process.env) {
  return ["true", "1", "yes", "on"].includes((env.ACTUAL_BENCH_HTTPS ?? "").trim().toLowerCase());
}

/**
 * Extra names and addresses the certificate should cover (`ACTUAL_BENCH_HTTPS_HOSTS`).
 * @param {Record<string, string | undefined>} [env]
 */
export function configuredHosts(env = process.env) {
  return (env.ACTUAL_BENCH_HTTPS_HOSTS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

/**
 * The key and certificate to serve: the operator's own files when
 * `ACTUAL_BENCH_HTTPS_CERT` and `ACTUAL_BENCH_HTTPS_KEY` are both set, otherwise
 * the generated pair in `tls/` beside the database, created or replaced when
 * missing, near its end, or not covering a configured host.
 *
 * @param {Record<string, string | undefined>} [env]
 * @param {{ now?: Date }} [options]
 */
export function resolveTlsMaterial(env = process.env, { now = new Date() } = {}) {
  const certPath = env.ACTUAL_BENCH_HTTPS_CERT?.trim();
  const keyPath = env.ACTUAL_BENCH_HTTPS_KEY?.trim();
  if (certPath || keyPath) {
    if (!certPath || !keyPath) {
      throw new Error("Set both ACTUAL_BENCH_HTTPS_CERT and ACTUAL_BENCH_HTTPS_KEY, or neither.");
    }
    const cert = readFileSync(certPath, "utf8");
    const key = readFileSync(keyPath, "utf8");
    return { cert, key, source: "provided", fingerprint: new X509Certificate(cert).fingerprint256 };
  }

  const dir = join(dirname(env.ACTUAL_BENCH_DB_PATH?.trim() || DEFAULT_DB_PATH), "tls");
  const files = { cert: join(dir, "cert.pem"), key: join(dir, "key.pem") };
  const hosts = configuredHosts(env);

  if (existsSync(files.cert) && existsSync(files.key)) {
    const cert = readFileSync(files.cert, "utf8");
    const key = readFileSync(files.key, "utf8");
    const reason = staleReason(cert, key, hosts, now);
    if (!reason) {
      return { cert, key, source: "existing", path: dir, fingerprint: new X509Certificate(cert).fingerprint256 };
    }
    console.log(`   Replacing the HTTPS certificate: ${reason}.`);
  }

  const generated = generateSelfSignedCertificate({ hosts: [...hosts, ...localHosts()], now });
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(files.key, generated.key, { mode: 0o600 });
  writeFileSync(files.cert, generated.cert, { mode: 0o644 });
  return { ...generated, source: "generated", path: dir };
}

/** Why a stored certificate can't be kept, or null when it can. */
function staleReason(certPem, keyPem, hosts, now) {
  let cert;
  try {
    cert = new X509Certificate(certPem);
    if (!cert.checkPrivateKey(createPrivateKey(keyPem))) return "its key does not match";
  } catch {
    return "it could not be read";
  }
  if (new Date(cert.validTo).getTime() - now.getTime() < RENEW_BEFORE_DAYS * DAY_MS) return "it is about to expire";
  const missing = hosts.find((host) => !certificateCovers(cert, host));
  return missing ? `it does not cover ${missing}` : null;
}

function certificateCovers(cert, host) {
  return isIP(host) ? cert.checkIP(host) !== undefined : cert.checkHost(host) !== undefined;
}

/** Names this machine is reachable by from inside: always in the certificate. */
function localHosts() {
  const names = ["localhost", "127.0.0.1", "::1"];
  const own = osHostname();
  if (own) names.push(own);
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (!address.internal) names.push(address.address.split("%")[0]);
    }
  }
  return names;
}

// ── Self-signed certificate (X.509 v3, ECDSA P-256 / SHA-256) ────────────────

/**
 * A fresh key pair and a self-signed certificate for `hosts` (DNS names and
 * IP addresses), in PEM. Written out by hand in DER because Node can read
 * certificates but has no API to create one.
 */
export function generateSelfSignedCertificate({ hosts, now = new Date() }) {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const notBefore = new Date(now.getTime() - DAY_MS); // tolerate a slow client clock
  const notAfter = new Date(now.getTime() + VALIDITY_DAYS * DAY_MS);

  const serial = randomBytes(16);
  serial[0] &= 0x7f; // keep it positive
  serial[0] |= 0x01; // and free of a leading zero byte

  const name = seq(set(seq(oid("2.5.4.3"), utf8("Actual Bench (self-signed)"))));
  const ecdsaWithSha256 = seq(oid("1.2.840.10045.4.3.2"));

  const tbs = seq(
    tagged(0xa0, integer(Buffer.from([2]))), // version: v3
    integer(serial),
    ecdsaWithSha256,
    name, // issuer
    seq(time(notBefore), time(notAfter)),
    name, // subject
    publicKey.export({ type: "spki", format: "der" }),
    tagged(
      0xa3,
      seq(
        extension("2.5.29.19", seq(), true), // basicConstraints: not a CA
        extension("2.5.29.15", bitString(Buffer.from([0x80]), 7), true), // keyUsage: digitalSignature
        extension("2.5.29.37", seq(oid("1.3.6.1.5.5.7.3.1"))), // extKeyUsage: serverAuth
        extension("2.5.29.17", seq(...subjectAltNames(hosts))),
      ),
    ),
  );

  const signature = sign("sha256", tbs, { key: privateKey, dsaEncoding: "der" });
  const der = seq(tbs, ecdsaWithSha256, bitString(signature));
  const cert = pem("CERTIFICATE", der);
  const x509 = new X509Certificate(cert);
  if (!x509.verify(publicKey)) throw new Error("Generated certificate failed its own signature check.");

  return {
    cert,
    key: privateKey.export({ type: "pkcs8", format: "pem" }),
    fingerprint: x509.fingerprint256,
  };
}

function subjectAltNames(hosts) {
  const seen = new Set();
  const entries = [];
  for (const raw of hosts) {
    const host = raw.trim().toLowerCase();
    if (!host || seen.has(host)) continue;
    seen.add(host);
    const version = isIP(host);
    if (version === 4) entries.push(tlv(0x87, Buffer.from(host.split(".").map(Number))));
    else if (version === 6) entries.push(tlv(0x87, ipv6Bytes(host)));
    else entries.push(tlv(0x82, Buffer.from(host, "ascii")));
  }
  return entries;
}

function ipv6Bytes(address) {
  const [head, tail = ""] = address.includes("::") ? address.split("::") : [address, null];
  const parse = (part) => (part ? part.split(":") : []);
  let groups = parse(head);
  if (tail !== null) {
    const after = parse(tail);
    groups = [...groups, ...Array(8 - groups.length - after.length).fill("0"), ...after];
  }
  const bytes = Buffer.alloc(16);
  groups.forEach((group, i) => bytes.writeUInt16BE(parseInt(group, 16), i * 2));
  return bytes;
}

// Minimal DER encoding: just the types a certificate needs.

function tlv(tag, content) {
  const length = content.length;
  let header;
  if (length < 0x80) header = Buffer.from([tag, length]);
  else {
    const bytes = [];
    for (let n = length; n > 0; n >>= 8) bytes.unshift(n & 0xff);
    header = Buffer.from([tag, 0x80 | bytes.length, ...bytes]);
  }
  return Buffer.concat([header, content]);
}

const seq = (...items) => tlv(0x30, Buffer.concat(items));
const set = (...items) => tlv(0x31, Buffer.concat(items));
const tagged = (tag, content) => tlv(tag, content);
const integer = (bytes) => tlv(0x02, bytes);
const utf8 = (text) => tlv(0x0c, Buffer.from(text, "utf8"));
const octetString = (bytes) => tlv(0x04, bytes);
const bitString = (bytes, unusedBits = 0) => tlv(0x03, Buffer.concat([Buffer.from([unusedBits]), bytes]));
const boolean = (value) => tlv(0x01, Buffer.from([value ? 0xff : 0x00]));

function extension(id, value, critical = false) {
  return critical ? seq(oid(id), boolean(true), octetString(value)) : seq(oid(id), octetString(value));
}

function oid(dotted) {
  const [first, second, ...rest] = dotted.split(".").map(Number);
  const bytes = [first * 40 + second];
  for (const arc of rest) {
    const chunk = [arc & 0x7f];
    for (let n = arc >> 7; n > 0; n >>= 7) chunk.unshift((n & 0x7f) | 0x80);
    bytes.push(...chunk);
  }
  return tlv(0x06, Buffer.from(bytes));
}

/** UTCTime up to 2049, GeneralizedTime after, as RFC 5280 requires. */
function time(date) {
  const iso = date.toISOString().replace(/[-:T]/g, "").slice(0, 14) + "Z"; // YYYYMMDDHHMMSSZ
  return date.getUTCFullYear() < 2050 ? tlv(0x17, Buffer.from(iso.slice(2))) : tlv(0x18, Buffer.from(iso));
}

function pem(label, der) {
  const body = der.toString("base64").match(/.{1,64}/g).join("\n");
  return `-----BEGIN ${label}-----\n${body}\n-----END ${label}-----\n`;
}

// ── Front door ───────────────────────────────────────────────────────────────

/** A free loopback port for the Next.js server to listen on behind the front door. */
export function findFreeLoopbackPort() {
  return new Promise((resolve, reject) => {
    const probe = createNetServer();
    probe.unref();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

/** Hop-by-hop headers (RFC 9110 §7.6.1): never forwarded by a proxy. */
const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-connection",
  "transfer-encoding",
  "te",
  "trailer",
  "upgrade",
]);

function forwardedHeaders(req) {
  const headers = {};
  for (const [name, value] of Object.entries(req.headers)) {
    if (!HOP_BY_HOP.has(name) && !name.startsWith("x-forwarded-")) headers[name] = value;
  }
  // Only this front door says how the browser connected; anything the client
  // sent under these names is dropped above. Bench reads them for its
  // same-origin write check and for marking cookies Secure.
  headers["x-forwarded-proto"] = "https";
  if (req.headers.host) headers["x-forwarded-host"] = req.headers.host;
  headers["x-forwarded-for"] = req.socket.remoteAddress ?? "";
  return headers;
}

/**
 * Listen on `port` for both HTTPS and plain HTTP: TLS connections are
 * forwarded to the Next.js server at `127.0.0.1:upstreamPort`, plain ones get
 * a redirect to the same address over HTTPS. Resolves once listening.
 */
export function startHttpsFrontDoor({ port, hostname, upstreamPort, tls }) {
  const agent = new http.Agent({ keepAlive: true });

  const proxy = (req, res) => {
    const upstream = http.request(
      {
        host: "127.0.0.1",
        port: upstreamPort,
        method: req.method,
        path: req.url,
        headers: forwardedHeaders(req),
        agent,
      },
      (upstreamRes) => {
        const headers = { ...upstreamRes.headers };
        for (const name of HOP_BY_HOP) delete headers[name];
        res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.statusMessage, headers);
        upstreamRes.pipe(res);
      },
    );
    upstream.on("error", () => {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      res.writeHead(503, { "content-type": "text/plain; charset=utf-8", "retry-after": "2" });
      res.end("Actual Bench is starting. Reload in a moment.\n");
    });
    res.on("close", () => {
      if (!res.writableFinished) upstream.destroy();
    });
    req.pipe(upstream);
  };

  // A long export or backup download must not be cut off by Node's default
  // five-minute request timeout; Next.js has none of its own either.
  const secure = https.createServer({ key: tls.key, cert: tls.cert, requestTimeout: 0 }, proxy);

  secure.on("upgrade", (req, socket, head) => {
    const upstream = connect(upstreamPort, "127.0.0.1", () => {
      const headers = { ...forwardedHeaders(req), connection: "Upgrade", upgrade: req.headers.upgrade ?? "" };
      const lines = Object.entries(headers).flatMap(([name, value]) =>
        (Array.isArray(value) ? value : [value]).map((v) => `${name}: ${v}`),
      );
      upstream.write(`${req.method} ${req.url} HTTP/1.1\r\n${lines.join("\r\n")}\r\n\r\n`);
      if (head?.length) upstream.write(head);
      upstream.pipe(socket);
      socket.pipe(upstream);
    });
    upstream.on("error", () => socket.destroy());
    socket.on("error", () => upstream.destroy());
  });

  const redirect = http.createServer((req, res) => {
    const host = req.headers.host;
    if (!host || /[\s/\\@]/.test(host)) {
      res.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
      res.end("This address serves HTTPS. Open it with https://.\n");
      return;
    }
    res.writeHead(308, { location: `https://${host}${req.url ?? "/"}` });
    res.end();
  });

  // One port, two protocols: a TLS handshake always opens with byte 0x16.
  const front = createNetServer((socket) => {
    socket.once("data", (chunk) => {
      socket.pause();
      socket.unshift(chunk);
      (chunk[0] === 0x16 ? secure : redirect).emit("connection", socket);
      process.nextTick(() => socket.resume());
    });
    socket.on("error", () => socket.destroy());
  });

  return new Promise((resolve, reject) => {
    front.once("error", reject);
    front.listen(Number(port), hostname, () => {
      front.off("error", reject);
      resolve();
    });
  });
}
