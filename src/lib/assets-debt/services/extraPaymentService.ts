import { AppDbValidationError } from "@/lib/app-db/errors";
import type { AssumptionInput } from "@/lib/app-db/debtAssumptionRepository";
import { insertDebtTransactionLink, listDebtTransactionLinks } from "@/lib/app-db/debtTransactionLinkRepository";
import { listSubjectPostings } from "@/lib/app-db/financialPostingRepository";
import type { DebtAssumptionRecord, SqliteDatabase } from "@/lib/app-db/types";
import { getDebtDetail, saveBaselineAssumptions, type DebtDetail } from "./debtConfigService";
import { projectStoredDebt } from "./projectionService";
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
  /** The user said it is not an extra payment: not counted, and not recorded automatically. */
  dismissed?: boolean;
  /** At least what the loan owed that day: it pays the loan off, so it is never an extra payment. */
  paysOff?: boolean;
};

const ROLE = "extra-repayment";
const NOT_EXTRA = "not-extra";
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

/**
 * Prove the principal transfer belongs to an embedded-interest repayment from Actual's structure,
 * independently of matching rules, markers or whether Bench has a posting for it. Require the
 * whole split and a reciprocal, equal-and-opposite loan-side row before repairing stored events.
 */
export function splitRepaymentCounterparts(detail: DebtDetail, rows: ReadonlyMap<string, RowSnapshot>): Set<string> {
  const ids = new Set<string>();
  const liability = detail.debt.liabilityAccountId;
  if (!liability || detail.debt.lenderPattern !== "embedded-interest" || !detail.config.ok) return ids;
  const interestCategories = new Set(detail.config.config.components.filter((c) => c.economicKind === "interest" && c.destination === "category").map((c) => c.categoryId));
  const childrenByParent = new Map<string, RowSnapshot[]>();
  for (const row of rows.values()) {
    if (!row.isChild || !row.parentId) continue;
    const children = childrenByParent.get(row.parentId) ?? [];
    children.push(row);
    childrenByParent.set(row.parentId, children);
  }
  for (const parent of rows.values()) {
    if (!parent.isParent || parent.accountId === liability) continue;
    const children = childrenByParent.get(parent.id) ?? [];
    if (children.length < 2 || children.length !== parent.childCount
      || children.some((c) => c.accountId !== parent.accountId || c.date !== parent.date || (c.amountMinor !== 0 && Math.sign(c.amountMinor) !== Math.sign(parent.amountMinor)))
      || children.reduce((sum, c) => sum + c.amountMinor, 0) !== parent.amountMinor) continue;
    const transfers = children.filter((c) => c.transferId);
    if (transfers.length !== 1 || !children.some((c) => !c.transferId && c.categoryId && interestCategories.has(c.categoryId))) continue;
    const principal = transfers[0];
    const counterpart = rows.get(principal.transferId!);
    if (!counterpart || counterpart.accountId !== liability || counterpart.isChild || counterpart.isParent
      || counterpart.transferId !== principal.id || counterpart.amountMinor !== -principal.amountMinor || counterpart.date !== principal.date) continue;
    const reduces = detail.debt.signConvention === "positive-is-debt" ? counterpart.amountMinor < 0 : counterpart.amountMinor > 0;
    if (reduces) ids.add(counterpart.id);
  }
  return ids;
}

