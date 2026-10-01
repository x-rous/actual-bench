import type { DebtProjectionEvent } from "@/lib/financial-models/loan/projection";
import type { CalculationProfile } from "@/lib/financial-models/loan/profile";

/**
 * The simulator's schedule (RD-084 P1.3b T212; ux-simulator.md §12, O2, O5).
 *
 * Every figure comes straight from an engine event field or diagnostic; nothing
 * is reconstructed from other display totals (no "payment − interest").
 * Monthly and yearly rows sum, or take the period-end value of, those same
 * fields, so every view reconciles to the event view.
 */

export type ScheduleView = "events" | "month" | "year";

export type ScheduleRow = {
  key: string;
  paymentNumberFrom: number | null;
  paymentNumberTo: number | null;
  /** ISO date (events), "YYYY-MM" (month) or "YYYY" (year). */
  period: string;
  eventType: string | null;
  /** Cash paid at scheduled and final repayments, including cash-paid components. */
  paymentMinor: number;
  /** Debt reduced by those repayments (the engine's principal movement), never below zero. */
  principalMinor: number;
  interestMinor: number;
  extraRepaymentMinor: number;
  feesMinor: number;
  drawMinor: number;
  unpaidInterestMinor: number;
  balloonMinor: number;
  residualMinor: number;
  offsetAppliedMinor: number | null;
  interestBearingMinor: number | null;
  /** The rates behind this row's interest, in order; more than one displays as "Multiple". */
  rates: string[];
  openingBalanceMinor: number;
  principalMovementMinor: number;
  closingBalanceMinor: number;
};

const num = (v: unknown) => (typeof v === "number" ? v : 0);
const PAYMENT_TYPES = new Set(["repayment", "final-payment"]);

function ratesOf(e: DebtProjectionEvent): string[] {
  const listed = e.diagnostics.interestRatesDecimal;
  if (typeof listed === "string" && listed) return listed.split(";");
  return [];
}

export function eventRow(e: DebtProjectionEvent, index: number, paymentNumber: number | null = null): ScheduleRow {
  const isPayment = PAYMENT_TYPES.has(e.eventType);
  return {
    key: `${e.date}:${index}`,
    paymentNumberFrom: paymentNumber,
    paymentNumberTo: paymentNumber,
    period: e.date,
    eventType: e.eventType,
    paymentMinor: isPayment ? -e.cashMovementMinor : 0,
    principalMinor: isPayment ? Math.max(0, -e.principalMovementMinor) : 0,
    interestMinor: e.interestMinor,
    extraRepaymentMinor: e.eventType === "extra-repayment" ? -e.cashMovementMinor : 0,
    feesMinor: e.feesMinor,
    drawMinor: e.eventType === "draw" ? e.cashMovementMinor : 0,
    unpaidInterestMinor: e.eventType === "negative-amortization" ? num(e.diagnostics.unpaidInterestCapitalizedMinor) : 0,
    balloonMinor: e.eventType === "balloon" ? -e.cashMovementMinor : 0,
    residualMinor: e.eventType === "residual" ? num(e.diagnostics.residualMinor) : 0,
    offsetAppliedMinor: typeof e.diagnostics.offsetAppliedMinor === "number" ? e.diagnostics.offsetAppliedMinor : null,
    interestBearingMinor: typeof e.diagnostics.interestBearingMinor === "number" ? e.diagnostics.interestBearingMinor : null,
    rates: ratesOf(e),
    openingBalanceMinor: e.balanceBeforeMinor,
    principalMovementMinor: e.principalMovementMinor,
    closingBalanceMinor: e.balanceAfterMinor,
  };
}

const SUMMED = ["paymentMinor", "principalMinor", "interestMinor", "extraRepaymentMinor", "feesMinor", "drawMinor", "unpaidInterestMinor", "balloonMinor", "residualMinor", "principalMovementMinor"] as const;

/** All events, or monthly / yearly rows aggregated from the same events. */
export function aggregateSchedule(events: readonly DebtProjectionEvent[], view: ScheduleView): ScheduleRow[] {
  let paymentNumber = 0;
  const rows = events.map((event, index) => {
    const sequence = PAYMENT_TYPES.has(event.eventType) ? ++paymentNumber : null;
    return eventRow(event, index, sequence);
  });
  if (view === "events") return rows;
  const keyOf = (r: ScheduleRow) => (view === "month" ? r.period.slice(0, 7) : r.period.slice(0, 4));
  const out: ScheduleRow[] = [];
  for (const r of rows) {
    const period = keyOf(r);
    let agg = out.at(-1);
    if (!agg || agg.period !== period) {
      agg = { ...r, key: period, period, eventType: null, rates: [], paymentNumberFrom: null, paymentNumberTo: null, offsetAppliedMinor: null, interestBearingMinor: null };
      for (const f of SUMMED) agg[f] = 0;
      out.push(agg);
    }
    for (const f of SUMMED) agg[f] += r[f];
    if (r.paymentNumberFrom !== null) {
      agg.paymentNumberFrom ??= r.paymentNumberFrom;
      agg.paymentNumberTo = r.paymentNumberTo;
    }
    for (const rate of r.rates) if (!agg.rates.includes(rate)) agg.rates.push(rate);
    if (r.offsetAppliedMinor !== null) agg.offsetAppliedMinor = r.offsetAppliedMinor;
    if (r.interestBearingMinor !== null) agg.interestBearingMinor = r.interestBearingMinor;
    agg.closingBalanceMinor = r.closingBalanceMinor;
  }
  return out;
}

