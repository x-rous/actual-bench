import { AppDbValidationError } from "@/lib/app-db/errors";
import type { AssumptionInput } from "@/lib/app-db/debtAssumptionRepository";
import { insertDebtTransactionLink, listDebtTransactionLinks } from "@/lib/app-db/debtTransactionLinkRepository";
import { listSubjectPostings } from "@/lib/app-db/financialPostingRepository";
import type { DebtAssumptionRecord, SqliteDatabase } from "@/lib/app-db/types";
import { getDebtDetail, saveBaselineAssumptions, type DebtDetail } from "./debtConfigService";
import type { RowSnapshot } from "./snapshot";

/**
 * Extra payments found in Actual (owner decision 2026-10-05). A payment into the loan account that
 * no scheduled repayment or proposed or applied change accounts for is listed on the Repayments
 * tab; the user can record it as an extra payment, which links the Actual transaction to the loan
 * (so matching never takes it for a repayment) and adds the extra payment to Terms & Schedule with
 * the transaction's own date and amount. Nothing is written to Actual.
 */

export type UnscheduledPayment = {
  id: string;
  date: string;
  /** Debt reduced (or, for money taken out, added), as a positive amount. */
  amountMinor: number;
  /**
   * "in": money paid into the loan (an extra payment to record). "out": money taken out of the loan
   * account, which adds to what is owed and nothing in the schedule explains (owner decision
   * 2026-10-07): often a transfer entered the wrong way round.
   */
  direction?: "in" | "out";
  payeeName: string | null;
  notes: string | null;
  /** Linked to this loan as an extra payment. */
  recorded: boolean;
  /** Terms & Schedule has an extra payment with this date and amount. */
  inSchedule: boolean;
  /**
   * The extra payment recorded with this transaction, as Terms & Schedule still has it. When the
   * transaction's date or amount was later changed in Actual, it differs from `date`/`amountMinor`.
   */
  recordedAs: { date: string; amountMinor: number } | null;
  /** Recorded, and the transaction has since been changed in Actual. */
  changed: boolean;
};

const ROLE = "extra-repayment";
const NOTE = "Extra payment recorded from Actual";
const LIVE = new Set(["proposed", "approved", "applying", "applied", "indeterminate", "failed"]);

function extraInSchedule(assumptions: readonly DebtAssumptionRecord[], date: string, amountMinor: number): DebtAssumptionRecord | null {
  return assumptions.find((a) => a.assumptionKind === "extra-repayment" && a.effectiveFrom === date && a.amountMinor === amountMinor && a.recurrence === null) ?? null;
}

/** The Terms & Schedule event recorded with a link: same date as the link, made by this feature. */
function recordedEvent(assumptions: readonly DebtAssumptionRecord[], periodKey: string | null): DebtAssumptionRecord | null {
  return assumptions.find((a) => a.assumptionKind === "extra-repayment" && a.effectiveFrom === periodKey && a.note === NOTE && a.recurrence === null) ?? null;
}

/** Every row id a live posting names, in its output or as what it wrote. */
function claimedByPostings(db: SqliteDatabase, debtId: string): Set<string> {
  const ids = new Set<string>();
  for (const posting of listSubjectPostings(db, "debt", debtId)) {
    if (!LIVE.has(String(posting.status))) continue;
    // The rows themselves and the other side of any transfer among them (a split's principal part
    // lands in the loan account as its own row).
    for (const match of posting.outputSnapshotJson.matchAll(/"(?:id|transferId)":"([^"]+)"/g)) ids.add(match[1]);
    for (const id of posting.actualIds ?? []) ids.add(id);
  }
  return ids;
}