export function unscheduledPayments(
  db: SqliteDatabase,
  detail: DebtDetail,
  rows: ReadonlyMap<string, RowSnapshot>,
  window: { from: string; to: string },
  options: { lenderFeed: boolean; /** Rows the matching took for the offset-funded part of a repayment. */ offsetParts?: ReadonlySet<string> },
): UnscheduledPayment[] {
  const liability = detail.debt.liabilityAccountId;
  if (!liability) return [];
  const negativeIsDebt = detail.debt.signConvention !== "positive-is-debt";
  const claimed = claimedByPostings(db, detail.debt.id);
  const splitCounterparts = splitRepaymentCounterparts(detail, rows);
  const allLinks = listDebtTransactionLinks(db, detail.debt.id);
  const links = new Map(allLinks.filter((l) => l.role === ROLE).map((l) => [l.actualTransactionId, l]));
  const dismissed = new Set(allLinks.filter((l) => l.role === NOT_EXTRA).map((l) => l.actualTransactionId));
  const recorded = new Set(links.keys());
  const opening = detail.config.ok ? detail.config.config.terms.openingDate : "0000-01-01";
  const out: UnscheduledPayment[] = [];
  for (const row of rows.values()) {
    // A recorded payment is listed wherever it is now, so a date moved in Actual is still seen.
    const outside = row.date < window.from || row.date > window.to;
    if (row.accountId !== liability || row.isChild || row.date < opening || (outside && !recorded.has(row.id))) continue;
    if (splitCounterparts.has(row.id)) continue;
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
    if (options.offsetParts && (options.offsetParts.has(row.id) || (row.transferId && options.offsetParts.has(row.transferId))) && !recorded.has(row.id)) continue;
    const amountMinor = Math.abs(row.amountMinor);
    const link = links.get(row.id);
    const event = link ? recordedEvent(detail.assumptions, link.periodKey) : null;
    const recordedAs = event ? { date: event.effectiveFrom, amountMinor: event.amountMinor ?? 0 } : null;
    const inSchedule = extraInSchedule(detail.assumptions, row.date, amountMinor) !== null;
    out.push({ id: row.id, date: row.date, amountMinor, payeeName: row.payeeName, notes: row.notes, recorded: !!link, inSchedule, recordedAs, changed: !!recordedAs && !inSchedule && (recordedAs.date !== row.date || recordedAs.amountMinor !== amountMinor), direction: "in", ...(dismissed.has(row.id) ? { dismissed: true } : {}) });
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
/**
 * A payment at least the principal still owed is not an extra payment: it pays the loan off, with
 * the interest for the period on top (owner decision 2026-10-07). It is never put in Terms &
 * Schedule (where the calculation would refuse a payment above the balance); the Sync Repayments
 * tab takes it as the payoff instead, with interest to the day it was paid.
 */
export class PaysOffLoanError extends AppDbValidationError {
  constructor(date: string) {
    super(`The payment on ${date} is at least what the loan owed that day, so it pays the loan off: Sync Repayments takes it as the payoff (with the interest to that day), not as an extra payment.`);
    this.name = "PaysOffLoanError";
  }
}

/**
 * Whether the saved schedule now has a payment of at least the balance on this date. Older engine
 * versions refuse it (a credit balance, which leaves the loan with no calculation); newer ones cap
 * it at the balance. Either way it is the payoff, not an extra payment.
 */
function overpaysOn(db: SqliteDatabase, debtId: string, date: string): boolean {
  const projected = projectStoredDebt(db, debtId, { from: date, to: date, resolution: "events" });
  // A loan whose calculation needs Actual's offset history cannot be checked here: left as it was.
  if (!projected.ok) return false;
  if (!projected.projection.ok) return projected.projection.blocked.some((b) => b.code === "credit-balance" && b.date === date);
  return projected.projection.events.some((e) => e.date === date && e.eventType === "extra-repayment" && (e.diagnostics.cappedAtOutstanding === true || e.balanceAfterMinor <= 0));
}

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
    // Rolled back whole (revision and link) when it pays the loan off.
    if (overpaysOn(db, debtId, input.date)) throw new PaysOffLoanError(input.date);
  })();
  return getDebtDetail(db, debtId)!;
}

export type FollowedExtraPayment =
  | { transactionId: string; change: "moved"; from: { date: string; amountMinor: number }; to: { date: string; amountMinor: number } }
  | { transactionId: string; change: "removed"; from: { date: string; amountMinor: number } }
  /** Structurally part of an existing repayment split; corrected in Bench, never changed in Actual. */
  | { transactionId: string; change: "repayment"; from: { date: string; amountMinor: number } }
  /** Changed in Actual to an amount that pays the loan off: taken out of Terms & Schedule, now the payoff. */
  | { transactionId: string; change: "payoff"; from: { date: string; amountMinor: number }; to: { date: string; amountMinor: number } };

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
  const splitCounterparts = splitRepaymentCounterparts(detail, rows);
  const followed: FollowedExtraPayment[] = [];
  for (const link of listDebtTransactionLinks(db, debtId).filter((l) => l.role === ROLE)) {
    const current = getDebtDetail(db, debtId)!;
    // Legacy links identify their generated event by date and note. Never guess which event
    // belongs to which of several links on one day, including when following a changed row.
    const events = current.assumptions.filter((a) => a.assumptionKind === ROLE && a.effectiveFrom === link.periodKey && a.note === NOTE && a.recurrence === null);
    const sameDayLinks = listDebtTransactionLinks(db, debtId).filter((l) => l.role === ROLE && l.periodKey === link.periodKey);
    if (events.length > 1 || (events.length && sameDayLinks.length > 1)) continue;
    const event = recordedEvent(current.assumptions, link.periodKey);
    const from = event ? { date: event.effectiveFrom, amountMinor: event.amountMinor ?? 0 } : null;
    const read = rows.get(link.actualTransactionId);
    const now = complete ? complete.get(link.actualTransactionId) ?? null : read && read.accountId === liability && !read.isChild ? read : null;
    try {
      if (splitCounterparts.has(link.actualTransactionId)) {
        // removeExtraPayment deletes only the generated event; manual events stay untouched.
        removeExtraPayment(db, debtId, link.actualTransactionId, "Principal transfer reclassified as scheduled repayment");
        if (from) followed.push({ transactionId: link.actualTransactionId, change: "repayment", from });
        continue;
      }
      if (!now) {
        if (!complete) continue;
        removeExtraPayment(db, debtId, link.actualTransactionId);
        if (from) followed.push({ transactionId: link.actualTransactionId, change: "removed", from });
        continue;
      }
      const amountMinor = Math.abs(now.amountMinor);
      if (!from || amountMinor === 0) continue;
      if (from.date === now.date && from.amountMinor === amountMinor) {
        // Saved before Bench knew better (or by an older version): one that pays the loan off goes.
        if (overpaysOn(db, debtId, from.date)) {
          removeExtraPayment(db, debtId, link.actualTransactionId);
          followed.push({ transactionId: link.actualTransactionId, change: "payoff", from, to: from });
        }
        continue;
      }
      try {
        recordExtraPayment(db, debtId, { actualTransactionId: link.actualTransactionId, date: now.date, amountMinor });
        followed.push({ transactionId: link.actualTransactionId, change: "moved", from, to: { date: now.date, amountMinor } });
      } catch (error) {
        if (!(error instanceof PaysOffLoanError)) throw error;
        removeExtraPayment(db, debtId, link.actualTransactionId);
        followed.push({ transactionId: link.actualTransactionId, change: "payoff", from, to: { date: now.date, amountMinor } });
      }
    } catch (error) {
      // A loan Bench cannot save (for example an event from a newer version) keeps the old extra
      // payment; the Sync Repayments tab still shows it as changed in Actual.
      if (!(error instanceof AppDbValidationError)) throw error;
    }
  }
  return followed;
}

