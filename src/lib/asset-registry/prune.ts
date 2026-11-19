import { z } from "zod";
import { idSchema, type Registry } from "./models";

/**
 * Actual is the truth. After a complete read, anything Bench saved about a transaction that is no longer in Actual (or no
 * longer in the account Bench saved it for) is dropped, together with whatever only made sense because of it. Nothing here
 * reads or writes Actual.
 */
export const pruneEvidenceSchema = z.object({
  budgetSyncId: idSchema,
  /** Every account that exists in Actual now. Never empty: a budget without accounts proves nothing, so it is refused rather than read as "everything is gone". */ directory: z.array(idSchema).min(1, "The account directory is empty").max(10000),
  /** Accounts read completely (no read issue, ledger reconciled) with every transaction id they hold. */
  accounts: z.array(z.object({ accountId: idSchema, ids: z.array(idSchema).max(500000) }).strict()).max(10000),
  /** When the oldest of those reads started. A link saved after it (from another tab or device) is newer than the evidence and is kept. */
  readAt: z.string().datetime({ offset: true }),
}).strict();
export type PruneEvidence = z.infer<typeof pruneEvidenceSchema>;
export type PrunePlan = {
  /** Book rows and income/expense links to delete. */ removeBook: string[]; removeCashflow: string[];
};
export const pruneSize = (plan: PrunePlan): number => plan.removeBook.length + plan.removeCashflow.length;

/** `keep` holds transactions whose saved metadata is newer than the evidence: they are never dropped by it. */
export function planPrune(registry: Registry, evidence: Pick<PruneEvidence, "directory" | "accounts">, keep: ReadonlySet<string> = new Set()): PrunePlan {
  const directory = new Set(evidence.directory);
  const read = new Map(evidence.accounts.map((a) => [a.accountId, new Set(a.ids)]));
  const gone = (m: { actualTransactionId: string; actualAccountId: string }) => !keep.has(m.actualTransactionId) &&
    (!directory.has(m.actualAccountId) || (read.has(m.actualAccountId) && !read.get(m.actualAccountId)!.has(m.actualTransactionId)));
  const book = registry.metadata; const links = registry.cashflows ?? [];
  const removeBook = new Set(book.filter(gone).map((m) => m.actualTransactionId));
  const removeCashflow = new Set(links.filter(gone).map((m) => m.actualTransactionId));
  // A selling cost belongs to its sale; without the sale it is not a cost of anything. This holds for a cost saved after the
  // reads began too: keeping it would leave it anchored to a sale that is removed here.
  for (const link of links) {
    const anchor = link.context?.data.kind === "selling-cost" ? link.context.data.disposalTransactionId : null;
    if (anchor && !book.some((m) => m.actualTransactionId === anchor && !removeBook.has(anchor)) && !links.some((m) => m.actualTransactionId === anchor && !removeCashflow.has(anchor))) removeCashflow.add(link.actualTransactionId);
  }
  return { removeBook: [...removeBook], removeCashflow: [...removeCashflow] };
}

/** What the client read: the evidence is only built from reads that finished without a problem. */
export type PruneReads = {
  books: { accountId: string; complete: boolean; ids: string[] }[];
  /** Directory of Actual's accounts, as read now. */ directory: string[];
  /** `reconciled` lists the accounts whose rows were checked against Actual's balance; only those count as complete. */
  external: { accountIds: string[]; rows: { id: string; accountId: string }[]; accountIssues: Record<string, string[] | undefined>; reconciled: readonly string[] };
  /** ISO time the oldest of these reads started. */ readAt: string;
};
export function buildPruneEvidence(budgetSyncId: string, reads: PruneReads): PruneEvidence {
  const accounts = reads.books.filter((b) => b.complete).map((b) => ({ accountId: b.accountId, ids: b.ids }));
  for (const accountId of reads.external.accountIds) {
    if (reads.external.accountIssues[accountId]?.length || !reads.external.reconciled.includes(accountId) || accounts.some((a) => a.accountId === accountId)) continue;
    accounts.push({ accountId, ids: reads.external.rows.filter((r) => r.accountId === accountId).map((r) => r.id) });
  }
  return { budgetSyncId, directory: reads.directory, accounts, readAt: reads.readAt };
}
