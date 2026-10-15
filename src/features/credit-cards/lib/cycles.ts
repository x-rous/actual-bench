import { addDays, addMonths, dateInMonth, parseIsoDate } from "@/lib/financial-models/calendar/dates";
import { revolvingPayment } from "@/lib/financial-models/loan/revolving";
import type { Card, StatementFacts } from "./models";

/** Calendar rules are predictions, with short months clamped by the shared calendar. */
export function cycleDates(card: Card, closingDate: string) {
  const day = card.closingDay ?? parseIsoDate(closingDate).day;
  const periodStart = addDays(addMonths(closingDate, -1, day), 1);
  let dueDate = closingDate;
  if (card.dueRule?.kind === "days-after-close") dueDate = addDays(closingDate, card.dueRule.days);
  if (card.dueRule?.kind === "day-of-month") {
    const { year, month } = parseIsoDate(closingDate);
    dueDate = dateInMonth(year, month, card.dueRule.day);
    if (dueDate <= closingDate) dueDate = addMonths(closingDate, 1, card.dueRule.day);
  }
  return { periodStart, closingDate, dueDate };
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
  const result = revolvingPayment({ paymentModel: "percent-of-balance", percentOfBalanceBps: card.minimumPercentBps, minimumFloorMinor: card.minimumFloorMinor }, {
    balanceMinor: Math.max(0, balanceMinor), lastChargeMinor: 0, contractualPaymentMinor: null, minorDigits: 2, mode: "half-up",
  });
  return result.ok ? result.minor : null;
}

export type StatementDraft = StatementFacts & { bankConfirmed: false; minimumKnown: boolean };

/** Load the entire tracked history, including the first cycle's posting-cutoff margin. */
export function cardActivityWindow(card: Card, today: string, statements: import("./models").Statement[] = []) {
  const trackingDate = card.firstTrackedStatementDate ?? statements.find((entry) => entry.cardId === card.id && entry.openingAnchor)?.closingDate;
  const first = statements.find((entry) => entry.cardId === card.id && entry.closingDate === trackingDate);
  // Until a tracking start is chosen, bootstrap recent activity without inventing earlier tracked cycles.
  const from = trackingDate ? addDays(first?.periodStart ?? cycleDates(card, trackingDate).periodStart, -2) : addMonths(today, -6);
  return { from, to: today };
}