export function unscheduledPayments(
  db: SqliteDatabase,
  detail: DebtDetail,
  rows: ReadonlyMap<string, RowSnapshot>,
  window: { from: string; to: string },
  options: { lenderFeed: boolean },
): UnscheduledPayment[] {
  const liability = detail.debt.liabilityAccountId;
  if (!liability) return [];
  const negativeIsDebt = detail.debt.signConvention !== "positive-is-debt";
  const claimed = claimedByPostings(db, detail.debt.id);
  const links = new Map(listDebtTransactionLinks(db, detail.debt.id).filter((l) => l.role === ROLE).map((l) => [l.actualTransactionId, l]));
  const recorded = new Set(links.keys());
  const opening = detail.config.ok ? detail.config.config.terms.openingDate : "0000-01-01";
  const out: UnscheduledPayment[] = [];
  for (const row of rows.values()) {
    // A recorded payment is listed wherever it is now, so a date moved in Actual is still seen.
    const outside = row.date < window.from || row.date > window.to;
    if (row.accountId !== liability || row.isChild || row.date < opening || (outside && !recorded.has(row.id))) continue;
    const reduces = negativeIsDebt ? row.amountMinor > 0 : row.amountMinor < 0;
    if (row.importedId?.startsWith("abdebt:")) continue;
    if (!reduces) {
      // Money taken out of the loan account: listed when nothing explains it. The loan's own opening
      // money, a draw in Terms & Schedule, and the lender's own charges on a loan that records
      // interest as its own transaction are expected.
      const amountOut = Math.abs(row.amountMinor);
      const drawn = detail.assumptions.some((a) => a.assumptionKind === "draw" && a.effectiveFrom === row.date && a.amountMinor === amountOut);
      const lenderCharge = detail.debt.lenderPattern === "separate-interest" && !row.transferId;
      if (row.date <= opening || drawn || lenderCharge || claimed.has(row.id) || outside) continue;
      out.push({ id: row.id, date: row.date, amountMinor: amountOut, payeeName: row.payeeName, notes: row.notes, recorded: false, inSchedule: false, recordedAs: null, changed: false, direction: "out" });
      continue;
    }
    // With a lender feed, the lender's own imported repayment rows are handled by lender links.
    if (options.lenderFeed && row.importedId && !recorded.has(row.id)) continue;
    if (claimed.has(row.id) && !recorded.has(row.id)) continue;
    const amountMinor = Math.abs(row.amountMinor);
    const link = links.get(row.id);
    const event = link ? recordedEvent(detail.assumptions, link.periodKey) : null;
    const recordedAs = event ? { date: event.effectiveFrom, amountMinor: event.amountMinor ?? 0 } : null;
    const inSchedule = extraInSchedule(detail.assumptions, row.date, amountMinor) !== null;
    out.push({ id: row.id, date: row.date, amountMinor, payeeName: row.payeeName, notes: row.notes, recorded: !!link, inSchedule, recordedAs, changed: !!recordedAs && !inSchedule && (recordedAs.date !== row.date || recordedAs.amountMinor !== amountMinor), direction: "in" });
  }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

const toInput = (a: DebtAssumptionRecord): AssumptionInput => ({
  id: a.id,
  kind: a.assumptionKind as AssumptionInput["kind"],
  effectiveFrom: a.effectiveFrom,
  recurrence: a.recurrence && !("unknown" in a.recurrence) ? a.recurrence : null,
  amountMinor: a.amountMinor ?? 0,
  feeTreatment: (a.feeTreatment as AssumptionInput["feeTreatment"]) ?? null,
  offsetAccountId: a.offsetAccountId,
  note: a.note,
});

/**
 * Link the Actual transaction as this loan's extra payment and add it to Terms & Schedule (a new
 * revision). When it is already recorded and its date or amount has since changed in Actual, the
 * extra payment recorded with it is moved to the transaction's current date and amount instead of
 * being added a second time.
 */
export function recordExtraPayment(db: SqliteDatabase, debtId: string, input: { actualTransactionId: string; date: string; amountMinor: number }): DebtDetail {
  const detail = getDebtDetail(db, debtId);
  if (!detail) throw new AppDbValidationError("Debt not found");
  if (detail.blocked) throw new AppDbValidationError(detail.blocked.message);
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) throw new AppDbValidationError("The extra payment must be a positive amount");
  if (detail.assumptions.some((a) => typeof a.recurrence === "object" && a.recurrence !== null && "unknown" in a.recurrence)) {
    throw new AppDbValidationError("This loan has an event saved by a newer version of Actual Bench; add the extra payment in Terms & Schedule instead");
  }
  db.transaction(() => {
    const link = listDebtTransactionLinks(db, debtId).find((l) => l.role === ROLE && l.actualTransactionId === input.actualTransactionId);
    if (!link) insertDebtTransactionLink(db, { debtId, budgetSyncId: detail.debt.budgetSyncId, actualTransactionId: input.actualTransactionId, role: ROLE, periodKey: input.date, linkSource: "user" });
    else if (link.periodKey !== input.date) db.prepare("UPDATE debt_transaction_links SET period_key = ? WHERE id = ?").run(input.date, link.id);
    if (extraInSchedule(detail.assumptions, input.date, input.amountMinor)) return;
    const previous = link ? recordedEvent(detail.assumptions, link.periodKey) : null;
    const kept = detail.assumptions.filter((a) => a.id !== previous?.id).map(toInput);
    const label = previous ? "Extra payment changed in Actual" : NOTE;
    saveBaselineAssumptions(db, debtId, [...kept, { kind: "extra-repayment", effectiveFrom: input.date, recurrence: null, amountMinor: input.amountMinor, feeTreatment: null, offsetAccountId: null, note: NOTE }], label);
  })();
  return getDebtDetail(db, debtId)!;
}

