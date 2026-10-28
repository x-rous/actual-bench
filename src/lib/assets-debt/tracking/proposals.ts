import type { SyncSourceTransaction } from "@/lib/actual/transport";
import type { DirectoryAccount } from "../actual/ledgerPort";
import { paymentChildCategory, transferLegCategory } from "../actual/representation";
import { buildPostingMarker } from "../markers";
import { POSTING_OUTPUT_FORMAT, POSTING_OUTPUT_FORMAT_VERSION, type ChildSpec, type PostingOutputSnapshot, type RowSnapshot } from "../services/snapshot";

/**
 * What Bench writes to Actual for a tracked loan, as the output documents the shared executor already applies and
 * verifies (`services/applyService.ts`). Pure: building a proposal reads nothing and writes nothing.
 */

export type ProposalKind = "split" | "convert" | "create" | "adjust-split" | "undo-split";

export type Proposal = {
  kind: ProposalKind;
  output: PostingOutputSnapshot;
  /** The Actual rows the write changes; re-read just before the write. */
  targetIds: string[];
  /** The installment the write records, when it records one. */
  dueDate: string | null;
};

export type ProposalContext = {
  budgetSyncId: string;
  debtId: string;
  liabilityAccountId: string;
  accounts: readonly DirectoryAccount[];
  transferPayeeByAccount: Readonly<Record<string, string>>;
  loanPaymentCategoryId: string | null;
  interestCategoryId: string | null;
  feeCategoryId: string | null;
  principalNoteSuffix: string;
  interestNoteSuffix: string;
};

/** A row as the executor's preflight compares it. */
export function rowSnapshot(row: SyncSourceTransaction): RowSnapshot {
  return {
    id: row.id, accountId: row.accountId, date: row.date, amountMinor: row.amount, payeeId: row.payeeId, payeeName: row.payeeName ?? null,
    categoryId: row.categoryId, notes: row.notes ?? null, cleared: row.cleared, reconciled: row.reconciled, importedId: row.importedId ?? null,
    importedPayee: row.importedPayee ?? null, transferId: row.transferId ?? null, isParent: row.isParent, isChild: row.isChild, parentId: row.parentId,
    childCount: row.splitLines.length,
  };
}

/** A split line's Notes: the payment's own Notes, then the loan's text for that line (never added twice). */
export function lineNotes(parentNotes: string | null, suffix: string): string {
  const base = (parentNotes ?? "").trim();
  const extra = suffix.trim();
  if (!extra) return base;
  if (base.split(/\s+/).includes(extra) || base.endsWith(extra)) return base;
  return base ? `${base} ${extra}` : extra;
}

const status = (ctx: ProposalContext, ids: string[]) => Object.fromEntries(ids.flatMap((id) => {
  const account = ctx.accounts.find((a) => a.id === id);
  return account ? [[id, account.offBudget ? "off-budget" as const : "on-budget" as const]] : [];
}));

export type SplitParts = { interestMinor: number; feesMinor: number; notes?: { principal?: string; interest?: string; fee?: string } };
export type ProposalProblem = { ok: false; reason: string };

/**
 * Split one payment into a principal transfer to the loan account, an interest line and (when the contract has a fixed
 * fee) a fee line. The principal is the exact rest, so the lines always add up to the payment. A payment that is already
 * a whole transfer replaces the loan-side row Actual made for it (Actual deletes it and makes the principal's own).
 */
