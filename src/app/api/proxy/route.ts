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
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { ConnectionInstance } from "@/store/connection";

type ProxyRequestBody = {
  connection: Pick<ConnectionInstance, "baseUrl" | "apiKey"> & {
    budgetSyncId?: string;
    encryptionPassword?: string;
  };
  path: string;
  method?: string;
  body?: unknown;
};

// ─── Per-server request queue ──────────────────────────────────────────────────
//
// actual-http-api wraps @actual-app/api, which keeps a single budget open at a
// time per server instance. Every request triggers a load-budget / close-budget
// cycle. If two requests for *different* budgets on the same server arrive
// concurrently, the second closeBudget fires while the first is still inside a
// spreadsheet transaction, producing:
//
//   "onFinish called while inside a spreadsheet transaction"
//
// The queue key is baseUrl only (not baseUrl+budgetSyncId) because the
// constraint is per server instance, not per budget. All requests to the same
// server are serialized; requests to different servers proceed in parallel.
//
// Each entry in the map is the "tail" of that server's chain — a void promise
// that resolves when the previous request finishes. A new request appends
// itself to the tail and updates it. Errors are swallowed in the tail so a
// failed request never blocks subsequent ones.

const serverQueueTails = new Map<string, Promise<void>>();

// ─── Budget close helper ───────────────────────────────────────────────────────
//
// When a request fails with a server error, actual-http-api may leave the
// budget in a partially-open state (transaction still active). Before the next
// queued request runs, attempt a DELETE to close/unload the budget so the
// server's internal state is clean. Errors are swallowed — this is best-effort.

async function tryCloseBudget(
  baseUrl: string,
  budgetSyncId: string,
  apiKey: string
): Promise<void> {
  try {
    await fetch(
      `${baseUrl.replace(/\/$/, "")}/v1/budgets/${budgetSyncId}`,
      {
        method: "DELETE",
        headers: { "x-api-key": apiKey },
        signal: AbortSignal.timeout(5_000),
      }
    );
  } catch {
    // Ignore — best-effort only
  }
}

// ─── Upstream fetch ────────────────────────────────────────────────────────────

async function upstreamFetch(
  url: string,
  headers: Record<string, string>,
  method: string,
  body: unknown
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
    return NextResponse.json({ error: message }, { status: 502 });
  }

  // 204 No Content — return empty response with same status
  if (upstreamResponse.status === 204) {
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
    return NextResponse.json(
      { error: message },
      { status: upstreamResponse.status }
    );
  }

  const data: unknown = await upstreamResponse.json();
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

  // Serialize all requests to the same server (keyed by baseUrl only).
  // See comment at the top of this file for the full rationale.
  const serverKey = connection.baseUrl;
  const prev = serverQueueTails.get(serverKey) ?? Promise.resolve();

  const thisRequest = prev.then(() =>
    upstreamFetch(url, headers, method, body)
  );

  // After the request completes, attempt a budget close if the server returned
  // a 5xx error — this gives actual-http-api a chance to unload a stuck budget
  // before the next queued request starts. The close is awaited so the queue
  // does not release until cleanup has had a chance to run.
  // Only attempt budget close on error when a specific budget was opened.
  const voidTail = thisRequest.then(
    async (response) => {
      if (response.status >= 500 && connection.budgetSyncId) {
        await tryCloseBudget(connection.baseUrl, connection.budgetSyncId, connection.apiKey);
      }
    },
    async () => {
      if (connection.budgetSyncId) {
        await tryCloseBudget(connection.baseUrl, connection.budgetSyncId, connection.apiKey);
      }
    }
  );
  serverQueueTails.set(serverKey, voidTail);
  voidTail.then(() => {
    if (serverQueueTails.get(serverKey) === voidTail) {
      serverQueueTails.delete(serverKey);
    }
  });

  return thisRequest;
}