export type ColumnId = "paymentNumber" | "period" | "event" | "payment" | "principal" | "interest" | "balance" | "extra" | "fees" | "offset" | "interestBearing" | "rate" | "draw" | "unpaidInterest" | "balloon" | "residual";

/**
 * Columns relevant to what the projection actually contains: repayment
 * sequence, the five base financial columns, then only optional fields that
 * hold values in this projection.
 */
export function scheduleColumns(rows: readonly ScheduleRow[], view: ScheduleView): ColumnId[] {
  const any = (f: (r: ScheduleRow) => boolean) => rows.some(f);
  const distinctRates = new Set(rows.flatMap((r) => r.rates));
  return [
    "paymentNumber",
    "period",
    ...(view === "events" ? (["event"] as const) : []),
    "payment",
    "principal",
    "interest",
    ...(any((r) => r.extraRepaymentMinor !== 0) ? (["extra"] as const) : []),
    ...(any((r) => r.feesMinor !== 0) ? (["fees"] as const) : []),
    ...(any((r) => (r.offsetAppliedMinor ?? 0) > 0) ? (["offset", "interestBearing"] as const) : []),
    ...(distinctRates.size > 1 ? (["rate"] as const) : []),
    ...(any((r) => r.drawMinor !== 0) ? (["draw"] as const) : []),
    ...(any((r) => r.unpaidInterestMinor !== 0) ? (["unpaidInterest"] as const) : []),
    ...(any((r) => r.balloonMinor !== 0) ? (["balloon"] as const) : []),
    ...(any((r) => r.residualMinor !== 0) ? (["residual"] as const) : []),
    "balance",
  ];
}

export function paymentNumberCell(row: Pick<ScheduleRow, "paymentNumberFrom" | "paymentNumberTo">): string {
  if (row.paymentNumberFrom === null) return "";
  return row.paymentNumberTo !== null && row.paymentNumberTo !== row.paymentNumberFrom ? `${row.paymentNumberFrom}–${row.paymentNumberTo}` : String(row.paymentNumberFrom);
}

function elapsed(date: string, startDate: string): { year: number; month: number } {
  const [sy, sm] = startDate.split("-").map(Number);
  const [y, m] = date.split("-").map(Number);
  const ordinal = Math.max(1, (y - sy) * 12 + (m - sm) + 1);
  return { year: Math.floor((ordinal - 1) / 12) + 1, month: ((ordinal - 1) % 12) + 1 };
}

const monthName = (date: string, includeDay: boolean) => new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", month: "short", year: "numeric", ...(includeDay ? { day: "numeric" as const } : {}) }).format(new Date(`${includeDay ? date : `${date}-01`}T00:00:00Z`));

export function schedulePeriodLabel(period: string, view: ScheduleView, startDate: string): string {
  if (view === "year") {
    const year = Number(period);
    const start = elapsed(`${period}-${year === Number(startDate.slice(0, 4)) ? startDate.slice(5, 7) : "01"}-01`, startDate).year;
    const end = elapsed(`${period}-12-01`, startDate).year;
    return `Yr ${start === end ? start : `${start}–${end}`} · ${period}`;
  }
  const date = view === "events" ? period : `${period}-01`;
  const loan = elapsed(date, startDate);
  return `Yr ${loan.year}, Mo ${loan.month} · ${monthName(period, view === "events")}`;
}

/** O5: interest charged on its own cadence means a repayment reduces the debt, not only principal. */
export function principalLabel(profile: Pick<CalculationProfile, "chargeFrequency">): { label: string; help: string | null } {
  return profile.chargeFrequency === "at-repayment"
    ? { label: "Principal", help: null }
    : { label: "Debt reduction", help: "Interest is charged separately, so repayments reduce the outstanding loan balance. Interest charges appear as their own events." };
}

/** The Rate cell: one rate, or "Multiple" when the row's interest used more than one (O2). */
export function rateCell(rates: readonly string[]): string {
  if (rates.length === 0) return "";
  return rates.length === 1 ? rates[0] : "Multiple";
}
