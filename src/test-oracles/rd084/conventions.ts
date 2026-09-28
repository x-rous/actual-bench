import { q, qadd, qdiv, qmul, qpow, qroot, qs, qsub, roundHalfAway, type Q } from "./rational";

/**
 * Reference day counts and loan arithmetic for RD-084 fixtures, written from
 * the formulas in the spec (FR-036–FR-041, V3 §10) and the published sources
 * recorded in each fixture's `source.md`.
 *
 * Independent of `src/lib/financial-models/` by construction and by lint
 * (eslint.config.mjs forbids the import): dates go through `Date.UTC` day by
 * day rather than civil-day formulas, and every fraction is exact. Slow and
 * simple on purpose. Test-only.
 */

const DAY_MS = 86_400_000;

function utcDay(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / DAY_MS;
}

function isoOf(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

/** Every calendar day in [start, end). */
export function eachDay(start: string, end: string): string[] {
  const out: string[] = [];
  for (let n = utcDay(start); n < utcDay(end); n++) out.push(isoOf(n));
  return out;
}

export function dayCount(start: string, end: string): number {
  return utcDay(end) - utcDay(start);
}

function yearLength(year: number): number {
  return (Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1)) / DAY_MS;
}

function monthLength(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export type OracleConvention =
  | "actual-365-fixed"
  | "actual-actual-calendar"
  | "actual-360"
  | "monthly-30-360-actual-day-allocation";

/** Each day's share of a year under the convention, summed over [start, end). */
export function yearFraction(convention: OracleConvention, start: string, end: string): Q {
  let total = q(0);
  for (const day of eachDay(start, end)) {
    const [y, m] = day.split("-").map(Number);
    switch (convention) {
      case "actual-365-fixed":
        total = qadd(total, q(1, 365));
        break;
      case "actual-actual-calendar":
        total = qadd(total, q(1, yearLength(y)));
        break;
      case "actual-360":
        total = qadd(total, q(1, 360));
        break;
      case "monthly-30-360-actual-day-allocation":
        // 1/12 of the year spread evenly over the month's actual days.
        total = qadd(total, q(1, 12 * monthLength(y, m)));
        break;
    }
  }
  return total;
}

/** Simple interest for one period, exact. */
export function periodInterest(convention: OracleConvention, principal: string, annualRate: string, start: string, end: string): Q {
  return qmul(qmul(qs(principal), qs(annualRate)), yearFraction(convention, start, end));
}

/** Periodic rate for a quoted annual rate compounded `m` times a year, paid `k` times a year: (1 + r/m)^(m/k) − 1. */
export function periodicRate(annualRate: string, compoundsPerYear: number, paymentsPerYear: number, digits: number): Q {
  const growth = qpow(qadd(q(1), qdiv(qs(annualRate), q(compoundsPerYear))), compoundsPerYear);
  if (compoundsPerYear === paymentsPerYear) return qdiv(qs(annualRate), q(compoundsPerYear));
  return qsub(qroot(growth, paymentsPerYear, digits), q(1));
}

/** Present-value factor (1 − (1+r)^−n) / r and the level payment P / factor. */
export function levelPayment(principal: string, r: Q, n: number): { pvFactor: Q; payment: Q } {
  if (r.n === BigInt(0)) return { pvFactor: q(n), payment: qdiv(qs(principal), q(n)) };
  const pvFactor = qdiv(qsub(q(1), qpow(qadd(q(1), r), -n)), r);
  return { pvFactor, payment: qdiv(qs(principal), pvFactor) };
}

export type DailyLoanInput = {
  openingDate: string;
  openingPrincipal: string;
  annualRate: string;
  convention: OracleConvention;
  dailyInterestScale: number;
  chargeDates: string[];
  until: string;
  eventTiming: "start-of-day" | "end-of-day";
};

export type DailyLoanRow = { date: string; event: string; amountMinor: bigint; balanceAfterMinor: bigint };

/**
 * A daily-accrual, monthly-charge loan as described by the au-daily sources:
 * each day's interest on that day's balance, rounded to `dailyInterestScale`
 * places; the sum rounded to cents and capitalized at the end of the day
 * before each charge date (so the charge covers [previous charge, charge date)
 * and is posted on the charge date). Repayments on a date apply before that
 * day's accrual for `start-of-day`, after it for `end-of-day`. Half-up ties.
 */
export function simulateDailyLoan(input: DailyLoanInput, repayments: { date: string; amountMinor: number }[]): DailyLoanRow[] {
  let balance = qs(input.openingPrincipal);
  let accrued = q(0);
  const rows: DailyLoanRow[] = [];
  const charges = new Set(input.chargeDates);
  const cents = (x: Q) => (x.n * BigInt(100)) / x.d;
  const repay = (day: string) => {
    for (const r of repayments.filter((p) => p.date === day)) {
      balance = qadd(balance, q(r.amountMinor, 100));
      rows.push({ date: day, event: "repayment", amountMinor: BigInt(r.amountMinor), balanceAfterMinor: cents(balance) });
    }
  };
  for (const day of eachDay(input.openingDate, input.until)) {
    if (input.eventTiming === "start-of-day") repay(day);
    const next = isoOf(utcDay(day) + 1);
    accrued = qadd(accrued, roundHalfAway(qmul(qmul(balance, qs(input.annualRate)), yearFraction(input.convention, day, next)), input.dailyInterestScale));
    if (input.eventTiming === "end-of-day") repay(day);
    if (charges.has(next)) {
      const charge = roundHalfAway(accrued, 2);
      balance = qadd(balance, charge);
      rows.push({ date: next, event: "interest-charge", amountMinor: cents(charge), balanceAfterMinor: cents(balance) });
      accrued = q(0);
    }
  }
  return rows;
}