export function splitProposal(ctx: ProposalContext, payment: SyncSourceTransaction, parts: SplitParts, input: { dueDate: string; loanSide: SyncSourceTransaction | null }): Proposal | ProposalProblem {
  const paying = ctx.accounts.find((a) => a.id === payment.accountId);
  const loan = ctx.accounts.find((a) => a.id === ctx.liabilityAccountId);
  if (!paying || !loan) return { ok: false, reason: "The paying account or the loan account is missing from this budget." };
  const transferPayee = ctx.transferPayeeByAccount[ctx.liabilityAccountId];
  if (!transferPayee) return { ok: false, reason: "Bench cannot find the loan account's transfer payee. Refresh and try again." };
  const sign = payment.amount < 0 ? -1 : 1;
  // A payment that is already a transfer carries the loan's transfer payee; no other line may inherit it.
  const linePayee = Object.values(ctx.transferPayeeByAccount).includes(payment.payeeId ?? "") ? null : payment.payeeId;
  const children: ChildSpec[] = [];
  if (parts.interestMinor > 0) {
    const category = paymentChildCategory(paying, ctx.interestCategoryId, "interest");
    if (!category.ok) return { ok: false, reason: "Choose an interest category in Link to Actual." };
    children.push({ economicKind: "interest", amountMinor: sign * parts.interestMinor, categoryId: category.categoryId, payeeId: linePayee, transferAccountId: null, notes: parts.notes?.interest ?? lineNotes(payment.notes, ctx.interestNoteSuffix) });
  }
  if (parts.feesMinor > 0) {
    const category = paymentChildCategory(paying, ctx.feeCategoryId, "fee");
    if (!category.ok) return { ok: false, reason: "Choose a fee category in Link to Actual." };
    children.push({ economicKind: "fee", amountMinor: sign * parts.feesMinor, categoryId: category.categoryId, payeeId: linePayee, transferAccountId: null, notes: parts.notes?.fee ?? lineNotes(payment.notes, "") });
  }
  const principal = payment.amount - children.reduce((sum, c) => sum + c.amountMinor, 0);
  if (Math.sign(principal) !== sign || principal === 0) return { ok: false, reason: "The payment doesn't leave any principal after the interest." };
  if (children.length === 0) return { ok: false, reason: "There is no interest to split off this payment." };
  const principalCategory = transferLegCategory(paying, loan, ctx.loanPaymentCategoryId, "loan payment");
  if (!principalCategory.ok) return { ok: false, reason: "Choose a loan payment category in Link to Actual: Actual needs one on a transfer from a budget account to an off-budget account." };
  children.unshift({ economicKind: "principal", amountMinor: principal, categoryId: principalCategory.categoryId, payeeId: transferPayee, transferAccountId: ctx.liabilityAccountId, notes: parts.notes?.principal ?? lineNotes(payment.notes, ctx.principalNoteSuffix) });
  const before = rowSnapshot(payment);
  const replaces = input.loanSide ? rowSnapshot(input.loanSide) : null;
  return {
    kind: "split", dueDate: input.dueDate, targetIds: [payment.id, ...(replaces ? [replaces.id] : [])],
    output: {
      format: POSTING_OUTPUT_FORMAT, version: POSTING_OUTPUT_FORMAT_VERSION, kind: "restructure",
      before, operations: children, expectedPostState: { parentId: payment.id, parentAmountMinor: payment.amount, children },
      accountBudgetStatus: status(ctx, [payment.accountId, ctx.liabilityAccountId]),
      components: children.map((c) => ({ kind: c.economicKind, amountMinor: Math.abs(c.amountMinor) })),
      closing: null,
      ...(replaces ? { replacesCounterpart: replaces } : {}),
    },
  };
}

/** Make a payment the loan transfer by its payee (an interest-free loan paid as an expense): Actual makes the loan-side row. */
export function convertProposal(ctx: ProposalContext, payment: SyncSourceTransaction, dueDate: string): Proposal | ProposalProblem {
  const transferPayee = ctx.transferPayeeByAccount[ctx.liabilityAccountId];
  if (!transferPayee) return { ok: false, reason: "Bench cannot find the loan account's transfer payee. Refresh and try again." };
  return {
    kind: "convert", dueDate, targetIds: [payment.id],
    output: {
      format: POSTING_OUTPUT_FORMAT, version: POSTING_OUTPUT_FORMAT_VERSION, kind: "convert",
      before: rowSnapshot(payment), transferPayeeId: transferPayee, transferAccountId: ctx.liabilityAccountId,
      expectedCounterpart: { accountId: ctx.liabilityAccountId, amountMinor: -payment.amount, notes: payment.notes ?? null },
      accountBudgetStatus: status(ctx, [payment.accountId, ctx.liabilityAccountId]), closing: null,
    },
  };
}

export function adjustmentMarker(ctx: Pick<ProposalContext, "budgetSyncId" | "debtId">, key: string, generation = 1): string {
  return buildPostingMarker({ budgetSyncId: ctx.budgetSyncId, subjectId: ctx.debtId, postingKind: "loan-adjustment", periodKey: key, generation });
}

/** One row in the loan account (off budget, so no category) that moves its balance by `ledgerAmountMinor`. */
export function adjustmentProposal(ctx: ProposalContext, input: { date: string; ledgerAmountMinor: number; notes: string; key: string; generation?: number }): Proposal {
  const importedId = adjustmentMarker(ctx, input.key, input.generation);
  return {
    kind: "create", dueDate: null, targetIds: [],
    output: {
      format: POSTING_OUTPUT_FORMAT, version: POSTING_OUTPUT_FORMAT_VERSION, kind: "create",
      operations: [{ accountId: ctx.liabilityAccountId, date: input.date, amountMinor: input.ledgerAmountMinor, payeeId: null, transferAccountId: null, categoryId: null, notes: input.notes, cleared: true, importedId, economicKind: "adjustment" }],
      accountBudgetStatus: status(ctx, [ctx.liabilityAccountId]),
      components: [{ kind: "adjustment", amountMinor: Math.abs(input.ledgerAmountMinor) }],
      closing: null,
    },
  };
}

/**
 * Undo a split already in Actual: delete its lines so the payment becomes one transaction again. With the journal's
 * record of what Bench split (`original`), it goes back exactly to that row, and a transfer's loan-side row comes back.
 * Without it (a split someone else made), it becomes one whole transfer into the loan account.
 */
