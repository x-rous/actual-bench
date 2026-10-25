import { addDays, addMonths, daysBetween } from "@/lib/financial-models/calendar/dates";
import type { ActivitySnapshot } from "./activity";
import { observedChargeTotals } from "./history";
import type { Card, Workspace } from "./models";
import { trackedDebtPoints } from "./derive/planAccounts";
import { paymentRows, statementPayments } from "./derive/payments";
import { transactionType } from "./derive/types";
import { BORROWING_KINDS, costFamilyOf } from "./derive/families";
import { statementReview, sumMinor } from "./statements";
import { hasLaterStatement, paymentStatus, type PaymentStatus } from "./derive/status";

/** Reconstructed end-of-day balances; all monetary fields are integer minor units. */
export type BalanceDay = {
  date: string;
  valueMinor: number | null;
  onCardMinor: number | null;
  planMinor: number | null;
  transitMinor: number | null;
  interest: "free" | "charged" | null;
};
export type BalanceBand = { from: string; to: string; kind: "free" | "charged" };
export type BalanceEvent = {
  id: string;
  date: string;
  kind: "statement" | "payment";
  amountMinor: number | null;
  statementId?: string;
  pending?: boolean;
  label?: string;
};
/** One saved statement's bill: its outcome badge, the payments toward it and the interest it charged. */
export type BalanceBill = {
  statementId: string;
  closingDate: string;
  dueDate: string;
  status: PaymentStatus;
  amountDueMinor: number | null;
  payments: BalanceEvent[];
  /** Interest and fees on the statement (positive), null while its review is incomplete. */
  costsMinor: number | null;
  /** Interest was charged on the statement; null while its review is incomplete. */
  interestCharged: boolean | null;
};
/** A statement cycle, for the alternating backgrounds. */
export type BalanceCycle = { statementId: string; from: string; to: string };
/** "If you pay Left to pay by the due date": Total owed today, then after that payment. */
export type BalanceProjection = { from: string; to: string; startMinor: number; endMinor: number; payMinor: number };
/** What the daily balance chart draws: `dailyBalanceHistory`'s result. */
export type BalanceChartData = {
  from: string;
  until: string;
  today: string;
  points: BalanceDay[];
  bands: BalanceBand[];
  events: BalanceEvent[];
  bills: BalanceBill[];
  cycles: BalanceCycle[];
  projection: BalanceProjection | null;
  highest: BalanceDay | null;
  currentMinor: number | null;
};
export type BalanceRange = 6 | 12;

const paymentEvent = (row: { id: string; label: string; amountMinor: number; cleared?: boolean | null }, date: string): BalanceEvent => ({
  id: row.id, date, label: row.label, kind: "payment", amountMinor: row.amountMinor, pending: row.cleared !== true,
});

/**
 * Uses the shared Total owed reconstruction; future transactions never enter an as-of-today anchor.
 * `range` months before the current one are shown (6 or 12). The only
 * future shown is the closed bill still to come due, so the chart ends just after its due date.
 */
const trimmed = new WeakMap<ActivitySnapshot, Map<string, ActivitySnapshot>>();

/** The snapshot without future-dated rows, one object per source and day so snapshot-keyed caches still hit. */
function upToToday(source: ActivitySnapshot, today: string) {
  if (!source.rows.some((row) => row.date > today)) return source;
  let byDay = trimmed.get(source);
  if (!byDay) trimmed.set(source, byDay = new Map());
  let snapshot = byDay.get(today);
  if (!snapshot) byDay.set(today, snapshot = { ...source, rows: source.rows.filter((row) => row.date <= today) });
  return snapshot;
}

