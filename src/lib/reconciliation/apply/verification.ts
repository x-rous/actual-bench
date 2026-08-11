/**
 * Checking afterwards that Apply did what it said it would (feature spec §33).
 *
 * The executor reports what each write *returned*. That is not the same claim as
 * "the budget now says what the review screen promised": a transport can report
 * success for a field it silently dropped, a create can land twice if a retry
 * raced, and a delete can be refused by a constraint nobody modelled. Those are
 * exactly the failures worth catching, because none of them announce themselves.
 *
 * So the account is read back and compared against the approved plan. Pure: the
 * caller performs the read, this decides what it means.
 *
 * Deliberately narrow. It verifies transactions and nothing else — rules,
 * schedules, and budget summaries are the rest of the feature's deferred scope.
 * A check that reported problems it could not substantiate would be worse than
 * no check at all.
 */

import type { ActualTransactionSnapshot, StagedPatch } from "../types";
import type { ApplyOperation, ApplyPlan, OperationResult } from "./operations";

export type VerificationIssueKind =
  /** An applied create is nowhere in the account. */
  | "missing-create"
  /** Its marker appears more than once — the duplicate the marker exists to prevent. */
  | "duplicate-create"
  /** An applied update's field does not hold the approved value. */
  | "unapplied-field"
  /** An applied delete's transaction is still there. */
  | "surviving-delete"
  /** A split parent no longer equals the sum of its lines. */
  | "split-sum"
  /** A row that was reconciled in Actual changed anyway. */
  | "reconciled-changed";

export type VerificationIssue = {
  operationId: string;
  kind: VerificationIssueKind;
  /** Plain enough to show the user without further interpretation. */
  detail: string;
};

export type VerificationReport = {
  /** How many applied operations were checked. */
  checked: number;
  issues: VerificationIssue[];
  /** True when every applied operation verified. */
  ok: boolean;
};

export type VerificationInput = {
  plan: ApplyPlan;
  results: OperationResult[];
  /**
   * The account as it reads now. Rows only — the caller decides how wide a
   * window to re-read, and a create that landed outside it would otherwise be
   * reported as missing, so the window must cover the operations' dates.
   */
  latest: ActualTransactionSnapshot[];
  /** Snapshots as the session saw them, for the reconciled-row check. */
  snapshots: Map<string, ActualTransactionSnapshot>;
};

const FIELD_LABELS: Record<string, string> = {
  amount: "amount",
  date: "date",
  payeeId: "payee",
  notes: "notes",
};

function fieldOf(
  transaction: ActualTransactionSnapshot,
  field: keyof StagedPatch
): string | number | null {
  return transaction[field];
}

export function verifyApply(input: VerificationInput): VerificationReport {
  const applied = new Set(
    input.results.filter((result) => result.status === "applied").map((result) => result.operationId)
  );
  const operationById = new Map(input.plan.operations.map((operation) => [operation.id, operation]));

  const byId = new Map(input.latest.map((transaction) => [transaction.id, transaction]));
  const markerCounts = new Map<string, number>();
  for (const transaction of input.latest) {
    if (!transaction.importedId) continue;
    markerCounts.set(transaction.importedId, (markerCounts.get(transaction.importedId) ?? 0) + 1);
  }

  const issues: VerificationIssue[] = [];
  let checked = 0;

  for (const operationId of applied) {
    const operation = operationById.get(operationId);
    if (!operation) continue;
    checked += 1;
    issues.push(...verifyOne(operation, { byId, markerCounts, snapshots: input.snapshots }));
  }

  return { checked, issues, ok: issues.length === 0 };
}

function verifyOne(
  operation: ApplyOperation,
  context: {
    byId: Map<string, ActualTransactionSnapshot>;
    markerCounts: Map<string, number>;
    snapshots: Map<string, ActualTransactionSnapshot>;
  }
): VerificationIssue[] {
  const issues: VerificationIssue[] = [];

  if (operation.kind === "create") {
    const count = context.markerCounts.get(operation.marker) ?? 0;
    if (count === 0) {
      issues.push({
        operationId: operation.id,
        kind: "missing-create",
        detail: "This transaction was reported as created but is not in the account.",
      });
    } else if (count > 1) {
      issues.push({
        operationId: operation.id,
        kind: "duplicate-create",
        detail: `This transaction appears ${count} times in the account - it was created more than once.`,
      });
    }
    return issues;
  }

  if (operation.kind === "delete") {
    if (context.byId.has(operation.transactionId)) {
      issues.push({
        operationId: operation.id,
        kind: "surviving-delete",
        detail: "This transaction was reported as deleted but is still in the account.",
      });
    }
    return issues;
  }

  const live = context.byId.get(operation.transactionId);
  if (!live) {
    // Updated and then gone. Not something this run did, but not something to
    // stay quiet about either.
    issues.push({
      operationId: operation.id,
      kind: "unapplied-field",
      detail: "This transaction was updated but is no longer in the account.",
    });
    return issues;
  }

  for (const field of Object.keys(operation.patch) as (keyof StagedPatch)[]) {
    const value = operation.patch[field];
    if (!value) continue;
    if (fieldOf(live, field) === value.staged) continue;
    issues.push({
      operationId: operation.id,
      kind: "unapplied-field",
      detail: `The ${FIELD_LABELS[field] ?? field} was reported as updated but the account still reads differently.`,
    });
  }

  if (operation.cleared === true && !live.cleared) {
    issues.push({
      operationId: operation.id,
      kind: "unapplied-field",
      detail: "This transaction was reported as cleared but is not cleared in the account.",
    });
  }

  // A split parent whose lines no longer add up is corrupt in a way Actual will
  // not surface on its own.
  if (live.isParent && live.splitLines.length > 0) {
    const sum = live.splitLines.reduce((total, line) => total + line.amount, 0);
    if (sum !== live.amount) {
      issues.push({
        operationId: operation.id,
        kind: "split-sum",
        detail: "This split transaction's lines no longer add up to its total.",
      });
    }
  }

  // Reconciled rows are locked in Actual for a reason; nothing here should have
  // moved one.
  const snapshot = context.snapshots.get(operation.transactionId);
  if (snapshot?.reconciled && changedMaterially(snapshot, live)) {
    issues.push({
      operationId: operation.id,
      kind: "reconciled-changed",
      detail: "This transaction was reconciled in Actual and should not have been changed.",
    });
  }

  return issues;
}

function changedMaterially(
  before: ActualTransactionSnapshot,
  after: ActualTransactionSnapshot
): boolean {
  return (
    before.amount !== after.amount ||
    before.date !== after.date ||
    before.payeeId !== after.payeeId ||
    before.notes !== after.notes
  );
}
