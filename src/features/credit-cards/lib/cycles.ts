import { addDays, addMonths, dateInMonth, daysBetween, isLastDayOfMonth, parseIsoDate } from "@/lib/financial-models/calendar/dates";
import { revolvingPayment } from "@/lib/financial-models/loan/revolving";
import type { Card, DueRule, Statement, StatementFacts } from "./models";

/** Calendar rules are predictions, with short months clamped by the shared calendar. */
export function cycleDates(card: Pick<Card, "closingDay" | "dueRule">, closingDate: string) {
  const day = card.closingDay ?? parseIsoDate(closingDate).day;
  const periodStart = addDays(addMonths(closingDate, -1, day), 1);
  return { periodStart, closingDate, dueDate: dueDateFor(card.dueRule, closingDate) };
}

/** The due date a rule gives for one closing date; the closing date itself without a rule. */
export function dueDateFor(rule: DueRule | null, closingDate: string) {
  if (rule?.kind === "days-after-close") return addDays(closingDate, rule.value);
  if (rule?.kind === "day-of-month") {
    const { year, month } = parseIsoDate(closingDate);
    const due = dateInMonth(year, month, rule.value);
    return due <= closingDate ? addMonths(closingDate, 1, rule.value) : due;
  }
  return closingDate;
}

/**
 * Billing days that reproduce one bank statement (D18): a month-end close is day 31, and the
 * due rule is day-of-month when that reproduces the due date, otherwise days-after-close.
 */
export function billingDaysFrom(statement: Pick<StatementFacts, "closingDate" | "dueDate">) {
  const close = parseIsoDate(statement.closingDate);
  const closingDay = isLastDayOfMonth(statement.closingDate) ? 31 : close.day;
  const dueDay = parseIsoDate(statement.dueDate).day;
  const byDay: DueRule = { kind: "day-of-month", value: dueDay };
  const days = daysBetween(statement.closingDate, statement.dueDate);
  const dueRule: DueRule = dueDateFor(byDay, statement.closingDate) === statement.dueDate || days > 90
    ? byDay
    : { kind: "days-after-close", value: days };
  return { closingDay, dueRule };
}

export function bankToday(timeZone: string, now = new Date()) {
  const parts = new Intl.DateTimeFormat("en", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const part = (type: string) => parts.find((value) => value.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function recentClosings(card: Card, today: string, count: number) {
  const closingDay = card.closingDay;
  if (closingDay === null) return [];
  const { year, month } = parseIsoDate(today);
  let latest = dateInMonth(year, month, closingDay);
  if (latest > today) latest = addMonths(latest, -1, closingDay);
  return Array.from({ length: Math.max(1, count) }, (_, index) => addMonths(latest, -index, closingDay));
}

/** Generic percentage + floor estimate, using the existing revolving model's exact math. */
export function minimumEstimate(card: Card, balanceMinor: number): number | null {
  if (card.minimumPercentBps === null) return null;
  const result = revolvingPayment(
    { paymentModel: "percent-of-balance", percentOfBalanceBps: card.minimumPercentBps, minimumFloorMinor: card.minimumFloorMinor },
    { balanceMinor: Math.max(0, balanceMinor), lastChargeMinor: 0, contractualPaymentMinor: null, minorDigits: 2, mode: "half-up" },
  );
  return result.ok ? result.minor : null;
}

export type StatementDraft = StatementFacts & { minimumKnown: boolean };

/** The first tracked closing date: the card setting, else the earliest saved statement. */
export function trackingStart(card: Card, statements: readonly Statement[]) {
  return card.firstTrackedStatementDate ?? statements
    .filter((entry) => entry.cardId === card.id && !entry.estimate)
    .map((entry) => entry.closingDate)
    .sort()[0] ?? null;
}

/** The opening statement is the one at the tracking start (derived, never stored). */
export function isOpeningStatement(card: Card, statement: Statement, statements: readonly Statement[]) {
  return !statement.estimate && statement.closingDate === trackingStart(card, statements);
}

/** Load the entire tracked history, including the first cycle's posting-cutoff margin. */
export function cardActivityWindow(card: Card, today: string, statements: readonly Statement[] = []) {
  const start = trackingStart(card, statements);
  const first = statements.find((entry) => entry.cardId === card.id && entry.closingDate === start);
  // Until a tracking start is chosen, bootstrap recent activity without inventing earlier cycles.
  const from = start ? addDays(first?.periodStart ?? cycleDates(card, start).periodStart, -2) : addMonths(today, -6);
  return { from, to: today };
}
