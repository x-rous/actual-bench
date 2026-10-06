import { AppDbValidationError } from "@/lib/app-db/errors";
import { insertDebtTransactionLink, listDebtTransactionLinks } from "@/lib/app-db/debtTransactionLinkRepository";
import { getDebt } from "@/lib/app-db/debtRepository";
import { listSubjectPostings } from "@/lib/app-db/financialPostingRepository";
import type { SqliteDatabase } from "@/lib/app-db/types";

/**
 * "This is the payment" (owner decision 2026-10-07): the user names the Actual transaction that is a
 * due date's repayment. Stored as a link (role `repayment-choice`), never a claim: matching keeps
 * the pair fixed and lines everything else up around it. Nothing in Actual changes.
 */

const ROLE = "repayment-choice";

export function setRepaymentChoice(db: SqliteDatabase, debtId: string, input: { dueDate: string; transactionId: string }) {
  const debt = getDebt(db, debtId);
  if (!debt) throw new AppDbValidationError("Debt not found");
  const settled = listSubjectPostings(db, "debt", debtId).some((p) => ["applying", "applied", "indeterminate"].includes(String(p.status)) && ["repayment-split", "repayment-link"].includes(String(p.postingKind)) && p.periodKey === input.dueDate);
  if (settled) throw new AppDbValidationError("This due date already has an applied change; undo it first to choose another payment");
  db.transaction(() => {
    // One choice per due date, and a payment is one due date's repayment.
    for (const link of listDebtTransactionLinks(db, debtId)) {
      if (link.role === ROLE && (link.periodKey === input.dueDate || link.actualTransactionId === input.transactionId)) db.prepare("DELETE FROM debt_transaction_links WHERE id = ?").run(link.id);
    }
    insertDebtTransactionLink(db, { debtId, budgetSyncId: debt.budgetSyncId, actualTransactionId: input.transactionId, role: ROLE, periodKey: input.dueDate, linkSource: "user" });
  })();
}

export function clearRepaymentChoice(db: SqliteDatabase, debtId: string, dueDate: string) {
  for (const link of listDebtTransactionLinks(db, debtId)) {
    if (link.role === ROLE && link.periodKey === dueDate) db.prepare("DELETE FROM debt_transaction_links WHERE id = ?").run(link.id);
  }
}
