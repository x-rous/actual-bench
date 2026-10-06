import type { Anchor, LoanModelSnapshot } from "@/lib/financial-models/loan/model";
import { projectDebt, type DebtProjectionEvent } from "@/lib/financial-models/loan/projection";
import { allocateObservedRepayments, type AllocatedRepayment, type InterestAllocation, type ObservedRepayment } from "@/lib/financial-models/loan/statementAllocation";
import { mergeOffsetHistories, type OffsetHistorySnapshot } from "./offsetHistoryService";

/**
 * Posting snapshots (RD-084 P1.6 T115; data-model.md "Posting snapshots",
 * FR-009, FR-155, FR-180).
 *
 * Client-safe and pure. A posting stores two immutable documents:
 *
 * - the **input snapshot**: what the calculation used. It is bounded: the
 *   opening (the effective anchor), the period, the offset balance steps the
 *   projection consumed, and the Actual ids plus preflight fields of the rows
 *   matched. Never the account history.
 * - the **output snapshot**: exactly what Bench will write or link, as a
 *   discriminated union (`create` | `restructure` | `link`), including the
 *   before state of every existing row and the exact expected post-state that
 *   verification, recovery and the preview read.
 *
 * Money is exact everywhere: integer minor units as JSON safe integers, and
 * sub-minor values as decimal strings. `assertExactMoney` refuses anything
 * else, and the repository hashes through `canonicalJson`, which refuses a
 * fractional or unsafe number too.
 */

export const POSTING_INPUT_FORMAT = "rd084.posting-input";
/** v2 adds `observedRepayments` (actual-dated repayment splits); v1 snapshots stay readable. */
export const POSTING_INPUT_FORMAT_VERSION = 2;
export const POSTING_OUTPUT_FORMAT = "rd084.posting-output";
export const POSTING_OUTPUT_FORMAT_VERSION = 1;

export type EconomicKind = "principal" | "interest" | "fee" | "escrow" | "insurance" | "tax" | "draw" | "other" | "adjustment";

/** An existing Actual row as Bench saw it: its id and every field preflight compares. */
export type RowSnapshot = {
  id: string;
  accountId: string;
  date: string;
  amountMinor: number;
  payeeId: string | null;
  payeeName: string | null;
  categoryId: string | null;
  notes: string | null;
  cleared: boolean;
  reconciled: boolean;
  importedId: string | null;
  importedPayee: string | null;
  transferId: string | null;
  isParent: boolean;
  isChild: boolean;
  parentId: string | null;
  childCount: number;
};

/** A row Bench will create. `importedId` is the posting's deterministic marker. */
export type CreateOperation = {
  accountId: string;
  date: string;
  amountMinor: number;
  payeeId: string | null;
  /** Transfer target account when `payeeId` is that account's transfer payee. */
  transferAccountId: string | null;
  categoryId: string | null;
  notes: string;
  cleared: boolean;
  importedId: string;
  economicKind: EconomicKind;
};

/** One split child of a restructure, in final order. */
export type ChildSpec = {
  economicKind: EconomicKind;
  amountMinor: number;
  categoryId: string | null;
  payeeId: string | null;
  /** The account whose transfer payee `payeeId` is; Actual then creates the counterpart (R-06). */
  transferAccountId: string | null;
  notes: string;
};

export type ExpectedPostState = {
  parentId: string;
  parentAmountMinor: number;
  children: ChildSpec[];
};

export type ComponentLine = { kind: EconomicKind; amountMinor: number };

/** A repayment split in Actual: the split, its principal (the transfer part) and interest, and Bench's interest for comparison. */
export type RecordedSplit = {
  parent: RowSnapshot;
  children: RowSnapshot[];
  principalMinor: number;
  interestMinor: number;
  calculatedInterestMinor: number;
  /** The loan-side row Actual made for the transfer part, when visible (an edit changes it too, T314). */
  counterpart?: RowSnapshot | null;
};

