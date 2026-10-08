import type { SyncSourceTransaction } from "@/lib/actual/transport";
import type { ConvertToTransferResult, LinkTransferResult, RestoreSplitResult, RestructureSplitResult, RevertTransferResult, UnlinkTransferResult } from "@/lib/actual/transactionStructure";
import { verifyApply } from "@/lib/reconciliation/apply/verification";
import type { CreateOperation as ReconciliationCreate } from "@/lib/reconciliation/apply/operations";
import { toActualSnapshot } from "@/lib/reconciliation/transportAdapter";
import type { CreateOperation, ExpectedPostState, RowSnapshot } from "./snapshot";

/**
 * Post-apply verification (RD-084 P1.6 T128; research R-13).
 *
 * The create path reuses Bank Statement Reconciliation's verifier
 * (`verifyApply`): missing create and duplicate marker are exactly its
 * `missing-create` and `duplicate-create`. Only the two shapes it has no notion
 * of get their own checks here: a restructured split, a counterpart link, a
 * payment converted to a transfer, and the exact-restoration checks of Undo.
 * Pure: the caller performs the read, this decides what it means.
 */

export type PostingIssueKind =
  | "missing-create"
  | "duplicate-create"
  | "split-sum"
  | "split-mismatch"
  | "reconciled-changed"
  | "liability-rows"
  | "category-rule"
  | "link-incomplete"
  | "imported-id-lost"
  | "replaced-counterpart-remains"
  | "restore-mismatch"
  | "leftover-rows"
  | "convert-mismatch";

export type PostingIssue = { kind: PostingIssueKind; detail: string };

/** A marker identifies the operation; these fields prove its approved financial result. */
export function createdRowDifferences(op: CreateOperation, row: SyncSourceTransaction): string[] {
  const differences: string[] = [];
  if (row.accountId !== op.accountId) differences.push("account");
  if (row.date !== op.date) differences.push("date");
  if (row.amount !== op.amountMinor) differences.push("amount");
  if (row.payeeId !== op.payeeId) differences.push("payee");
  if (row.categoryId !== op.categoryId) differences.push("category");
  if ((row.notes ?? "") !== (op.notes ?? "")) differences.push("notes");
  if (row.cleared !== op.cleared) differences.push("cleared");
  if (row.isParent || row.isChild || (!!row.transferId !== !!op.transferAccountId)) differences.push("structure");
  return differences;
}

/** Creates: reuse the reconciliation verifier, then check the account-status category rule. */
export function verifyCreatedRows(input: {
  operations: CreateOperation[];
  latest: SyncSourceTransaction[];
  offBudgetAccountIds: ReadonlySet<string>;
}): { issues: PostingIssue[]; createdIds: string[] } {
  const plan = {
    operations: input.operations.map((op, index): ReconciliationCreate => ({
      id: `op-${index}`, kind: "create", itemId: `op-${index}`, statementRowId: `op-${index}`, accountId: op.accountId, date: op.date,
      amount: op.amountMinor, payeeName: null, payeeId: op.payeeId, importedPayee: null, categoryId: op.categoryId, notes: op.notes, marker: op.importedId,
    })),
    alreadyApplied: 0, noWriteMatches: 0, unreconciledDifferences: [], unresolved: 0,
  };
  const report = verifyApply({
    plan: plan as never,
    results: plan.operations.map((op) => ({ operationId: op.id, status: "applied" as const })),
    latest: input.latest.map((row) => toActualSnapshot(row, { transfersReported: true })),
    snapshots: new Map(),
  });
  const issues: PostingIssue[] = report.issues.map((issue) => ({ kind: issue.kind as PostingIssueKind, detail: issue.detail }));
  const createdIds: string[] = [];
  for (const op of input.operations) {
    const row = input.latest.find((r) => r.importedId === op.importedId);
    if (!row) continue;
    createdIds.push(row.id);
    const differences = createdRowDifferences(op, row);
    if (differences.length) issues.push({ kind: "missing-create", detail: `A created transaction differs from the approved ${differences.join(", ")}.` });
    if (input.offBudgetAccountIds.has(row.accountId) && row.categoryId !== null) {
      issues.push({ kind: "category-rule", detail: "An off-budget transaction carries a category." });
    }
  }
  return { issues, createdIds };
}

/** Split restructure: exact children, sum equals parent, one liability-side row for a transfer principal. */
export function verifySplitOutcome(input: {
  expected: ExpectedPostState;
  result: RestructureSplitResult;
  transferPayeeByAccount: Record<string, string>;
  liabilityRows: SyncSourceTransaction[];
  before: RowSnapshot;
  /** T279: the counterpart Actual must have deleted. */
  replacedCounterpartId?: string | null;
}): PostingIssue[] {
  const issues: PostingIssue[] = [];
  const { result, expected } = input;
  if (input.replacedCounterpartId && input.liabilityRows.some((row) => row.id === input.replacedCounterpartId)) {
    issues.push({ kind: "replaced-counterpart-remains", detail: "The original loan-side row of the transfer is still there next to the new one." });
  }
  if (input.before.reconciled) issues.push({ kind: "reconciled-changed", detail: "A reconciled transaction was restructured." });
  if (result.children.reduce((sum, c) => sum + c.amount, 0) !== result.parentAmount || result.parentAmount !== expected.parentAmountMinor) {
    issues.push({ kind: "split-sum", detail: "The split children do not add up to the transaction." });
  }
  if (result.children.length !== expected.children.length) {
    issues.push({ kind: "split-mismatch", detail: "The split does not have the previewed children." });
    return issues;
  }
  expected.children.forEach((want, index) => {
    const got = result.children[index];
    const payee = want.transferAccountId ? input.transferPayeeByAccount[want.transferAccountId] ?? null : want.payeeId;
    if (got.amount !== want.amountMinor || got.categoryId !== want.categoryId || got.payeeId !== payee || got.notes !== want.notes) {
      issues.push({ kind: "split-mismatch", detail: `The ${want.economicKind} line does not hold the previewed values.` });
    }
    if (want.transferAccountId) {
      const sides = input.liabilityRows.filter((row) => row.transferId === got.id);
      if (sides.length !== 1 || sides[0].amount !== -got.amount) {
        issues.push({ kind: "liability-rows", detail: `Expected exactly one loan-account row for the principal; found ${sides.length}.` });
      }
    }
  });
  return issues;
}

