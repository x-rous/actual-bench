/**
 * Server-side proxy for the jhonderson/actual-http-api.
 *
 * All browser → actual-http-api calls go through here so that CORS is never
 * an issue (the upstream fetch runs on the server, not the browser).
 *
 * Security note: connection credentials (apiKey, encryptionPassword) are sent
 * from the browser in the POST body and are visible in browser DevTools Network
 * tab. This is a known trade-off for a self-hosted admin tool — the proxy
 * eliminates CORS friction but does not hide credentials from the browser.
 *
 * For multi-tenant or public deployments, store connections server-side (e.g.
 * in an encrypted session cookie) so credentials never leave the server.
 *
 * POST /api/proxy
 * Body: { connection: ConnectionInstance, path: string, method?: string, body?: unknown }
 *
 * For binary responses (e.g. budget export ZIP), use /api/proxy/download.
 * Both routes share the same per-server serialization queue (see serverQueue.ts).
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { ConnectionInstance } from "@/store/connection";
import { logger } from "@/lib/logger";
import { queueServerRequest } from "./serverQueue";

type ProxyRequestBody = {
  connection: Pick<ConnectionInstance, "baseUrl" | "apiKey"> & {
    budgetSyncId?: string;
    encryptionPassword?: string;
  };
  path: string;
  method?: string;
  body?: unknown;
};

// ─── Upstream fetch ────────────────────────────────────────────────────────────

async function upstreamFetch(
  url: string,
  headers: Record<string, string>,
  method: string,
  body: unknown,
  reqId: string,
  start: number,
  path: string
): Promise<NextResponse> {
  let upstreamResponse: Response;

  try {
    upstreamResponse = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Network error reaching API server";
    const ms = Date.now() - start;
    logger.warn(`${method} 502 ${path} (${ms}ms) [${reqId}] — ${message}`);
    return NextResponse.json({ error: message }, { status: 502 });
  }

  // 204 No Content — return empty response with same status
  if (upstreamResponse.status === 204) {
    const ms = Date.now() - start;
    logger.info(`${method} 204 ${path} (${ms}ms) [${reqId}]`);
    return new NextResponse(null, { status: 204 });
  }

  // For error responses, try to extract a message from the upstream body
  if (!upstreamResponse.ok) {
    let message = `HTTP ${upstreamResponse.status}`;
    try {
      const json = (await upstreamResponse.json()) as {
        message?: string;
        error?: string;
      };
      message = json.message ?? json.error ?? message;
    } catch {
      // ignore — use status string
    }
    const ms = Date.now() - start;
    logger.warn(`${method} ${upstreamResponse.status} ${path} (${ms}ms) [${reqId}] — ${message}`);
    return NextResponse.json(
      { error: message },
      { status: upstreamResponse.status }
    );
  }

  const data: unknown = await upstreamResponse.json();
  const ms = Date.now() - start;
  logger.info(`${method} ${upstreamResponse.status} ${path} (${ms}ms) [${reqId}]`);
  return NextResponse.json(data);
}

// ─── Route handler ─────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  let payload: ProxyRequestBody;

  try {
    payload = (await request.json()) as ProxyRequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { connection, path, method = "GET", body } = payload;

  if (!connection?.baseUrl || !connection?.apiKey) {
    return NextResponse.json({ error: "Missing connection details" }, { status: 400 });
  }

  const reqId = Math.random().toString(36).slice(2, 9);
  const start = Date.now();

  const base = connection.baseUrl.replace(/\/$/, "");
  // Budget-scoped path: /v1/budgets/:syncId/:resource
  // Server-scoped path: used as-is (e.g. /v1/budgets/ for listing)
  const url = connection.budgetSyncId
    ? `${base}/v1/budgets/${connection.budgetSyncId}${path}`
    : `${base}${path}`;

  const headers: Record<string, string> = {
    "x-api-key": connection.apiKey,
    "Accept": "application/json",
    "Content-Type": "application/json",
  };

  // Always send the header — some deployments require it to be present
  // even for unencrypted budgets. Defaults to empty string when not set.
  headers["budget-encryption-password"] = connection.encryptionPassword ?? "";

  return queueServerRequest(connection, reqId, () =>
    upstreamFetch(url, headers, method, body, reqId, start, path)
  );
}
