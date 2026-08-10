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
  /** True when this row has no transaction yet and Apply would create one. */
  isNew: boolean;
};

/**
 * Resolve the values a row will carry once applied.
 *
 * For an existing transaction that is whatever is staged, falling back to what
 * Actual holds. For one about to be created it is whatever is staged, falling
 * back to what the statement supplies — including the bank's description, which
 * lands in the notes or the payee according to the user's choice.
 *
 * That last part is what lets a rule add a tag to a new transaction without
 * discarding the description that was going to be its note.
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

  const baselineNotes = isNew
    ? applyConfig.descriptionTarget === "notes"
      ? statementRow?.description ?? null
      : null
    : transaction?.notes ?? null;

  return {
    notes: effectiveValue(patch, "notes", baselineNotes),
    payeeId: effectiveValue(patch, "payeeId", transaction?.payeeId ?? null),
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