export type FollowedExtraPayment =
  | { transactionId: string; change: "moved"; from: { date: string; amountMinor: number }; to: { date: string; amountMinor: number } }
  | { transactionId: string; change: "removed"; from: { date: string; amountMinor: number } };

/**
 * Keep recorded extra payments in step with their Actual transactions (owner decisions
 * 2026-10-06): the transaction is linked, so the extra payment in Terms & Schedule follows it
 * automatically (each change a new revision), before anything is planned. A changed date or amount
 * moves it; a transaction deleted in Actual removes it with its link. Deletion is decided only
 * from `loanAccountRows`, the loan account's complete history: a row merely outside the rows read
 * is not evidence that it is gone.
 */
export function followRecordedExtraPayments(
  db: SqliteDatabase,
  debtId: string,
  rows: ReadonlyMap<string, RowSnapshot>,
  loanAccountRows: ReadonlyArray<{ id: string; date: string; amountMinor: number }> | null,
): FollowedExtraPayment[] {
  const detail = getDebtDetail(db, debtId);
  const liability = detail?.debt.liabilityAccountId;
  if (!detail || detail.blocked || !liability) return [];
  const complete = loanAccountRows ? new Map(loanAccountRows.map((r) => [r.id, r])) : null;
  const followed: FollowedExtraPayment[] = [];
  for (const link of listDebtTransactionLinks(db, debtId).filter((l) => l.role === ROLE)) {
    const event = recordedEvent(getDebtDetail(db, debtId)!.assumptions, link.periodKey);
    const from = event ? { date: event.effectiveFrom, amountMinor: event.amountMinor ?? 0 } : null;
    const read = rows.get(link.actualTransactionId);
    const now = complete ? complete.get(link.actualTransactionId) ?? null : read && read.accountId === liability && !read.isChild ? read : null;
    try {
      if (!now) {
        if (!complete) continue;
        removeExtraPayment(db, debtId, link.actualTransactionId);
        if (from) followed.push({ transactionId: link.actualTransactionId, change: "removed", from });
        continue;
      }
      const amountMinor = Math.abs(now.amountMinor);
      if (!from || amountMinor === 0 || (from.date === now.date && from.amountMinor === amountMinor)) continue;
      recordExtraPayment(db, debtId, { actualTransactionId: link.actualTransactionId, date: now.date, amountMinor });
      followed.push({ transactionId: link.actualTransactionId, change: "moved", from, to: { date: now.date, amountMinor } });
    } catch (error) {
      // A loan Bench cannot save (for example an event from a newer version) keeps the old extra
      // payment; the Sync Repayments tab still shows it as changed in Actual.
      if (!(error instanceof AppDbValidationError)) throw error;
    }
  }
  return followed;
}

/** Undo: unlink the transaction and take the matching extra payment out of Terms & Schedule. */
export function removeExtraPayment(db: SqliteDatabase, debtId: string, actualTransactionId: string): DebtDetail {
  const detail = getDebtDetail(db, debtId);
  if (!detail) throw new AppDbValidationError("Debt not found");
  const link = listDebtTransactionLinks(db, debtId).find((l) => l.role === ROLE && l.actualTransactionId === actualTransactionId);
  if (!link) throw new AppDbValidationError("That transaction is not recorded as an extra payment of this loan");
  db.transaction(() => {
    db.prepare("DELETE FROM debt_transaction_links WHERE id = ?").run(link.id);
    const event = recordedEvent(detail.assumptions, link.periodKey);
    if (event) saveBaselineAssumptions(db, debtId, detail.assumptions.filter((a) => a.id !== event.id).map(toInput), "Extra payment from Actual removed");
  })();
  return getDebtDetail(db, debtId)!;
}
