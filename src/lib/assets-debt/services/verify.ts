import type { SyncSourceTransaction } from "@/lib/actual/transport";
import type { RestructureSplitResult, LinkTransferResult } from "@/lib/actual/transactionStructure";
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
 * of get their own checks here: a restructured split and a counterpart link.
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
  | "imported-id-lost";

export type PostingIssue = { kind: PostingIssueKind; detail: string };

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
    if (row.amount !== op.amountMinor) issues.push({ kind: "missing-create", detail: "A created transaction does not have the previewed amount." });
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
}): PostingIssue[] {
  const issues: PostingIssue[] = [];
  const { result, expected } = input;
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
