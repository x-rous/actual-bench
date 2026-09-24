import { HttpBudgetExportError, exportHttpApiBudget } from "@/lib/actual/httpBudgetExport";
import { connectionFromEnrolment } from "@/lib/actual/serverTransport";
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
 * The request itself lives with the HTTP transport (`httpBudgetExport.ts`),
 * which sends it through the shared per-server lock; this keeps the shape the
 * backup pipeline expects.
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

export async function exportBudgetFromCredential(
  credential: SyncCredential,
  options: { timeoutMs?: number } = {}
): Promise<ExportedBudget> {
  const { secret, ...meta } = credential;
  const connection = connectionFromEnrolment(meta, secret);
  if (connection.mode !== "http-api") {
    throw new BudgetExportError("Backups of Direct connections are not available yet.", 400);
  }

  try {
    const exported = await exportHttpApiBudget(connection, options);
    return {
      bytes: Buffer.from(exported.bytes.buffer, exported.bytes.byteOffset, exported.bytes.byteLength),
      filename: exported.filename,
      budgetSyncId: credential.budgetSyncId,
      serverUrl: credential.baseUrl.replace(/\/$/, ""),
    };
  } catch (error) {
    if (error instanceof HttpBudgetExportError) throw new BudgetExportError(error.message, error.status);
    throw error;
  }
}
