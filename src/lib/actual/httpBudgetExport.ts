import { apiDownload } from "@/lib/api/client";
import { getServerRequestGate } from "@/lib/http/serverRequestGate";
import type { HttpApiConnection } from "@/store/connection";

/**
 * The whole budget as Actual's archive, from actual-http-api's `/export`
 * (RD-077, moved here in RD-095 M3 so both transports offer `exportBudget()`).
 *
 * In the browser it goes through the proxy's download route, as the Budget
 * Diagnostics export always has. On the server - a scheduled backup - it goes
 * straight to the server through the shared per-server lock. That is not
 * politeness: Actual opens a budget file to serve an export, and a sync
 * applying changes to the same budget at the same moment is how you get
 * "budget is already open" errors and, worse, a backup taken mid-write.
 *
 * Browser-safe: the lock is reached through its gate, never imported.
 */

export class HttpBudgetExportError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "HttpBudgetExportError";
    this.status = status;
  }
}

export type HttpBudgetExport = {
  bytes: Uint8Array;
  filename: string | null;
};

/** Exports of a large budget are slow; a backup that gives up at 60s never runs for the people who need it most. */
export const DEFAULT_HTTP_EXPORT_TIMEOUT_MS = 300_000;

function filenameFromDisposition(disposition: string | null): string | null {
  if (!disposition) return null;
  const quoted = /filename\s*=\s*"([^"]*)"/i.exec(disposition);
  if (quoted?.[1]) return quoted[1].trim();
  const plain = /filename\s*=\s*([^;]+)/i.exec(disposition);
  return plain?.[1]?.trim() ?? null;
}

export async function exportHttpApiBudget(
  connection: HttpApiConnection,
  options: { timeoutMs?: number } = {}
): Promise<HttpBudgetExport> {
  if (typeof window !== "undefined") {
    const download = await apiDownload(connection, "/export");
    return { bytes: new Uint8Array(download.bytes), filename: download.filename };
  }

  const gate = getServerRequestGate();
  if (!gate) {
    throw new HttpBudgetExportError("The server request lock is not available in this process.", 500);
  }

  const base = connection.baseUrl.replace(/\/$/, "");
  const url = `${base}/v1/budgets/${encodeURIComponent(connection.budgetSyncId)}/export`;
  const timeoutMs = options.timeoutMs ?? DEFAULT_HTTP_EXPORT_TIMEOUT_MS;

  const result = await gate<{ status: number; body?: HttpBudgetExport; error?: string }>(
    { baseUrl: connection.baseUrl, budgetSyncId: connection.budgetSyncId, apiKey: connection.apiKey },
    `export-${Math.random().toString(36).slice(2, 9)}`,
    async () => {
      let response: Response;
      try {
        response = await fetch(url, {
          method: "GET",
          headers: {
            "x-api-key": connection.apiKey,
            Accept: "application/zip, application/octet-stream, */*",
            "budget-encryption-password": connection.encryptionPassword ?? "",
          },
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        return {
          status: 502,
          error: `Could not reach ${base}: ${error instanceof Error ? error.message : String(error)}`,
        };
      }

      if (!response.ok) {
        let message = `HTTP ${response.status}`;
        try {
          const json = (await response.json()) as { message?: string; error?: string };
          message = json.message ?? json.error ?? message;
        } catch {
          // Non-JSON error body; the status is what we have.
        }
        return { status: response.status, error: message };
      }

      return {
        status: 200,
        body: {
          bytes: new Uint8Array(await response.arrayBuffer()),
          filename: filenameFromDisposition(response.headers.get("content-disposition")),
        },
      };
    },
    // Outlives the export's own timeout by the budget-close cleanup plus
    // margin, so the lease cannot expire mid-export and let another request in.
    { leaseTtlMs: timeoutMs + 15_000 }
  ).catch((error: unknown) => {
    if (error instanceof Error && error.name === "ServerBusyError") {
      throw new HttpBudgetExportError(error.message, 503);
    }
    throw error;
  });

  if (!result.body) {
    throw new HttpBudgetExportError(result.error ?? `Export failed with HTTP ${result.status}`, result.status);
  }
  // A server that answers 200 with nothing is a failure, not an empty backup.
  if (result.body.bytes.byteLength === 0) {
    throw new HttpBudgetExportError("The server returned an empty export.", 200);
  }
  return result.body;
}