export function undoSplitProposal(ctx: ProposalContext, split: SyncSourceTransaction, input: { dueDate: string | null; original?: { before: RowSnapshot; replacesCounterpart: RowSnapshot | null } | null }): Proposal | ProposalProblem {
  if (!split.isParent || !split.splitLines.length) return { ok: false, reason: "This payment is not split in Actual." };
  if (split.reconciled) return { ok: false, reason: "The payment is reconciled in Actual. Unlock it there first." };
  const parent = rowSnapshot(split);
  const children = split.splitLines.map((line) => rowSnapshot({
    ...split, id: line.id ?? "", amount: line.amount, payeeId: line.payeeId, payeeName: line.payeeName, categoryId: line.categoryId, notes: line.notes,
    transferId: line.transferId ?? null, isParent: false, isChild: true, parentId: split.id, splitLines: [], importedId: null, importedPayee: null,
  }));
  if (children.some((c) => !c.id)) return { ok: false, reason: "This connection doesn't show the split's lines with their ids." };
  const counterpartAccountIds = split.splitLines.some((l) => l.transferId) ? [ctx.liabilityAccountId] : [];
  let restoreTo: RowSnapshot;
  let recreated: RowSnapshot | null;
  if (input.original) {
    restoreTo = input.original.before;
    recreated = input.original.replacesCounterpart;
  } else {
    const toLoan = ctx.transferPayeeByAccount[ctx.liabilityAccountId];
    const back = ctx.transferPayeeByAccount[split.accountId];
    if (!toLoan || !back) return { ok: false, reason: "Bench cannot find the accounts' transfer payees. Refresh and try again." };
    const paying = ctx.accounts.find((a) => a.id === split.accountId);
    const loan = ctx.accounts.find((a) => a.id === ctx.liabilityAccountId);
    const sameStatus = !!paying && !!loan && paying.offBudget === loan.offBudget;
    restoreTo = { ...parent, isParent: false, childCount: 0, payeeId: toLoan, categoryId: sameStatus ? null : ctx.loanPaymentCategoryId, transferId: null };
    recreated = {
      id: "", accountId: ctx.liabilityAccountId, date: split.date, amountMinor: -split.amount, payeeId: back, payeeName: null, categoryId: null, notes: parent.notes,
      cleared: false, reconciled: false, importedId: null, importedPayee: null, transferId: split.id, isParent: false, isChild: false, parentId: null, childCount: 0,
    };
  }
  return {
    kind: "undo-split", dueDate: input.dueDate, targetIds: [split.id, ...children.map((c) => c.id)],
    output: { format: POSTING_OUTPUT_FORMAT, version: POSTING_OUTPUT_FORMAT_VERSION, kind: "restore-split", parent, children, counterpartAccountIds, restoreTo, recreatedCounterpart: recreated, closing: null },
  };
}

/** Change an existing split's principal and interest in place (every id kept); Actual moves the loan-side row with the principal. */
export function adjustSplitProposal(split: SyncSourceTransaction, input: { dueDate: string | null; principalLineId: string; interestLineId: string; principalMinor: number; interestMinor: number; loanSide: SyncSourceTransaction | null; calculatedInterestMinor: number }): Proposal | ProposalProblem {
  const lines = split.splitLines;
  const principalLine = lines.find((l) => l.id === input.principalLineId);
  const interestLine = lines.find((l) => l.id === input.interestLineId);
  if (!principalLine || !interestLine) return { ok: false, reason: "The split changed in Actual. Refresh and try again." };
  const sign = split.amount < 0 ? -1 : 1;
  const others = lines.filter((l) => l !== principalLine && l !== interestLine).reduce((sum, l) => sum + l.amount, 0);
  if (sign * input.principalMinor + sign * input.interestMinor + others !== split.amount) return { ok: false, reason: "The principal and interest must add up to the payment." };
  const asRow = (l: (typeof lines)[number]) => rowSnapshot({ ...split, id: l.id ?? "", amount: l.amount, payeeId: l.payeeId, payeeName: l.payeeName, categoryId: l.categoryId, notes: l.notes, transferId: l.transferId ?? null, isParent: false, isChild: true, parentId: split.id, splitLines: [], importedId: null, importedPayee: null });
  const children = lines.map(asRow);
  const amounts = lines.map((l) => ({ id: l.id ?? "", amountMinor: l === principalLine ? sign * input.principalMinor : l === interestLine ? sign * input.interestMinor : l.amount }));
  const parent = rowSnapshot(split);
  return {
    kind: "adjust-split", dueDate: input.dueDate, targetIds: [split.id, ...children.map((c) => c.id), ...(input.loanSide ? [input.loanSide.id] : [])],
    output: {
      format: POSTING_OUTPUT_FORMAT, version: POSTING_OUTPUT_FORMAT_VERSION, kind: "adjust-split",
      parent, children, counterpart: input.loanSide ? rowSnapshot(input.loanSide) : null, amounts,
      recordedSplit: { parent, children, principalMinor: input.principalMinor, interestMinor: input.interestMinor, calculatedInterestMinor: input.calculatedInterestMinor },
      edit: null, closing: null,
    },
  };
}
