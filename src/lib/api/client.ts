/**
 * Base typed API client for the jhonderson/actual-http-api wrapper.
 *
 * All requests are routed through the Next.js proxy at /api/proxy so that
 * the browser never makes a cross-origin fetch (no CORS issues). The proxy
 * forwards to: {baseUrl}/v1/budgets/{budgetSyncId}/{resource}
 */

import type { ConnectionInstance } from "@/store/connection";
import type { ApiError } from "@/types/errors";

// ─── Request helpers ──────────────────────────────────────────────────────────

type RequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
};

/**
 * Core fetch wrapper. Routes through /api/proxy (server-side) so that
 * CORS is never an issue regardless of where actual-http-api is hosted.
 * Throws a structured ApiError on non-2xx responses.
 */
export async function apiRequest<T>(
  connection: ConnectionInstance,
  path: string,
  options: RequestOptions = {}
): Promise<T> {
  const { method = "GET", body } = options;

  let response: Response;

  try {
    response = await fetch("/api/proxy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ connection, path, method, body }),
    });
  } catch (err) {
    // Network-level failure (e.g. server not running)
    const error: ApiError = {
      kind: "api",
      status: 0,
      message:
        err instanceof Error ? err.message : "Network error — is the dev server running?",
    };
    throw error;
  }

  // 204 No Content
  if (response.status === 204) {
    return undefined as T;
  }

  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try {
      const json = (await response.json()) as { error?: string; message?: string };
      message = json.error ?? json.message ?? message;
    } catch {
      // ignore parse errors
    }

    const error: ApiError = {
      kind: "api",
      status: response.status,
      message,
    };
    throw error;
  }

  return response.json() as Promise<T>;
}

/**
 * Test connectivity by fetching the accounts list through the proxy.
 * Resolves on success, throws ApiError on failure.
 */
export async function testConnection(
  connection: ConnectionInstance
): Promise<void> {
  await apiRequest<unknown>(connection, "/accounts", { method: "GET" });
}

// ─── Binary download ──────────────────────────────────────────────────────────

export type DownloadResult = {
  bytes: ArrayBuffer;
  filename: string | null;
  contentType: string;
};

/**
 * Parse RFC 5987 / RFC 6266 filename from a Content-Disposition header.
 * Prefers filename*= (UTF-8) and falls back to the unquoted filename=.
 */
function parseContentDispositionFilename(disposition: string): string | null {
  const utf8 = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(disposition);
  if (utf8?.[1]) {
    try {
      return decodeURIComponent(utf8[1].trim());
    } catch {
      // fall through to plain filename=
    }
  }
  const plain = /filename\s*=\s*"?([^";]+)"?/i.exec(disposition);
  return plain?.[1]?.trim() ?? null;
}

/**
 * Download a binary resource through the proxy. Used by features that need
 * raw bytes (e.g. the budget export ZIP). Routes through /api/proxy/download
 * so the per-server request queue is honored and CORS stays server-side.
 *
 * Throws a structured ApiError on non-2xx responses.
 */
export async function apiDownload(
  connection: ConnectionInstance,
  path: string
): Promise<DownloadResult> {
  let response: Response;

  try {
    response = await fetch("/api/proxy/download", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ connection, path, method: "GET" }),
    });
  } catch (err) {
    const error: ApiError = {
      kind: "api",
      status: 0,
      message:
        err instanceof Error ? err.message : "Network error — is the dev server running?",
    };
    throw error;
  }

  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try {
      const json = (await response.json()) as { error?: string; message?: string };
      message = json.error ?? json.message ?? message;
    } catch {
      // ignore parse errors
    }

    const error: ApiError = {
      kind: "api",
      status: response.status,
      message,
    };
    throw error;
  }

  const bytes = await response.arrayBuffer();
  const contentType = response.headers.get("content-type") ?? "application/octet-stream";
  const disposition = response.headers.get("content-disposition");
  const filename = disposition ? parseContentDispositionFilename(disposition) : null;

  return { bytes, filename, contentType };
}

// ─── Version endpoints ────────────────────────────────────────────────────────

/**
 * Returns the actual-http-api wrapper version.
 * Server-level endpoint — no budgetSyncId required.
 * Path: GET /v1/actualhttpapiversion
 */
export async function getApiVersion(
  baseUrl: string,
  apiKey: string
): Promise<string> {
  const response = await fetch("/api/proxy", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      connection: { baseUrl, apiKey },
      path: "/v1/actualhttpapiversion",
      method: "GET",
    }),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = (await response.json()) as { data?: { version?: string } };
  if (!data.data?.version) throw new Error("No version in response");
  return data.data.version;
}

/**
 * Returns the Actual Budget server version.
 * Budget-scoped endpoint — requires an open budget connection.
 * Path: GET /budgets/{id}/actualserverversion
 */
export async function getServerVersion(
  baseUrl: string,
  apiKey: string,
  budgetSyncId: string
): Promise<string> {
  const response = await fetch("/api/proxy", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      connection: { baseUrl, apiKey, budgetSyncId },
      path: "/actualserverversion",
      method: "GET",
    }),
  });

  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try {
      const json = (await response.json()) as { error?: string; message?: string };
      message = json.error ?? json.message ?? message;
    } catch {}
    const error: ApiError = { kind: "api", status: response.status, message };
    throw error;
  }

  const data = (await response.json()) as { data?: { version?: string } };
  if (!data.data?.version) throw new Error("No version in response");
  return data.data.version;
}

// ─── Budget listing ───────────────────────────────────────────────────────────

export type BudgetFile = {
  cloudFileId: string;
  name: string;
  state?: string;
  groupId?: string;
  encryptKeyId?: string | null;
  hasKey?: boolean;
  owner?: string;
};

/**
 * Lists remote budget files available on the server.
 * Uses GET /v1/budgets/ — a server-level endpoint that doesn't require a
 * budgetSyncId, so no budget is opened on the actual-http-api side.
 * Filters to state === "remote" and deduplicates by groupId (Sync ID).
 */
export async function listBudgets(
  baseUrl: string,
  apiKey: string
): Promise<BudgetFile[]> {
  const response = await fetch("/api/proxy", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      connection: { baseUrl, apiKey },
      path: "/v1/budgets/",
      method: "GET",
    }),
  });

  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try {
      const json = (await response.json()) as { error?: string; message?: string };
      message = json.error ?? json.message ?? message;
    } catch { /* ignore */ }
    const error: ApiError = { kind: "api", status: response.status, message };
    throw error;
  }

  const payload = (await response.json()) as { data: BudgetFile[] } | BudgetFile[];
  const all: BudgetFile[] = Array.isArray(payload) ? payload : (payload.data ?? []);

  // Keep only remote budgets that have a groupId, deduplicate by groupId (Sync ID).
  // groupId is the server-assigned unique identifier and is guaranteed unique
  // among state === "remote" entries. cloudFileId is NOT guaranteed unique.
  const seen = new Set<string>();
  return all.filter((b) => {
    if (b.state !== "remote") return false;
    if (!b.groupId) return false;
    if (seen.has(b.groupId)) return false;
    seen.add(b.groupId);
    return true;
  });
}