/** The user's change to a split already in Actual (T314): what Actual had, what Bench calculated, what was entered, and why. */
export type RecordedSplitEdit = { actualInterestMinor: number; calculatedInterestMinor: number; interestMinor: number; reason: string | null };

/**
 * A payment that clears the loan: the principal still owed and the interest accrued up to the day it
 * was paid, and anything paid beyond that (a payoff fee, or a difference within the tolerance).
 */
export type PayoffFigures = { paidDate: string; owedPrincipalMinor: number; interestMinor: number; excessMinor: number };

export type SplitOverride = { calculatedInterestMinor: number; interestMinor: number; reason: string | null };

export { OVERRIDE_NO_REASON_MINOR } from "../overrides";

export type ClosingState = {
  date: string;
  principalMinor: number;
  accruedInterestMinor: number;
  carriedRemainder: string | null;
};

export type PostingOutputSnapshot =
  | {
      format: typeof POSTING_OUTPUT_FORMAT;
      version: typeof POSTING_OUTPUT_FORMAT_VERSION;
      kind: "create";
      operations: CreateOperation[];
      accountBudgetStatus: Record<string, "on-budget" | "off-budget">;
      components: ComponentLine[];
      closing: ClosingState | null;
    }
  | {
      format: typeof POSTING_OUTPUT_FORMAT;
      version: typeof POSTING_OUTPUT_FORMAT_VERSION;
      kind: "restructure";
      before: RowSnapshot;
      operations: ChildSpec[];
      expectedPostState: ExpectedPostState;
      accountBudgetStatus: Record<string, "on-budget" | "off-budget">;
      components: ComponentLine[];
      closing: ClosingState | null;
      /**
       * Restructuring an existing transfer (T279): its untouched Actual-made
       * counterpart, which Actual deletes when the payment becomes a split and
       * re-creates (with a new id) when the split is undone.
       */
      replacesCounterpart?: RowSnapshot | null;
      /** The user's edit of the interest line (T291): what Bench calculated, what was entered, and why. */
      override?: SplitOverride | null;
      /** This payment pays the loan off (owner decision 2026-10-07): applied, the loan shows as paid off. */
      payoff?: PayoffFigures | null;
    }
  | {
      format: typeof POSTING_OUTPUT_FORMAT;
      version: typeof POSTING_OUTPUT_FORMAT_VERSION;
      /**
       * Undo of a restructure (T276): delete the split lines one at a time, so
       * the parent becomes the original row again and Actual removes the
       * counterparts it made; then restore the parent's own fields.
       */
      kind: "restore-split";
      /** The applied split as it must still be. */
      parent: RowSnapshot;
      children: RowSnapshot[];
      counterpartAccountIds: string[];
      restoreTo: RowSnapshot;
      /** A transfer restructure: the counterpart Actual re-creates, by its original contents. */
      recreatedCounterpart: RowSnapshot | null;
      closing: null;
    }
  | {
      format: typeof POSTING_OUTPUT_FORMAT;
      version: typeof POSTING_OUTPUT_FORMAT_VERSION;
      /** Undo of a counterpart link (T276): detach the counterpart, then restore the source. */
      kind: "unlink";
      /** The pair as Bench linked it, as it must still be. */
      source: RowSnapshot;
      counterpart: RowSnapshot;
      sourceRestore: RowSnapshot;
      counterpartRestore: RowSnapshot;
      closing: null;
    }
  | {
      format: typeof POSTING_OUTPUT_FORMAT;
      version: typeof POSTING_OUTPUT_FORMAT_VERSION;
      /** An existing payment becomes the loan transfer by its payee; Actual creates the one counterpart (T277). */
      kind: "convert";
      before: RowSnapshot;
      transferPayeeId: string;
      transferAccountId: string;
      expectedCounterpart: { accountId: string; amountMinor: number; notes: string | null };
      accountBudgetStatus: Record<string, "on-budget" | "off-budget">;
      closing: ClosingState | null;
    }
  | {
      format: typeof POSTING_OUTPUT_FORMAT;
      version: typeof POSTING_OUTPUT_FORMAT_VERSION;
      /** Undo of a conversion (T277): the payment's own payee back; Actual deletes the counterpart it made. */
      kind: "revert-convert";
      converted: RowSnapshot;
      counterpart: RowSnapshot;
      restoreTo: RowSnapshot;
      closing: null;
    }
  | {
      format: typeof POSTING_OUTPUT_FORMAT;
      version: typeof POSTING_OUTPUT_FORMAT_VERSION;
      /**
       * Writes nothing to Actual: records Bench's link to rows that already
       * represent the movement (an existing complete transfer, the lender's own
       * charge). Added to the instruction's three shapes to carry the shipped
       * P1.4 "existing full transfer" rule; `release` undoes such a claim.
       */
      kind: "claim";
      rows: RowSnapshot[];
      role: "repayment" | "lender-interest-charge" | "lender-repayment-row";
      release?: { postingId: string };
      closing: ClosingState | null;
      /**
       * A repayment already split in Actual, recorded as it is (owner decision 2026-10-06): the
       * split, the parts Actual holds, and Bench's calculated interest for comparison.
       */
      recordedSplit?: RecordedSplit;
    }
  | {
      format: typeof POSTING_OUTPUT_FORMAT;
      version: typeof POSTING_OUTPUT_FORMAT_VERSION;
      /**
       * A repayment already split in Actual whose amounts the user changed (T314): Bench rewrites
       * the split's amounts in place, in one update that keeps every id; Actual moves the
       * loan-side row with the principal. Its undo is the same change back (`edit` null).
       */
      kind: "adjust-split";
      /** The split as it must still be, and the loan-side row Actual made for its transfer part. */
      parent: RowSnapshot;
      children: RowSnapshot[];
      counterpart: RowSnapshot | null;
      /** Every child's new amount, by id, in Actual's signs. */
      amounts: Array<{ id: string; amountMinor: number }>;
      /** The split as it will be once applied. */
      recordedSplit: RecordedSplit;
      edit: RecordedSplitEdit | null;
      closing: ClosingState | null;
    }
  | {
      format: typeof POSTING_OUTPUT_FORMAT;
      version: typeof POSTING_OUTPUT_FORMAT_VERSION;
      kind: "link";
      sourceBefore: RowSnapshot;
      counterpartBefore: RowSnapshot;
      /** The transfer payee of the counterpart's account, written onto the source row. */
      transferPayeeId: string;
      expectedPairState: {
        sourceTransferId: string;
        counterpartTransferId: string;
        counterpartAmountMinor: number;
      };
      closing: ClosingState | null;
    };

