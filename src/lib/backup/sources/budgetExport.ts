import { queueServerRequest } from "@/app/api/proxy/serverQueue";
import type { SyncCredential } from "@/lib/app-db/types";

/**
 * Exporting a budget from the server, unattended (RD-077 / PR-047c).
 *
 * A scheduled backup has no browser to borrow, so it goes to the Actual server
 * itself with credentials from the vault — the same arrangement unattended sync
 * already uses, and the reason a policy's source is an *enrolled connection*
 * rather than an arbitrary URL: enrolment is where the operator already decided
 * Bench may act on this budget without them present.
 *
 * The request goes through the shared per-server queue. That is not politeness:
 * Actual opens a budget file to serve an export, and a sync applying changes to
 * the same budget at the same moment is how you get "budget is already open"
 * errors and, worse, a backup taken mid-write.
 */

export class BudgetExportError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "BudgetExportError";
    this.status = status;
  }
}

export type ExportedBudget = {
  bytes: Buffer;
  filename: string | null;
  budgetSyncId: string;
  serverUrl: string;
};

function filenameFromDisposition(disposition: string | null): string | null {
  if (!disposition) return null;
  const quoted = /filename\s*=\s*"([^"]*)"/i.exec(disposition);
  if (quoted?.[1]) return quoted[1].trim();
  const plain = /filename\s*=\s*([^;]+)/i.exec(disposition);
  return plain?.[1]?.trim() ?? null;
}

export async function exportBudgetFromCredential(
  credential: SyncCredential,
  options: { timeoutMs?: number } = {}
): Promise<ExportedBudget> {
  const base = credential.baseUrl.replace(/\/$/, "");
  const url = `${base}/v1/budgets/${encodeURIComponent(credential.budgetSyncId)}/export`;

  const result = await queueServerRequest<{ status: number; body?: ExportedBudget; error?: string }>(
    { baseUrl: credential.baseUrl, budgetSyncId: credential.budgetSyncId, apiKey: credential.secret.apiKey },
    `backup-${Math.random().toString(36).slice(2, 9)}`,
    async () => {
      let response: Response;
      try {
        response = await fetch(url, {
          method: "GET",
          headers: {
            "x-api-key": credential.secret.apiKey,
            Accept: "application/zip, application/octet-stream, */*",
            "budget-encryption-password": credential.secret.encryptionPassword ?? "",
          },
          // Exports of a large budget are slow, and a backup that gives up at
          // 60s on a big file is a backup that never runs for the people who
          // need it most.
          signal: AbortSignal.timeout(options.timeoutMs ?? 300_000),
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

      const bytes = Buffer.from(await response.arrayBuffer());
      return {
        status: 200,
        body: {
          bytes,
          filename: filenameFromDisposition(response.headers.get("content-disposition")),
          budgetSyncId: credential.budgetSyncId,
          serverUrl: base,
        },
      };
    }
  );

  if (!result.body) {
    throw new BudgetExportError(result.error ?? `Export failed with HTTP ${result.status}`, result.status);
  }
  // A server that answers 200 with nothing is a failure, not an empty backup.
  if (result.body.bytes.byteLength === 0) {
    throw new BudgetExportError("The server returned an empty export.", 200);
  }
  return result.body;
}
