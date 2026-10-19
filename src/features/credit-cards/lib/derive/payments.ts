import { addDays, addMonths, parseIsoDate } from "@/lib/financial-models/calendar/dates";
import type { ActivityRow, ActivitySnapshot } from "../activity";
import type { Card, Statement, Workspace } from "../models";
import { sumMinor } from "../statements";
import { familyOf, isCreditKind } from "./families";
import { decisionsFor, planForTransaction } from "./indexes";
import { ownerOf, peerOf } from "./planAccounts";
import { activityKind } from "./types";

/**
 * Rule P (§7.2): which statement a payment pays. One allocation feeds Paid, Pending, Left to
 * pay, Minimum left, Unpaid at due date, the Payments rows, the timeline and every badge.
 *
 * Statement balances are cumulative, so a payment counts toward every saved statement whose
 * window contains its effective date: `closing < effective ≤ max(due, next close)`. When a long
 * grace period makes two windows overlap, the later bill (whose balance includes the earlier
 * one) and the earlier bill both see the payment.
 */
export type StatementPayment = {
  statementId: string;
  dueDate: string;
  /** Last effective date that pays this statement. */
  windowEnd: string;
  /** Saved statement with complete activity through min(today, window end). */
  known: boolean;
  /** Entered amount due, else max(0, statement balance) (D2). */
  amountDueMinor: number;
  /** Cleared payments minus cleared reversals. */
  paidMinor: number;
  /** Uncleared payments minus uncleared reversals; never inside `paidMinor`. */
  pendingMinor: number;
  /** Cleared refunds, cashback and waivers in the window; never counted as paid (D14). */
  creditsMinor: number;
  pendingCreditsMinor: number;
  /** Cleared plan conversions in the window: the bank moved that part of the bill into an instalment plan. */
  convertedMinor: number;
  /** max(0, amount due − paid − converted); null while unknown. */
  leftToPayMinor: number | null;
  /** max(0, minimum − paid); null while unknown. */
  minimumLeftMinor: number | null;
  /** max(0, balance − cleared payments by due − cleared credits by due); null before due or while unclear. */
  unpaidAtDueMinor: number | null;
  /** Date cleared payments and conversions first reached the amount due. */
  paidDate: string | null;
  /** Date cleared payments first reached the minimum (null when the minimum is 0). */
  minimumPaidDate: string | null;
  /** An uncleared payment dated on or before the due date. */
  pendingByDue: boolean;
  /** Payment and reversal rows in this window, with effective dates. */
  rows: { row: ActivityRow; date: string }[];
  /** Plan conversion rows in this window, with effective dates. */
  conversions: { row: ActivityRow; date: string }[];
};

type Event = { row: ActivityRow; date: string; kind: "payment" | "credit" | "conversion"; planStart?: string | null };

/** The start of the plan a conversion belongs to (linked, or owned through its plan account), when known. */
function planStartOf(row: ActivityRow, workspace: Workspace, snapshot: ActivitySnapshot) {
  const linked = planForTransaction(workspace, row.id);
  if (linked) return linked.startDate;
  const peer = peerOf(row, snapshot);
  return (peer && ownerOf(peer, workspace.plans, snapshot)?.startDate) ?? null;
}

/**
 * Effective date (§7.2 step 1): the bank posting date saved in any decision for the row,
 * otherwise Actual's date. A row excluded from statement N and dated on or before N's close
 * is effective the day after N's close; a row included on N after N's close is effective on it.
 */
export function effectiveDate(row: ActivityRow, cardId: string, workspace: Pick<Workspace, "decisions">, statements: readonly Statement[]) {
  const decisions = decisionsFor(workspace.decisions, cardId, row.id).filter((entry) => entry.sourceHash === row.fingerprint);
  const postings = [...new Set(decisions.flatMap((entry) => (entry.bankPostingDate ? [entry.bankPostingDate] : [])))];
  let date = postings.length === 1 ? postings[0] : row.date;
  for (const decision of decisions) {
    const statement = statements.find((entry) => entry.id === decision.statementId);
    if (!statement) continue;
    if (decision.decision === "excluded" && date <= statement.closingDate) date = addDays(statement.closingDate, 1);
    if (decision.decision === "included" && date > statement.closingDate) date = statement.closingDate;
  }
  return date;
}

/**
 * Payments (including reversals), credits and plan conversions on the card, with effective dates.
 * A conversion is the bank moving billed charges into an instalment plan: it settles that part of the
 * bill but is never a payment, so it never counts toward the minimum.
 */
function events(card: Card, workspace: Workspace, snapshot: ActivitySnapshot, statements: readonly Statement[], today: string) {
  const result: Event[] = [];
  for (const row of snapshot.rows) {
    const kind = activityKind(row, card, workspace, snapshot);
    const isPayment = familyOf(kind) === "payment";
    const isConversion = familyOf(kind) === "plan" && row.amountMinor > 0;
    if (!isPayment && !isConversion && !isCreditKind(kind, row.amountMinor)) continue;
    const date = effectiveDate(row, card.id, workspace, statements);
    if (date > today) continue;
    result.push(isConversion
      ? { row, date, kind: "conversion", planStart: planStartOf(row, workspace, snapshot) }
      : { row, date, kind: isPayment ? "payment" : "credit" });
  }
  return result.sort((a, b) => a.date.localeCompare(b.date) || a.row.id.localeCompare(b.row.id));
}

/** The next close after a statement: the next saved or estimated one, else the card's rule. */
function nextClose(card: Card, statement: Statement, ordered: readonly Statement[]) {
  const next = ordered.find((entry) => entry.closingDate > statement.closingDate);
  if (next) return next.closingDate;
  const day = card.closingDay ?? parseIsoDate(statement.closingDate).day;
  return addMonths(statement.closingDate, 1, day);
}

