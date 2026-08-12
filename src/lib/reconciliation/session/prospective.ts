/**
 * What a row will look like after Apply.
 *
 * One definition, used by the planner to build write operations and by the
 * transformation engine to decide what a rule sees. Two implementations would
 * drift, and a transformation that reasons about different values than the
 * planner writes is a transformation the preview cannot be trusted about.
 *
 * The point of the abstraction: a rule should not care whether a transaction
 * already exists or is about to be created. "Tag everything this statement
 * touches" is one instruction, not two.
 */

import { effectiveValue } from "./staging";
import type { ApplyConfig } from "./plan";
import type {
  ActualTransactionSnapshot,
  MinorUnitAmount,
  ReconciliationItem,
  StatementRow,
} from "../types";

export type ProspectiveTransaction = {
  notes: string | null;
  payeeId: string | null;
  categoryId: string | null;
  amount: MinorUnitAmount | null;
  date: string | null;
  /**
   * The bank provenance this row will carry afterwards.
   *
   * Exposed so a transformation or the review screen can see what will be
   * written, but never staged: it is source truth, not a user field (RD-072
   * §2.1). For an existing transaction this is what Actual holds unless
   * enrichment will refresh it.
   */
  importedPayee: string | null;
  /**
   * The payee name a created row will be resolved from, when no payee id is
   * staged. Null for an existing transaction, whose payee already exists.
   */
  payeeName: string | null;
  /** True when this row has no transaction yet and Apply would create one. */
  isNew: boolean;
};

/**
 * Resolve the values a row will carry once applied.
 *
 * For an existing transaction that is whatever is staged, falling back to what
 * Actual holds. For one about to be created it is whatever is staged, falling
 * back to what the statement supplies — the bank's memo as the note, the bank's
 * merchant text as the payee candidate, and the merchant text as the imported
 * payee regardless (RD-072 §2.3).
 *
 * Notes and payee are resolved independently here, which is the whole point:
 * they are different fields answering different questions, and the model that
 * made them a single either/or choice could not express a statement that
 * supplied both.
 */
export function prospectiveTransaction(input: {
  item: ReconciliationItem;
  statementRow: StatementRow | undefined;
  transaction: ActualTransactionSnapshot | undefined;
  applyConfig: ApplyConfig;
}): ProspectiveTransaction {
  const { item, statementRow, transaction, applyConfig } = input;
  const patch = item.stagedChanges;
  const isNew = transaction === undefined;

  const statementImportedPayee = statementRow?.importedPayee.trim() || null;
  const statementBankNotes = statementRow?.bankNotes?.trim() || null;

  const baselineNotes = isNew ? notesBaseline() : transaction?.notes ?? null;

  function notesBaseline(): string | null {
    switch (applyConfig.notesStrategy) {
      case "bank-notes":
        return statementBankNotes;
      // A deliberate duplicate for people whose rules read the notes. The bank
      // memo still wins when there is one — it is the more specific answer to
      // "what does this note say".
      case "imported-payee":
        return statementBankNotes ?? statementImportedPayee;
      case "leave-unset":
        return null;
    }
  }

  return {
    notes: effectiveValue(patch, "notes", baselineNotes),
    payeeId: effectiveValue(patch, "payeeId", transaction?.payeeId ?? null),
    payeeName:
      isNew && !effectiveValue(patch, "payeeId", null) && applyConfig.payeeStrategy === "imported-payee"
        ? statementImportedPayee
        : null,
    // Attached on create, and refreshed on a match when enrichment is on;
    // otherwise whatever Actual already holds.
    importedPayee: isNew
      ? statementImportedPayee
      : applyConfig.enrichImportedPayee && statementImportedPayee
        ? statementImportedPayee
        : transaction?.importedPayee ?? null,
    // Read, never staged: reconciliation does not categorise.
    categoryId: transaction?.categoryId ?? null,
    amount: effectiveValue(
      patch,
      "amount",
      transaction?.amount ?? statementRow?.amount ?? null
    ),
    date: effectiveValue(patch, "date", transaction?.date ?? statementRow?.postedDate ?? null),
    isNew,
  };
}
