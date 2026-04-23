/**
 * Per-server request serialization for the actual-http-api proxy.
 *
 * Shared by /api/proxy (JSON) and /api/proxy/download (binary). Both routes
 * MUST serialize through the same queue — actual-http-api wraps @actual-app/api,
 * which keeps a single budget open at a time per server instance. Two
 * concurrent requests against the same server (regardless of which route they
 * came in on) produce:
 *
 *   "onFinish called while inside a spreadsheet transaction"
 *
 * The queue key is baseUrl only (not baseUrl+budgetSyncId) because the
 * constraint is per server instance. Requests to different servers proceed
 * in parallel.
 */
import type { NextResponse } from "next/server";
import { logger } from "@/lib/logger";

// Each entry in the map is the tail of a server's request chain — a void
// promise that resolves when the previous request finishes. A new request
// appends itself to the tail and updates it. Errors are swallowed in the
// tail so a failed request never blocks subsequent ones.
const serverQueueTails = new Map<string, Promise<void>>();

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

/**
 * When a request fails with a server error, actual-http-api may leave the
 * budget in a partially-open state (transaction still active). Before the
 * next queued request runs, attempt a DELETE to close/unload the budget so
 * the server's internal state is clean. Errors are swallowed — best-effort.
 */
async function tryCloseBudget(
  baseUrl: string,
  budgetSyncId: string,
  apiKey: string
): Promise<void> {
  try {
    const encodedBudgetSyncId = encodeURIComponent(budgetSyncId);
    await fetch(
      `${normalizeBaseUrl(baseUrl)}/v1/budgets/${encodedBudgetSyncId}`,
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

type QueueConnection = {
  baseUrl: string;
  budgetSyncId?: string;
  apiKey: string;
};

/**
 * Enqueue a request operation against a server. Returns the operation's
 * response promise. On 5xx or rejection, attempts a best-effort budget close
 * before releasing the queue.
 */
export function queueServerRequest(
  connection: QueueConnection,
  reqId: string,
  operation: () => Promise<NextResponse>
): Promise<NextResponse> {
  const serverKey = normalizeBaseUrl(connection.baseUrl);
  const prev = serverQueueTails.get(serverKey) ?? Promise.resolve();

  const thisRequest = prev.then(operation);

  // The tail is awaited so the queue does not release until cleanup has had
  // a chance to run. Errors are handled in both branches so the chain never
  // breaks.
  const voidTail = thisRequest.then(
    async (response) => {
      if (response.status >= 500 && connection.budgetSyncId) {
        await tryCloseBudget(connection.baseUrl, connection.budgetSyncId, connection.apiKey);
        logger.warn(`budget close attempted after ${response.status} [${reqId}]`);
      }
    },
    async () => {
      if (connection.budgetSyncId) {
        await tryCloseBudget(connection.baseUrl, connection.budgetSyncId, connection.apiKey);
      }
    }
  );
  serverQueueTails.set(serverKey, voidTail);
  void voidTail.then(() => {
    if (serverQueueTails.get(serverKey) === voidTail) {
      serverQueueTails.delete(serverKey);
    }
  });

  return thisRequest;
}

// Exported for tests only — allows assertions on queue state.
export const __internals = { serverQueueTails, tryCloseBudget };