/** Counterpart link: reciprocal ids, exact amount, imported fields kept, no stray counterpart. */
export function verifyLinkOutcome(input: {
  result: LinkTransferResult;
  expected: { sourceTransferId: string; counterpartTransferId: string; counterpartAmountMinor: number };
  counterpartBefore: RowSnapshot;
  counterpartNow: SyncSourceTransaction | null;
  sourceAccountRows: SyncSourceTransaction[];
}): PostingIssue[] {
  const issues: PostingIssue[] = [];
  if (input.result.sourceTransferId !== input.expected.sourceTransferId || input.result.counterpartTransferId !== input.expected.counterpartTransferId) {
    issues.push({ kind: "link-incomplete", detail: "The two rows do not reference each other." });
  }
  if (input.result.counterpartAmount !== input.expected.counterpartAmountMinor) {
    issues.push({ kind: "link-incomplete", detail: "The lender row's amount changed." });
  }
  if (input.counterpartNow && (input.counterpartNow.importedId ?? null) !== input.counterpartBefore.importedId) {
    issues.push({ kind: "imported-id-lost", detail: "The lender row lost its imported id." });
  }
  const strays = input.sourceAccountRows.flatMap((row) => [row, ...row.splitLines.map((line) => ({ ...line, id: line.id ?? "" }))])
    .filter((row) => row.transferId === input.counterpartBefore.id && row.id !== input.expected.counterpartTransferId);
  if (strays.length) issues.push({ kind: "liability-rows", detail: "Actual created an extra counterpart for the lender row." });
  return issues;
}

/** Undo of a split: the original row exactly, no line or counterpart left, and any re-created counterpart as it was. */
export function verifyRestoreOutcome(result: RestoreSplitResult): PostingIssue[] {
  const issues: PostingIssue[] = [];
  if (result.differences.length) issues.push({ kind: "restore-mismatch", detail: `The transaction is not exactly as it was: ${result.differences.join(", ")}.` });
  if (result.leftovers.length) issues.push({ kind: "leftover-rows", detail: `${result.leftovers.length} split line or loan-side row is still in Actual.` });
  if (result.recreated && result.recreated.differences.length) {
    issues.push({ kind: "restore-mismatch", detail: `The loan-side row Actual re-created differs from the original: ${result.recreated.differences.join(", ")}.` });
  }
  return issues;
}

/** Undo of a link: both rows exactly as they were, and the lender's row still there. */
export function verifyUnlinkOutcome(result: UnlinkTransferResult): PostingIssue[] {
  const issues: PostingIssue[] = [];
  if (!result.counterpartExists) issues.push({ kind: "restore-mismatch", detail: "The lender's row is no longer in Actual." });
  if (result.sourceDifferences.length) issues.push({ kind: "restore-mismatch", detail: `The payment is not exactly as it was: ${result.sourceDifferences.join(", ")}.` });
  if (result.counterpartDifferences.length) issues.push({ kind: "restore-mismatch", detail: `The lender's row is not exactly as it was: ${result.counterpartDifferences.join(", ")}.` });
  return issues;
}

/** A conversion: the payment is a transfer with exactly one loan-side row holding the mirrored amount. */
export function verifyConvertOutcome(input: {
  result: ConvertToTransferResult;
  expected: { accountId: string; amountMinor: number; notes: string | null };
  paymentId: string;
  counterpartAccountRows: SyncSourceTransaction[];
}): PostingIssue[] {
  const issues: PostingIssue[] = [];
  const { result, expected } = input;
  if (!result.transferId || !result.counterpart) return [{ kind: "convert-mismatch", detail: "The payment did not become a transfer." }];
  if (result.counterpart.accountId !== expected.accountId || result.counterpart.amount !== expected.amountMinor || (result.counterpart.notes ?? null) !== (expected.notes ?? null)) {
    issues.push({ kind: "convert-mismatch", detail: "The loan-side row does not hold the previewed account, amount or notes." });
  }
  const sides = input.counterpartAccountRows.filter((row) => row.transferId === input.paymentId);
  if (sides.length !== 1) issues.push({ kind: "liability-rows", detail: `Expected exactly one loan-account row for the payment; found ${sides.length}.` });
  return issues;
}

/** Undo of a conversion: the payment exactly as it was and the loan-side row Actual made gone. */
export function verifyRevertOutcome(result: RevertTransferResult): PostingIssue[] {
  const issues: PostingIssue[] = [];
  if (result.differences.length) issues.push({ kind: "restore-mismatch", detail: `The payment is not exactly as it was: ${result.differences.join(", ")}.` });
  if (result.counterpartRemains) issues.push({ kind: "leftover-rows", detail: "The loan-side row of the transfer is still in Actual." });
  return issues;
}