export type PostingOpening = {
  date: string;
  principalMinor: number;
  accruedInterestMinor: number;
  carriedRemainder: string | null;
  source: { kind: "anchor"; anchorId: string } | { kind: "contract-opening" } | { kind: "posting"; postingId: string };
};

export type PostingInputSnapshot = {
  format: typeof POSTING_INPUT_FORMAT;
  version: 1 | typeof POSTING_INPUT_FORMAT_VERSION;
  subject: { kind: "debt"; id: string; configRevision: number; configHash: string };
  period: { key: string; from: string; to: string; chargeDates: string[] };
  opening: PostingOpening;
  /**
   * Offset balance steps the projection consumed (date → balance), one series
   * per Actual-linked offset account, from the opening to the period end.
   * Balance steps, never transactions.
   */
  offsets: { accountId: string; asOfDate: string; steps: { date: string; totalBalanceMinor: number; clearedBalanceMinor: number }[] }[];
  /** Ids and preflight fields of the rows matched or targeted. */
  matched: RowSnapshot[];
  /** Plan parameters that change the output: categories the user chose, the adjustment basis. */
  parameters: Record<string, string | number | boolean | null>;
  observation?: { kind: "debt"; id: string; canonicalHash: string };
  /**
   * v2, repayment splits only: every repayment from the opening to this one,
   * with its due date, actual date and amount, and how the lender allocates
   * interest. The split is allocated from these, so reproduction needs
   * nothing else. `assumed` marks a repayment not seen in Actual, taken as
   * paid on its due date for the scheduled amount.
   */
  observedRepayments?: {
    allocation: InterestAllocation;
    repayments: (ObservedRepayment & { assumed?: boolean })[];
  };
};

