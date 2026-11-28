#!/usr/bin/env node
/**
 * Docker HEALTHCHECK: exit 0 when /api/health answers OK on PORT.
 *
 * With ACTUAL_BENCH_HTTPS=true the port speaks HTTPS with a certificate the
 * container can't verify (usually self-signed), so the check skips
 * verification: it asks whether Bench is up, not who it is.
 */
import http from "http";
import https from "https";
import { httpsEnabled } from "./https.mjs";

const secure = httpsEnabled();
const client = secure ? https : http;
const request = client.get(
  {
    host: "127.0.0.1",
    port: Number(process.env.PORT ?? 3000),
    path: "/api/health",
    timeout: 4000,
    ...(secure ? { rejectUnauthorized: false, servername: "localhost" } : {}),
  },
  (res) => {
    res.resume();
    process.exit(res.statusCode && res.statusCode >= 200 && res.statusCode < 300 ? 0 : 1);
  },
);
request.on("timeout", () => request.destroy());
request.on("error", () => process.exit(1));
