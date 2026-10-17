import { paymentTarget, paymentTargetRemaining } from "./paymentTargets";
import { addDays, addMonths, daysBetween } from "@/lib/financial-models/calendar/dates";
import { formatAmount } from "@/features/assets-debt/lib/money";
import { formatCardDate } from "./displayDates";
import { observedInterestTotals } from "./history";
import { sumMinor } from "./statements";
import type { ActivitySnapshot } from "./activity";
import type { Card, Statement, Workspace } from "./models";
import type { Settlement } from "./repayments";
import type { statementPaymentTotals } from "./insights";

export const formatCardMonth = (date: string) => new Intl.DateTimeFormat("en", { month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));

/** Monthly totals in integer minor units. Missing cards never become zero debt. */
export function portfolioStatementTrend(cards: Card[], statements: Statement[]) {
  return [...new Set(statements.map((entry) => entry.closingDate.slice(0, 7)))].sort().map((month) => {
    const records = cards.map((card) => statements.filter((entry) => entry.cardId === card.id && entry.closingDate.startsWith(month)).sort((a, b) => b.closingDate.localeCompare(a.closingDate))[0]);
    return { date: `${month}-01`, label: formatCardMonth(`${month}-01`), value: records.every(Boolean) ? sumMinor(records.map((entry) => Math.max(0, entry.officialBalanceMinor))) : null,
      source: records.every(Boolean) ? records.every((entry) => entry.bankConfirmed) ? "Confirmed bank values" : "Includes estimates" : "Missing card statement evidence",
      breakdown: cards.map((card, index) => ({ label: `${card.nickname} · ${records[index] ? formatCardDate(records[index].closingDate) : "missing statement"}`, value: records[index] ? Math.max(0, records[index].officialBalanceMinor) : null })) };
  });
}

/** Observed cleared charges in available loaded periods. Partial totals remain explicit. */
export function portfolioInterestTrend(cards: Card[], workspace: Workspace, sources: (ActivitySnapshot | undefined)[], todays: string[]) {
  const usable = sources.map((source, index) => source && !source.issues.length && source.from <= (source.to < todays[index] ? source.to : todays[index]) ? source : undefined);
  const loaded = usable.flatMap((source, index) => source ? [{ from: source.from, to: source.to < todays[index] ? source.to : todays[index] }] : []);
  if (!cards.length || !loaded.length) return [];
  const from = loaded.map((entry) => entry.from).sort()[0];
  const to = loaded.map((entry) => entry.to).sort().at(-1)!;
  const points = [];
  for (let start = `${from.slice(0, 7)}-01`; start <= to; start = addMonths(start, 1)) {
    const end = addDays(addMonths(start, 1), -1);
    const totals = cards.map((card, index) => {
      const source = usable[index];
      if (!source) return null;
      const periodFrom = source.from > start ? source.from : start;
      const cutoff = source.to < todays[index] ? source.to : todays[index];
      const periodTo = cutoff < end ? cutoff : end;
      return periodFrom <= periodTo ? observedInterestTotals(card, workspace, { ...source, from: periodFrom, to: periodTo }, todays[index]) : null;
    });
    const classified = totals.filter((entry) => entry?.classificationKnown).length;
    const complete = totals.every((entry, index) => entry?.classificationKnown && entry.from === start && entry.to === (todays[index] < end ? todays[index] : end));
    const identified = totals.some((entry) => entry && (entry.classificationKnown || entry.totalMinor !== 0));
    points.push({ date: start, label: formatCardMonth(start), value: identified ? sumMinor(totals.flatMap((entry) => entry ? [entry.totalMinor] : [])) : null,
      source: `Observed Actual transactions · ${classified} of ${cards.length} cards classified${complete ? "" : "; partial coverage - identified charges only"}`,
      breakdown: cards.map((card, index) => ({ label: `${card.nickname} · ${totals[index] ? `${formatCardDate(totals[index]!.from)} – ${formatCardDate(totals[index]!.to)}${totals[index]!.classificationKnown ? "" : " · classification incomplete"}` : "missing evidence"}`, value: totals[index] && (totals[index]!.classificationKnown || totals[index]!.totalMinor !== 0) ? totals[index]!.totalMinor : null })) });
  }
  return points;
}

export function paymentTotalsDetail(totals: ReturnType<typeof statementPaymentTotals>) {
  return [totals.minimumMinor > 0 ? `Minimum remaining ${formatAmount(totals.minimumMinor, 2)}` : null, totals.overdueMinimumMinor > 0 ? `Overdue minimum ${formatAmount(totals.overdueMinimumMinor, 2)}` : null, totals.pendingMinor > 0 ? `Pending ${formatAmount(totals.pendingMinor, 2)}` : null,
    !totals.minimumMinor && totals.coverage === totals.total ? "No minimum payment outstanding" : null,
    totals.coverage < totals.total ? `${totals.coverage} of ${totals.total} cards confirmed; total is partial` : null].filter(Boolean).join(" · ");
}

/** Amount outcome stays separate from timing: carried debt does not imply a missed minimum. */
export function portfolioPaymentTiming(statement: Statement | undefined, payment: Settlement | undefined, today: string) {
  if (!statement || !payment || payment.fullRemainingMinor === null) return null;
  const delay = daysBetween(statement.dueDate, today);
  if (paymentTargetRemaining(statement, payment.confirmedPaidMinor) > 0) return delay > 0 ? `Full balance remaining · ${delay} ${delay === 1 ? "day" : "days"} past due date` : delay === 0 ? "Due today" : delay >= -7 ? "Due soon" : "Upcoming";
  const paidDate = paymentTarget(statement) === Math.max(0, statement.officialBalanceMinor) ? payment.confirmedPaidDate : payment.confirmedTargetPaidDate;
  if (paidDate) { const late = daysBetween(statement.dueDate, paidDate); const outcome = "Paid"; return late > 0 ? `${outcome} ${late} ${late === 1 ? "day" : "days"} late` : `${outcome} on time`; }
  return null;
}