export class InexactMoneyError extends RangeError {
  constructor(path: string, value: unknown) {
    super(`${path}: money must be an integer number of minor units (got ${String(value)})`);
    this.name = "InexactMoneyError";
  }
}

/**
 * Refuse any non-safe-integer number anywhere in a snapshot. Every number in a
 * posting document is an amount in minor units, a count or a version, so a
 * fraction can only mean floating-point money slipped in.
 */
export function assertExactMoney(value: unknown, path = "$"): void {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new InexactMoneyError(path, value);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertExactMoney(item, `${path}[${index}]`));
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) assertExactMoney(item, `${path}.${key}`);
  }
}

export function toRowSnapshot(row: {
  id: string;
  accountId: string;
  date: string;
  amount: number;
  payeeId: string | null;
  payeeName: string | null;
  categoryId: string | null;
  notes: string | null;
  cleared?: boolean;
  reconciled?: boolean;
  importedId?: string | null;
  importedPayee?: string | null;
  transferId?: string | null;
  isParent?: boolean;
  isChild?: boolean;
  parentId?: string | null;
  childCount?: number;
}): RowSnapshot {
  return {
    id: row.id,
    accountId: row.accountId,
    date: row.date,
    amountMinor: row.amount,
    payeeId: row.payeeId,
    payeeName: row.payeeName,
    categoryId: row.categoryId,
    notes: row.notes,
    cleared: row.cleared === true,
    reconciled: row.reconciled === true,
    importedId: row.importedId ?? null,
    importedPayee: row.importedPayee ?? null,
    transferId: row.transferId ?? null,
    isParent: row.isParent === true,
    isChild: row.isChild === true,
    parentId: row.parentId ?? null,
    childCount: row.childCount ?? 0,
  };
}

/** The fields preflight compares (FR-162): a change to any of them since preview refuses the apply. */
export const PREFLIGHT_FIELDS = ["accountId", "date", "amountMinor", "payeeId", "categoryId", "notes", "reconciled", "transferId", "isParent", "isChild", "parentId", "childCount"] as const;

export type PreflightDifference = { rowId: string; field: (typeof PREFLIGHT_FIELDS)[number] | "missing"; before: unknown; now: unknown };

export function compareRowToSnapshot(before: RowSnapshot, now: RowSnapshot | null): PreflightDifference[] {
  if (!now) return [{ rowId: before.id, field: "missing", before: before.id, now: null }];
  return PREFLIGHT_FIELDS.filter((field) => before[field] !== now[field]).map((field) => ({ rowId: before.id, field, before: before[field], now: now[field] }));
}

// ── The shared period calculation ───────────────────────────────────────────

export type PeriodCalculation =
  | { ok: true; events: DebtProjectionEvent[]; engineVersions: Record<string, string>; closing: ClosingState }
  | { ok: false; message: string };

export function openingToAnchor(opening: PostingOpening): Anchor {
  return {
    date: opening.date,
    principalMinor: opening.principalMinor,
    accruedInterestMinor: opening.accruedInterestMinor,
    carriedRemainder: opening.carriedRemainder,
    source: opening.source.kind,
  };
}

/**
 * One period's engine result, from the stored model, the recorded opening and
 * the recorded offset steps. Planning and reproduction both call exactly this,
 * so a reproduction compares like with like and never reads Actual.
 */