/**
 * Count payments into the loan automatically (owner decision 2026-10-07): each one listed as not in
 * the schedule, not recorded and not marked "not an extra payment", is recorded as an extra payment
 * (as if the user clicked Record). Returns the ids recorded.
 */
export function recordNewExtraPayments(db: SqliteDatabase, debtId: string, payments: readonly UnscheduledPayment[]): string[] {
  const recorded: string[] = [];
  for (const p of payments) {
    if (p.direction === "out" || p.recorded || p.dismissed || p.amountMinor <= 0) continue;
    try {
      recordExtraPayment(db, debtId, { actualTransactionId: p.id, date: p.date, amountMinor: p.amountMinor });
      recorded.push(p.id);
    } catch (error) {
      if (error instanceof PaysOffLoanError) {
        (p as UnscheduledPayment).paysOff = true;
        continue;
      }
      // A loan Bench cannot save keeps the payment listed for the user to record by hand.
      if (!(error instanceof AppDbValidationError)) throw error;
    }
  }
  return recorded;
}

/** "Not an extra payment": stop counting it (taken out of Terms & Schedule if recorded) and never record it automatically. */
export function dismissExtraPayment(db: SqliteDatabase, debtId: string, actualTransactionId: string, date: string): DebtDetail {
  const detail = getDebtDetail(db, debtId);
  if (!detail) throw new AppDbValidationError("Debt not found");
  if (listDebtTransactionLinks(db, debtId).some((l) => l.role === ROLE && l.actualTransactionId === actualTransactionId)) removeExtraPayment(db, debtId, actualTransactionId);
  if (!listDebtTransactionLinks(db, debtId).some((l) => l.role === NOT_EXTRA && l.actualTransactionId === actualTransactionId)) {
    insertDebtTransactionLink(db, { debtId, budgetSyncId: detail.debt.budgetSyncId, actualTransactionId, role: NOT_EXTRA, periodKey: date, linkSource: "user" });
  }
  return getDebtDetail(db, debtId)!;
}

/** Count it after all: forget "not an extra payment" (the next refresh records it). */
export function undismissExtraPayment(db: SqliteDatabase, debtId: string, actualTransactionId: string): void {
  for (const link of listDebtTransactionLinks(db, debtId)) {
    if (link.role === NOT_EXTRA && link.actualTransactionId === actualTransactionId) db.prepare("DELETE FROM debt_transaction_links WHERE id = ?").run(link.id);
  }
}

/** Undo: unlink the transaction and take the matching extra payment out of Terms & Schedule. */
export function removeExtraPayment(db: SqliteDatabase, debtId: string, actualTransactionId: string, revisionLabel = "Extra payment from Actual removed"): DebtDetail {
  const detail = getDebtDetail(db, debtId);
  if (!detail) throw new AppDbValidationError("Debt not found");
  const link = listDebtTransactionLinks(db, debtId).find((l) => l.role === ROLE && l.actualTransactionId === actualTransactionId);
  if (!link) throw new AppDbValidationError("That transaction is not recorded as an extra payment of this loan");
  db.transaction(() => {
    db.prepare("DELETE FROM debt_transaction_links WHERE id = ?").run(link.id);
    const event = recordedEvent(detail.assumptions, link.periodKey);
    if (event) saveBaselineAssumptions(db, debtId, detail.assumptions.filter((a) => a.id !== event.id).map(toInput), revisionLabel);
  })();
  return getDebtDetail(db, debtId)!;
}