const cache = new WeakMap<Workspace, WeakMap<ActivitySnapshot, WeakMap<Card, Map<string, StatementPayment[]>>>>();

/** One `StatementPayment` per statement of the card (saved and estimated), cached per data state. */
export function statementPayments(card: Card, workspace: Workspace, snapshot: ActivitySnapshot, today: string): StatementPayment[] {
  let bySnapshot = cache.get(workspace);
  if (!bySnapshot) {
    bySnapshot = new WeakMap();
    cache.set(workspace, bySnapshot);
  }
  let byCard = bySnapshot.get(snapshot);
  if (!byCard) {
    byCard = new WeakMap();
    bySnapshot.set(snapshot, byCard);
  }
  let byDate = byCard.get(card);
  if (!byDate) {
    byDate = new Map();
    byCard.set(card, byDate);
  }
  let result = byDate.get(today);
  if (!result) {
    result = calculate(card, workspace, snapshot, today);
    byDate.set(today, result);
  }
  return result;
}

function calculate(card: Card, workspace: Workspace, snapshot: ActivitySnapshot, today: string): StatementPayment[] {
  const ordered = workspace.statements
    .filter((entry) => entry.cardId === card.id)
    .sort((a, b) => a.closingDate.localeCompare(b.closingDate));
  const all = events(card, workspace, snapshot, ordered, today);
  return ordered.map((statement) => {
    const windowEnd = [statement.dueDate, nextClose(card, statement, ordered)].sort().at(-1)!;
    const inWindow = all.filter((event) => event.date > statement.closingDate && event.date <= windowEnd);
    const payments = inWindow.filter((event) => event.kind === "payment");
    const credits = inWindow.filter((event) => event.kind === "credit");
    // A conversion settles this bill only when its plan started on or before the close (the purchase is on it).
    const conversions = inWindow.filter((event) => event.kind === "conversion" && (!event.planStart || event.planStart <= statement.closingDate));
    const total = (list: Event[], cleared: boolean) =>
      sumMinor(list.filter((event) => (event.row.cleared === true) === cleared).map((event) => event.row.amountMinor));
    const paidMinor = total(payments, true);
    const pendingMinor = total(payments, false);
    const creditsMinor = total(credits, true);
    const pendingCreditsMinor = total(credits, false);
    const convertedMinor = total(conversions, true);
    const balance = Math.max(0, statement.balanceMinor);
    const amountDueMinor = statement.amountDueMinor ?? balance;
    const covered = snapshot.from <= statement.closingDate
      && snapshot.to >= (today < windowEnd ? today : windowEnd)
      && !snapshot.issues.length;
    const known = !statement.estimate && covered;
    // Payments and conversions settle the bill; only payments meet the minimum.
    let settled = 0;
    let running = 0;
    let paidDate: string | null = null;
    let minimumPaidDate: string | null = null;
    for (const event of [...payments, ...conversions].sort((a, b) => a.date.localeCompare(b.date) || a.row.id.localeCompare(b.row.id))) {
      if (event.row.cleared !== true) continue;
      settled = sumMinor([settled, event.row.amountMinor]);
      if (amountDueMinor > 0 && paidDate === null && settled >= amountDueMinor) paidDate = event.date;
      if (event.kind !== "payment") continue;
      running = sumMinor([running, event.row.amountMinor]);
      if (statement.minimumDueMinor > 0 && minimumPaidDate === null && running >= statement.minimumDueMinor) minimumPaidDate = event.date;
    }
    const byDue = (list: Event[], cleared: boolean) => total(list.filter((event) => event.date <= statement.dueDate), cleared);
    const pendingByDue = payments.some((event) => event.row.cleared !== true && event.date <= statement.dueDate);
    const dueKnown = known && statement.dueDate < today && !pendingByDue;
    return {
      statementId: statement.id,
      dueDate: statement.dueDate,
      windowEnd,
      known,
      amountDueMinor,
      paidMinor,
      pendingMinor,
      creditsMinor,
      pendingCreditsMinor,
      convertedMinor,
      leftToPayMinor: known ? Math.max(0, amountDueMinor - paidMinor - convertedMinor) : null,
      minimumLeftMinor: known ? Math.max(0, statement.minimumDueMinor - paidMinor) : null,
      unpaidAtDueMinor: dueKnown
        ? Math.max(0, balance - byDue(payments, true) - byDue(credits, true) - byDue(conversions, true))
        : null,
      paidDate: known ? paidDate : null,
      minimumPaidDate: known ? minimumPaidDate : null,
      pendingByDue,
      rows: payments.map((event) => ({ row: event.row, date: event.date })),
      conversions: conversions.map((event) => ({ row: event.row, date: event.date })),
    };
  });
}

/** The statement each payment row pays first: the oldest due window that contains it. */
export function paymentAssignments(card: Card, workspace: Workspace, snapshot: ActivitySnapshot, today: string) {
  const assigned = new Map<string, { statementId: string; date: string }>();
  const byDue = [...statementPayments(card, workspace, snapshot, today)].sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  for (const payment of byDue) {
    for (const { row, date } of payment.rows) if (!assigned.has(row.id)) assigned.set(row.id, { statementId: payment.statementId, date });
  }
  return assigned;
}

/** Every payment and reversal row on the card, with its effective date. */
export function paymentRows(card: Card, workspace: Workspace, snapshot: ActivitySnapshot) {
  const statements = workspace.statements.filter((entry) => entry.cardId === card.id);
  return snapshot.rows
    .filter((row) => familyOf(activityKind(row, card, workspace, snapshot)) === "payment")
    .map((row) => ({ row, date: effectiveDate(row, card.id, workspace, statements) }));
}