export function calculatePeriod(input: {
  model: LoanModelSnapshot;
  opening: PostingOpening;
  offsets: PostingInputSnapshot["offsets"];
  from: string;
  to: string;
}): PeriodCalculation {
  const histories: OffsetHistorySnapshot[] = input.offsets.map((o) => ({ accountId: o.accountId, asOfDate: o.asOfDate, transactionCount: 0, points: o.steps }));
  const merged = histories.length ? mergeOffsetHistories(input.model, histories) : { model: input.model, events: [] };
  const projection = projectDebt({
    model: merged.model,
    anchor: openingToAnchor(input.opening),
    events: merged.events,
    from: input.from,
    to: input.to,
    resolution: "events",
  });
  if (!projection.ok) return { ok: false, message: projection.blocked.map((b) => b.message).join(" ") };
  const events = projection.events.filter((e) => e.date >= input.from && e.date <= input.to);
  const last = projection.events.filter((e) => e.date <= input.to).at(-1);
  const engineVersions: Record<string, string> = {};
  for (const event of events) Object.assign(engineVersions, event.engineVersions);
  return {
    ok: true,
    events,
    engineVersions,
    closing: {
      date: input.to,
      principalMinor: last?.balanceAfterMinor ?? input.opening.principalMinor,
      accruedInterestMinor: 0,
      carriedRemainder: null,
    },
  };
}

/**
 * The interest and fee split of the last observed repayment, allocated on
 * actual dates from the recorded opening (RD-084 P1.6 T284). Planning and
 * reproduction both call exactly this.
 */
export function allocateRepaymentSplit(input: {
  model: LoanModelSnapshot;
  opening: PostingOpening;
  observed: NonNullable<PostingInputSnapshot["observedRepayments"]>;
}): { ok: true; row: AllocatedRepayment; engineVersions: Record<string, string> } | { ok: false; message: string } {
  const result = allocateObservedRepayments({
    model: input.model,
    opening: { date: input.opening.date, principalMinor: input.opening.principalMinor, accruedInterestMinor: input.opening.accruedInterestMinor },
    repayments: input.observed.repayments.map(({ dueDate, paidDate, amountMinor, feesMinor, appliedInterestMinor }) => ({ dueDate, paidDate, amountMinor, feesMinor, appliedInterestMinor })),
    allocation: input.observed.allocation,
  });
  if (!result.ok) return result;
  const row = result.rows.at(-1);
  if (!row) return { ok: false, message: "No repayment to allocate." };
  return { ok: true, row, engineVersions: result.engineVersions };
}

/** Every row and split child of a bounded read, as preflight snapshots by id. */
export function indexReadRows(transactions: readonly import("@/lib/actual/transport").SyncSourceTransaction[]): Map<string, RowSnapshot> {
  const out = new Map<string, RowSnapshot>();
  for (const row of transactions) {
    out.set(row.id, toRowSnapshot({ ...row, childCount: row.splitLines.length }));
    for (const line of row.splitLines) {
      if (!line.id) continue;
      out.set(line.id, toRowSnapshot({
        id: line.id, accountId: row.accountId, date: row.date, amount: line.amount, payeeId: line.payeeId, payeeName: line.payeeName,
        categoryId: line.categoryId, notes: line.notes, cleared: line.cleared ?? row.cleared, reconciled: line.reconciled ?? row.reconciled,
        importedId: line.importedId ?? null, importedPayee: line.importedPayee ?? null, transferId: line.transferId ?? null,
        isParent: false, isChild: true, parentId: line.parentId ?? row.id, childCount: 0,
      }));
    }
  }
  return out;
}

/** A stored row snapshot as the full state an exact restoration compares. */
export function toRowState(row: RowSnapshot): import("@/lib/actual/transactionStructure").RowState {
  return { ...toTransactionPreflight(row), cleared: row.cleared, importedId: row.importedId, importedPayee: row.importedPayee };
}

/** The preflight fields in transport terms, from a stored row snapshot. */
export function toTransactionPreflight(row: RowSnapshot): import("@/lib/actual/transactionStructure").TransactionPreflight {
  return {
    id: row.id, accountId: row.accountId, date: row.date, amount: row.amountMinor, payeeId: row.payeeId, categoryId: row.categoryId,
    notes: row.notes, reconciled: row.reconciled, transferId: row.transferId, isParent: row.isParent, isChild: row.isChild,
    parentId: row.parentId, childCount: row.childCount,
  };
}
