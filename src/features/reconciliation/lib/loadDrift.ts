import type { ReconciliationTransport } from "@/lib/reconciliation/ports";
import type { ActualTransactionSnapshot } from "@/lib/reconciliation/types";

/**
 * Re-read the rows Apply is about to write, immediately before it writes them.
 *
 * The obvious implementation — one `readTransaction` per targeted row — is the
 * one that made Apply itself slow: a few hundred round trips ahead of a few
 * hundred writes. So the window is re-read in a single call, and single reads
 * are used only to settle the rows that call could not account for.
 *
 * A row absent from the re-read window is ambiguous: it may have been deleted,
 * or its date may have moved outside the window. Those call for very different
 * words in front of the user, so each one is read individually to find out
 * which. In practice that is a handful of rows, not the whole plan.
 */
export async function loadLatestForDrift(input: {
  transport: ReconciliationTransport;
  accountId: string;
  transactionIds: string[];
  /** The range the session loaded, so the re-read covers the same ground. */
  startDate: string;
  endDate: string;
}): Promise<Map<string, ActualTransactionSnapshot | null>> {
  const latest = new Map<string, ActualTransactionSnapshot | null>();
  if (input.transactionIds.length === 0) return latest;

  const window = await input.transport.loadTransactions({
    accountId: input.accountId,
    startDate: input.startDate,
    endDate: input.endDate,
  });

  const byId = new Map(window.transactions.map((transaction) => [transaction.id, transaction]));

  const unaccounted: string[] = [];
  for (const id of input.transactionIds) {
    const found = byId.get(id);
    if (found) latest.set(id, found);
    else unaccounted.push(id);
  }

  for (const id of unaccounted) {
    latest.set(
      id,
      await input.transport.readTransaction({ accountId: input.accountId, transactionId: id })
    );
  }

  return latest;
}
