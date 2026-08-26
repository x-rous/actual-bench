import { apiRequest } from "./client";
import type { ConnectionInstance } from "@/store/connection";

/**
 * actual-http-api's bank-sync endpoints (RD-080 / PR-044).
 *
 * Two exist: one for a single account and one for every account at once. Bench
 * uses the per-account path, because the all-accounts path answers with a
 * single opaque message and cannot say which account failed.
 */

type BankSyncResponse = { message?: string };

/** Trigger a sync for one account. Rejects with the server's error. */
export async function triggerAccountBankSync(
  connection: ConnectionInstance,
  accountId: string
): Promise<void> {
  await apiRequest<BankSyncResponse>(connection, `/accounts/${accountId}/banksync`, {
    method: "POST",
  });
}

/**
 * Trigger a sync for every linked account in one call.
 *
 * Exposed for completeness and for callers that explicitly accept an
 * unattributable result; Bench's own paths prefer `triggerAccountBankSync`.
 */
export async function triggerAllAccountsBankSync(connection: ConnectionInstance): Promise<void> {
  await apiRequest<BankSyncResponse>(connection, "/accounts/banksync", { method: "POST" });
}
