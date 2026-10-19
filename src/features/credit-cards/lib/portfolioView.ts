import { addDays, addMonths } from "@/lib/financial-models/calendar/dates";
import { formatAmount } from "@/features/assets-debt/lib/money";
import { formatCardDate, formatCardMonth } from "./displayDates";
import { observedInterestTotals } from "./history";
import { sumMinor } from "./statements";
import type { ActivitySnapshot } from "./activity";
import type { Card, Statement, Workspace } from "./models";
import type { statementPaymentTotals } from "./insights";

export { formatCardMonth };

type NameOf = (card: Card) => string;

/** Monthly statement-balance totals in integer minor units. Missing cards never become zero debt. */
export function portfolioStatementTrend(cards: Card[], statements: Statement[], nameOf: NameOf) {
  const months = [...new Set(statements.map((entry) => entry.closingDate.slice(0, 7)))].sort();
  return months.map((month) => {
    const records = cards.map((card) => statements
      .filter((entry) => entry.cardId === card.id && entry.closingDate.startsWith(month))
      .sort((a, b) => b.closingDate.localeCompare(a.closingDate))[0]);
    const complete = records.every(Boolean);
    return {
      date: `${month}-01`,
      label: formatCardMonth(`${month}-01`),
      value: complete ? sumMinor(records.map((entry) => Math.max(0, entry.balanceMinor))) : null,
      source: !complete ? "Missing card statements" : records.some((entry) => entry.estimate) ? "Includes estimates" : "Bank statements",
      breakdown: cards.map((card, index) => ({
        label: `${nameOf(card)} · ${records[index] ? formatCardDate(records[index].closingDate) : "missing statement"}`,
        value: records[index] ? Math.max(0, records[index].balanceMinor) : null,
      })),
    };
  });
}

/** Observed interest per month in each card's loaded period. Partial months say so. */
export function portfolioInterestTrend(cards: Card[], workspace: Workspace, sources: (ActivitySnapshot | undefined)[], todays: string[], nameOf: NameOf) {
  const cutoff = (source: ActivitySnapshot, index: number) => (source.to < todays[index] ? source.to : todays[index]);
  const usable = sources.map((source, index) => (source && !source.issues.length && source.from <= cutoff(source, index) ? source : undefined));
  const loaded = usable.flatMap((source, index) => (source ? [{ from: source.from, to: cutoff(source, index) }] : []));
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
      const periodTo = cutoff(source, index) < end ? cutoff(source, index) : end;
      return periodFrom <= periodTo
        ? observedInterestTotals(card, workspace, { ...source, from: periodFrom, to: periodTo }, todays[index])
        : null;
    });
    const complete = totals.every((entry, index) => entry && entry.from === start && entry.to === (todays[index] < end ? todays[index] : end));
    const identified = totals.some(Boolean);
    points.push({
      date: start,
      label: formatCardMonth(start),
      value: identified ? sumMinor(totals.flatMap((entry) => (entry ? [entry.totalMinor] : []))) : null,
      source: `Interest from Actual · ${totals.filter(Boolean).length} of ${cards.length} cards${complete ? "" : " · partial month"}`,
      breakdown: cards.map((card, index) => ({
        label: `${nameOf(card)} · ${totals[index] ? `${formatCardDate(totals[index]!.from)} – ${formatCardDate(totals[index]!.to)}` : "not loaded"}`,
        value: totals[index]?.totalMinor ?? null,
      })),
    });
  }
  return points;
}

/**
 * The date range every card has activity for (CA-15), so a portfolio total never implies
 * coverage some cards don't have. Null when the cards share no loaded period.
 */
export function commonCoverage(sources: (ActivitySnapshot | undefined)[], todays: string[]) {
  if (!sources.length || sources.some((source) => !source || source.issues.length)) return null;
  const from = sources.map((source) => source!.from).sort().at(-1)!;
  const to = sources.map((source, index) => (source!.to < todays[index] ? source!.to : todays[index])).sort()[0];
  return from <= to ? { from, to } : null;
}

export function paymentTotalsDetail(totals: ReturnType<typeof statementPaymentTotals>) {
  return [
    totals.minimumMinor > 0 ? `Minimum left ${formatAmount(totals.minimumMinor, 2)}` : null,
    totals.overdueMinimumMinor > 0 ? `Overdue ${formatAmount(totals.overdueMinimumMinor, 2)}` : null,
    totals.pendingMinor > 0 ? `Pending ${formatAmount(totals.pendingMinor, 2)}` : null,
    !totals.minimumMinor && totals.coverage === totals.total ? "No minimum outstanding" : null,
    totals.coverage < totals.total ? `${totals.coverage} of ${totals.total} cards known; total is partial` : null,
  ].filter(Boolean).join(" · ");
}
