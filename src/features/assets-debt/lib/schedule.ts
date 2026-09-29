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

export function eventRow(e: DebtProjectionEvent, index: number): ScheduleRow {
  const isPayment = PAYMENT_TYPES.has(e.eventType);
  return {
    key: `${e.date}:${index}`,
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
  const rows = events.map(eventRow);
  if (view === "events") return rows;
  const keyOf = (r: ScheduleRow) => (view === "month" ? r.period.slice(0, 7) : r.period.slice(0, 4));
  const out: ScheduleRow[] = [];
  for (const r of rows) {
    const period = keyOf(r);
    let agg = out.at(-1);
    if (!agg || agg.period !== period) {
      agg = { ...r, key: period, period, eventType: null, rates: [], offsetAppliedMinor: null, interestBearingMinor: null };
      for (const f of SUMMED) agg[f] = 0;
      out.push(agg);
    }
    for (const f of SUMMED) agg[f] += r[f];
    for (const rate of r.rates) if (!agg.rates.includes(rate)) agg.rates.push(rate);
    if (r.offsetAppliedMinor !== null) agg.offsetAppliedMinor = r.offsetAppliedMinor;
    if (r.interestBearingMinor !== null) agg.interestBearingMinor = r.interestBearingMinor;
    agg.closingBalanceMinor = r.closingBalanceMinor;
  }
  return out;
}

export type ColumnId = "period" | "event" | "payment" | "principal" | "interest" | "balance" | "extra" | "fees" | "offset" | "interestBearing" | "rate" | "draw" | "unpaidInterest" | "balloon" | "residual";

/**
 * Columns relevant to what the projection actually contains: the five base
 * columns, plus an optional one only where the rows hold non-zero values.
 */
export function scheduleColumns(rows: readonly ScheduleRow[], view: ScheduleView): ColumnId[] {
  const any = (f: (r: ScheduleRow) => boolean) => rows.some(f);
  const distinctRates = new Set(rows.flatMap((r) => r.rates));
  return [
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
