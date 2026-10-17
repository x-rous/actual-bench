import { addDays, addMonths, daysBetween } from "@/lib/financial-models/calendar/dates";
import { activityKind, paymentEvidence, type ActivitySnapshot } from "./activity";
import { cycleDates } from "./cycles";
import { observedChargeTotals } from "./history";
import type { Card, Workspace } from "./models";
import { trackedDebtPoints } from "./planTracking";
import { settlements } from "./repayments";
import { costFamily } from "./recognition";
import { statementReview, sumMinor } from "./statements";

/** All monetary fields are integer minor units. Values are reconstructed end-of-day balances. */
export type BalanceDay = {
  date: string; valueMinor: number | null; onCardMinor: number | null; planMinor: number | null; transitMinor: number | null;
  interest: "free" | "charged" | null;
};
export type BalanceBand = { from: string; to: string; kind: "free" | "charged" };
export type BalanceEvent = { id: string; date: string; kind: "statement" | "due" | "payment"; amountMinor: number | null; statementId?: string; pending?: boolean; estimated?: boolean; label?: string };

/** Uses the existing total-debt reconstruction; future transactions never enter an as-of-today anchor. */
export function dailyBalanceHistory(card: Card, workspace: Workspace, source: ActivitySnapshot, signedTodayMinor: number | undefined, today: string) {
  const from = [addMonths(`${today.slice(0, 7)}-01`, -4, 1), source.from, card.firstTrackedStatementDate ?? source.from].sort().at(-1)!;
  const until = addDays(addMonths(`${today.slice(0, 7)}-01`, 3, 1), -1);
  const dates = Array.from({ length: Math.max(0, daysBetween(from, today) + 1) }, (_, index) => addDays(from, index));
  const snapshot = { ...source, rows: source.rows.filter((row) => row.date <= today) };
  const statements = workspace.statements.filter((entry) => entry.cardId === card.id);
  const confirmed = statements.filter((entry) => entry.bankConfirmed && entry.closingDate <= today);
  const statuses = settlements(card, workspace, snapshot, today);
  const freeWindows: { from: string; to: string }[] = [], costWindows: { from: string; to: string }[] = [];
  for (const statement of confirmed) {
    const review = statementReview(statement, workspace, snapshot);
    if (!review.coverage || review.unresolved || review.duplicate) continue;
    const included = review.rows.filter((_, index) => review.memberships[index].decision === "included");
    const charged = included.some((row) => row.cleared === true && row.amountMinor < 0 && costFamily(activityKind(row, card, workspace, snapshot)) === "interest");
    if (charged) costWindows.push({ from: statement.periodStart, to: statement.closingDate });
    const status = statuses.find((entry) => entry.statementId === statement.id);
    const borrowing = included.some((row) => ["cash-advance", "balance-transfer", "money-transfer"].includes(activityKind(row, card, workspace, snapshot)));
    if (statement.officialBalanceMinor > 0 && status?.fullByDue === true && (statement.minimumDueMinor === 0 || status.minimumByDue === true) && !charged && !borrowing) freeWindows.push({ from: statement.closingDate, to: statement.dueDate });
  }
  const raw = signedTodayMinor === undefined || source.issues.length ? [] : trackedDebtPoints(card, workspace, snapshot, signedTodayMinor, dates);
  const points: BalanceDay[] = dates.map((date, index) => {
    const point = raw[index];
    // No grace-period inference for a separate interest-bearing plan, including historical plans.
    const interestPlan = workspace.plans?.some((plan) => plan.cardId === card.id && plan.aprBps !== null && plan.aprBps > 0 && plan.startDate <= date);
    const interest = costWindows.some((window) => date >= window.from && date <= window.to) ? "charged" : !interestPlan && freeWindows.some((window) => date >= window.from && date <= window.to) ? "free" : null;
    const part = (label: string) => point?.value == null ? null : point.breakdown?.find((entry) => entry.label === label)?.value ?? 0;
    return { date, valueMinor: point?.value ?? null, onCardMinor: part("On card"), planMinor: part("In plan account"), transitMinor: part("Transfer in transit"), interest: point?.value != null ? interest : null };
  });
  const bands: BalanceBand[] = [];
  for (const point of points) {
    if (!point.interest) continue;
    const previous = bands.at(-1);
    if (previous?.kind === point.interest && addDays(previous.to, 1) === point.date) previous.to = point.date;
    else bands.push({ from: point.date, to: point.date, kind: point.interest });
  }
  const known = points.filter((point) => point.valueMinor !== null);
  const total = known.reduce((sum, point) => sum + BigInt(point.valueMinor!), BigInt(0));
  const count = BigInt(known.length);
  const averageMinor = count ? Number((total + count / BigInt(2)) / count) : null;
  const highest = known.reduce<BalanceDay | null>((peak, point) => !peak || point.valueMinor! > peak.valueMinor! ? point : peak, null);
  const events: BalanceEvent[] = confirmed.filter((entry) => entry.closingDate >= from).map((entry) => ({ id: entry.id, statementId: entry.id, date: entry.closingDate, kind: "statement", amountMinor: points.find((point) => point.date === entry.closingDate)?.valueMinor ?? null }));
  events.push(...statements.filter((entry) => entry.dueDate >= from && entry.dueDate <= until).map((entry): BalanceEvent => ({ id: `due-${entry.id}`, statementId: entry.id, date: entry.dueDate, kind: "due", amountMinor: null, estimated: !entry.bankConfirmed })));
  if (card.closingDay !== null) {
    for (let month = `${today.slice(0, 7)}-01`; month <= until; month = addMonths(month, 1, 1)) {
      const closing = addMonths(month, 0, card.closingDay);
      if (closing <= today || statements.some((entry) => entry.closingDate.slice(0, 7) === month.slice(0, 7))) continue;
      const cycle = cycleDates(card, closing);
      if (card.dueRule && cycle.dueDate <= until) events.push({ id: `expected-${closing}`, date: cycle.dueDate, kind: "due", amountMinor: null, estimated: true });
    }
  }
  events.push(...snapshot.rows.filter((row) => row.date >= from && row.amountMinor > 0 && activityKind(row, card, workspace, snapshot) === "payment").map((row): BalanceEvent => ({ id: row.id, date: row.date, label: row.label, kind: "payment", amountMinor: row.amountMinor, pending: paymentEvidence(row, snapshot, workspace) !== "confirmed" })));
  const costsSource = { ...snapshot, from, to: today < source.to ? today : source.to };
  const interest = observedChargeTotals(card, workspace, costsSource, today, "interest"), fees = observedChargeTotals(card, workspace, costsSource, today, "fee");
  return { from, until, today, points, bands, events, averageMinor, highest, knownDays: known.length, totalDays: points.length, currentMinor: points.at(-1)?.valueMinor ?? null,
    costsMinor: from <= source.to && source.to >= today && interest.classificationKnown && fees.classificationKnown ? sumMinor([interest.totalMinor, fees.totalMinor]) : null,
    pendingCount: snapshot.rows.filter((row) => row.date >= from && row.cleared !== true && row.amountMinor !== 0).length };
}
export type DailyBalanceHistory = ReturnType<typeof dailyBalanceHistory>;
