/**
 * Binary download proxy for the jhonderson/actual-http-api.
 *
 * Streams binary responses (e.g. the budget export ZIP) back to the browser
 * with the upstream Content-Type and Content-Disposition intact. Shares the
 * per-server serialization queue with /api/proxy so concurrent requests
 * against the same actual-http-api instance never overlap.
 *
 * POST /api/proxy/download
 * Body: { connection: ConnectionInstance, path: string, method?: string }
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { ConnectionInstance } from "@/store/connection";
import { logger } from "@/lib/logger";
import { queueServerRequest } from "../serverQueue";

type DownloadRequestBody = {
  connection: Pick<ConnectionInstance, "baseUrl" | "apiKey"> & {
    budgetSyncId?: string;
    encryptionPassword?: string;
  };
  path: string;
  method?: string;
};

// ─── Upstream download ─────────────────────────────────────────────────────────

async function upstreamDownload(
  url: string,
  headers: Record<string, string>,
  method: string,
  reqId: string,
  start: number,
  path: string
): Promise<NextResponse> {
  let upstream: Response;

  try {
    upstream = await fetch(url, {
      method,
      headers,
      // Export endpoints can take longer than JSON calls — allow 60s.
      signal: AbortSignal.timeout(60_000),
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Network error reaching API server";
    const ms = Date.now() - start;
    logger.warn(`${method} 502 ${path} (${ms}ms) [${reqId}] — ${message}`);
    return NextResponse.json({ error: message }, { status: 502 });
  }

  if (!upstream.ok) {
    let message = `HTTP ${upstream.status}`;
    const contentType = upstream.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      try {
        const json = (await upstream.json()) as {
          message?: string;
          error?: string;
        };
        message = json.message ?? json.error ?? message;
      } catch {
        // ignore — use status string
      }
    }
    const ms = Date.now() - start;
    logger.warn(`${method} ${upstream.status} ${path} (${ms}ms) [${reqId}] — ${message}`);
    return NextResponse.json(
      { error: message },
      { status: upstream.status }
    );
  }

  const contentType = upstream.headers.get("content-type") ?? "application/octet-stream";
  const contentDisposition = upstream.headers.get("content-disposition");
  const contentLength = upstream.headers.get("content-length");

  // Buffer the whole body — expected payload is a single ZIP in the MB range,
  // which fits comfortably in memory. Streaming would complicate error
  // handling (errors after headers are sent) without a real benefit here.
  const bytes = await upstream.arrayBuffer();
  const ms = Date.now() - start;
  logger.info(
    `${method} ${upstream.status} ${path} (${ms}ms, ${bytes.byteLength} bytes) [${reqId}]`
  );

  const outHeaders: Record<string, string> = { "Content-Type": contentType };
  if (contentDisposition) outHeaders["Content-Disposition"] = contentDisposition;
  if (contentLength) outHeaders["Content-Length"] = contentLength;

  return new NextResponse(bytes, {
    status: upstream.status,
    headers: outHeaders,
  });
}

// ─── Route handler ─────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  let payload: DownloadRequestBody;

  try {
    payload = (await request.json()) as DownloadRequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { connection, path, method = "GET" } = payload;

  if (!connection?.baseUrl || !connection?.apiKey) {
    return NextResponse.json({ error: "Missing connection details" }, { status: 400 });
  }

  const reqId = Math.random().toString(36).slice(2, 9);
  const start = Date.now();

  const base = connection.baseUrl.replace(/\/$/, "");
  const url = connection.budgetSyncId
    ? `${base}/v1/budgets/${connection.budgetSyncId}${path}`
    : `${base}${path}`;

  const headers: Record<string, string> = {
    "x-api-key": connection.apiKey,
    "Accept": "application/zip, application/octet-stream, application/json, */*",
  };
  headers["budget-encryption-password"] = connection.encryptionPassword ?? "";

  return queueServerRequest(connection, reqId, () =>
    upstreamDownload(url, headers, method, reqId, start, path)
  );
}