export function dailyBalanceHistory(
  card: Card, workspace: Workspace, source: ActivitySnapshot, signedTodayMinor: number | undefined, today: string, range: BalanceRange = 6,
) {
  const start = addMonths(`${today.slice(0, 7)}-01`, -range, 1);
  const from = [start, source.from, card.firstTrackedStatementDate ?? source.from].sort().at(-1)!;
  const dates = Array.from({ length: Math.max(0, daysBetween(from, today) + 1) }, (_, index) => addDays(from, index));
  const snapshot = upToToday(source, today);
  const statements = workspace.statements.filter((entry) => entry.cardId === card.id);
  const saved = statements.filter((entry) => !entry.estimate && entry.closingDate <= today);
  const payments = statementPayments(card, workspace, snapshot, today);
  const open = saved.filter((entry) => entry.dueDate > today).sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];
  const until = open ? addDays(open.dueDate, 2) : today;
  const costsByStatement = new Map<string, number>();
  const interestByStatement = new Map<string, boolean>();
  const freeWindows: { from: string; to: string }[] = [];
  const costWindows: { from: string; to: string }[] = [];
  for (const statement of saved) {
    const review = statementReview(statement, workspace, snapshot);
    if (!review.complete) continue;
    const included = review.rows.filter((_, index) => review.memberships[index].decision === "included");
    const kinds = included.map((row) => ({ row, type: transactionType(row, card, workspace, snapshot) }));
    const charged = kinds.some(({ row, type }) => row.amountMinor < 0 && type.counted && costFamilyOf(type.kind) === "interest");
    interestByStatement.set(statement.id, charged);
    costsByStatement.set(statement.id, -sumMinor(kinds.filter(({ type }) => type.counted && costFamilyOf(type.kind)).map(({ row }) => row.amountMinor)));
    if (charged) costWindows.push({ from: statement.periodStart, to: statement.closingDate });
    const payment = payments.find((entry) => entry.statementId === statement.id);
    const borrowing = kinds.some(({ type }) => BORROWING_KINDS.includes(type.kind));
    const paidByDue = payment?.unpaidAtDueMinor === 0;
    if (statement.balanceMinor > 0 && paidByDue && !charged && !borrowing) freeWindows.push({ from: statement.closingDate, to: statement.dueDate });
  }
  const raw = signedTodayMinor === undefined || source.issues.length ? [] : trackedDebtPoints(card, workspace, snapshot, signedTodayMinor, dates);
  const points: BalanceDay[] = dates.map((date, index) => {
    const point = raw[index];
    // No grace-period inference while a separate interest-bearing plan runs.
    const interestPlan = workspace.plans.some((plan) => plan.cardId === card.id && plan.aprBps > 0
      && (plan.startDate ?? "0000-00-00") <= date && (!plan.endedOn || date < plan.endedOn));
    const interest = costWindows.some((window) => date >= window.from && date <= window.to) ? "charged"
      : !interestPlan && freeWindows.some((window) => date >= window.from && date <= window.to) ? "free" : null;
    return {
      date,
      valueMinor: point?.valueMinor ?? null,
      onCardMinor: point?.valueMinor == null ? null : point.onCardMinor,
      planMinor: point?.valueMinor == null ? null : point.planMinor ?? 0,
      transitMinor: point?.valueMinor == null ? null : point.transitMinor ?? 0,
      interest: point?.valueMinor != null ? interest : null,
    };
  });
  const bands: BalanceBand[] = [];
  for (const point of points) {
    if (!point.interest) continue;
    const previous = bands.at(-1);
    if (previous?.kind === point.interest && addDays(previous.to, 1) === point.date) previous.to = point.date;
    else bands.push({ from: point.date, to: point.date, kind: point.interest });
  }
  const known = points.filter((point) => point.valueMinor !== null);
  const total = known.reduce((acc, point) => acc + BigInt(point.valueMinor!), BigInt(0));
  const count = BigInt(known.length);
  const averageMinor = count ? Number((total + count / BigInt(2)) / count) : null;
  const highest = known.reduce<BalanceDay | null>((peak, point) => (!peak || point.valueMinor! > peak.valueMinor! ? point : peak), null);
  const events: BalanceEvent[] = saved.filter((entry) => entry.closingDate >= from).map((entry) => ({
    id: entry.id,
    statementId: entry.id,
    date: entry.closingDate,
    kind: "statement",
    amountMinor: points.find((point) => point.date === entry.closingDate)?.valueMinor ?? null,
  }));
  for (const { row, date } of paymentRows(card, workspace, snapshot)) {
    if (date < from || row.amountMinor <= 0) continue;
    events.push(paymentEvent(row, date));
  }
  const bills: BalanceBill[] = saved.filter((entry) => entry.dueDate >= from).map((statement) => {
    const payment = payments.find((entry) => entry.statementId === statement.id);
    return {
      statementId: statement.id,
      closingDate: statement.closingDate,
      dueDate: statement.dueDate,
      status: paymentStatus(statement, payment, today, false, hasLaterStatement(saved, statement)),
      amountDueMinor: payment?.amountDueMinor ?? null,
      payments: (payment?.rows ?? []).filter(({ row }) => row.amountMinor > 0).map(({ row, date }) => paymentEvent(row, date)),
      costsMinor: costsByStatement.get(statement.id) ?? null,
      interestCharged: interestByStatement.get(statement.id) ?? null,
    };
  });
  const cycles: BalanceCycle[] = saved.filter((entry) => entry.closingDate >= from)
    .map((entry) => ({ statementId: entry.id, from: entry.periodStart > from ? entry.periodStart : from, to: entry.closingDate }));
  const currentMinor = points.at(-1)?.valueMinor ?? null;
  const left = open ? payments.find((entry) => entry.statementId === open.id)?.leftToPayMinor ?? null : null;
  const projection: BalanceProjection | null = open && left && currentMinor !== null
    ? { from: today, to: open.dueDate, startMinor: currentMinor, endMinor: Math.max(0, currentMinor - left), payMinor: left }
    : null;
  const costsSource = { ...snapshot, from, to: today < source.to ? today : source.to };
  const interest = observedChargeTotals(card, workspace, costsSource, today, "interest");
  const fees = observedChargeTotals(card, workspace, costsSource, today, "fee");
  const settled = bills.filter((bill) => bill.dueDate <= today && bill.status.known && bill.status.key !== "nothing-to-pay");
  return {
    from, until, today, points, bands, events, bills, cycles, projection, averageMinor, highest,
    knownDays: known.length,
    totalDays: points.length,
    currentMinor,
    // Statements closed in the range whose review is complete, and how many charged no interest.
    interestFreeStatements: (() => {
      const reviewed = bills.filter((bill) => bill.closingDate >= from && bill.closingDate <= today && bill.interestCharged !== null);
      return { free: reviewed.filter((bill) => !bill.interestCharged).length, total: reviewed.length };
    })(),
    billsPaidInFull: { paid: settled.filter((bill) => bill.status.paid && !bill.status.late).length, total: settled.length },
    costsMinor: from <= source.to && source.to >= today && interest.classificationKnown && fees.classificationKnown
      ? sumMinor([interest.totalMinor, fees.totalMinor])
      : null,
    pendingCount: snapshot.rows.filter((row) => row.date >= from && row.cleared !== true && row.amountMinor !== 0).length,
  };
}
export type DailyBalanceHistory = ReturnType<typeof dailyBalanceHistory>;
