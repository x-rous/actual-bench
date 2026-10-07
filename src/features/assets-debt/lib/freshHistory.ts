import type { ActualBenchTransport } from "@/lib/actual/transport";
import { readMatchingHistory, type MatchingHistorySnapshot } from "@/lib/assets-debt/actual/ledgerPort";

/**
 * The matching history as Actual has it now. In Direct mode the browser reads its own copy of the
 * budget, which otherwise only syncs when it first opens, so a payment added or copied in Actual
 * after that would be missing from the check. A failed sync is not fatal: the read still runs on
 * what was last downloaded.
 */
export async function readFreshMatchingHistory(
  transport: ActualBenchTransport,
  input: { accountIds: readonly string[]; from: string; to: string },
): Promise<MatchingHistorySnapshot[]> {
  try {
    await transport.sync();
  } catch {
    // Read what this browser has; the refresh on the Sync Repayments tab reports sync problems.
  }
  return readMatchingHistory(transport, input);
}
