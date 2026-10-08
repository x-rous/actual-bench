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

/**
 * MSRB Rule G-33(e)(ii) 30/360 day count, written from the rule's text:
 * days = (Y2 − Y1) 360 + (M2 − M1) 30 + (D2 − D1); D2 = 31 becomes 30 when
 * D1 is 30 or 31; D1 = 31 becomes 30. No February rule exists in the text.
 */
export function msrbG33Days(start: string, end: string): number {
  const [y1, m1, d1raw] = start.split("-").map(Number);
  const [y2, m2, d2raw] = end.split("-").map(Number);
  const d2 = d2raw === 31 && (d1raw === 30 || d1raw === 31) ? 30 : d2raw;
  const d1 = d1raw === 31 ? 30 : d1raw;
  return (y2 - y1) * 360 + (m2 - m1) * 30 + (d2 - d1);
}

/**
 * Fannie Mae §1103 aggregate amortization, exact: a level payment at r/12
 * over the amortization count, and interest each period at
 * balance × annual rate × (days in the month before the payment) / 360, with
 * nothing rounded until the total.
 */
export function actual360AggregatePrincipal(input: {
  principal: string;
  annualRate: string;
  amortizationPayments: number;
  termPayments: number;
  firstPaymentDate: string;
}): { payment: Q; aggregatePrincipal: Q } {
  const r = qdiv(qs(input.annualRate), q(12));
  const { payment } = levelPayment(input.principal, r, input.amortizationPayments);
  const [fy, fm] = input.firstPaymentDate.split("-").map(Number);
  let balance = qs(input.principal);
  let aggregate = q(0);
  for (let k = 0; k < input.termPayments; k++) {
    // The month before payment k+1: payment months start at the first payment's month.
    const payMonthIndex = fy * 12 + (fm - 1) + k;
    const prev = payMonthIndex - 1;
    const days = monthLength(Math.floor(prev / 12), (prev % 12) + 1);
    const interest = qdiv(qmul(qmul(balance, qs(input.annualRate)), q(days)), q(360));
    const principalPart = qsub(payment, interest);
    aggregate = qadd(aggregate, principalPart);
    balance = qsub(balance, principalPart);
  }
  return { payment, aggregatePrincipal: aggregate };
}

export type Placement = "before-accrual" | "after-accrual";

export type DailyLoanInput = {
  anchorDate: string;
  openingPrincipal: string;
  annualRate: string;
  convention: OracleConvention;
  dailyInterestScale: number;
  chargeDates: string[];
  until: string;
  eventOrder: { scheduledRepayments: Placement; otherPayments: Placement; offsets: Placement };
};

export type DailyLoanRow = { date: string; event: string; amountMinor: bigint; balanceAfterMinor: bigint };

/**
 * A daily-accrual, monthly-charge loan following FR-047's day order, the
 * order Figura's calculator code also uses:
 *
 * - the first day to accrue is the day after the anchor (drawdown);
 * - each day: payments placed before the accrual, then the accrual on the
 *   balance (rounded to `dailyInterestScale` places, half-up), then a charge
 *   if the day is a charge date (the period total rounded to cents,
 *   half-up, capitalized), then payments placed after the accrual;
 * - scheduled repayments (`repayment`) and other payments
 *   (`extra-repayment`, `draw`) are placed independently.
 */
export function simulateDailyLoan(input: DailyLoanInput, events: { date: string; kind: string; amountMinor: number }[]): DailyLoanRow[] {
  let balance = qs(input.openingPrincipal);
  let accrued = q(0);
  const rows: DailyLoanRow[] = [];
  const charges = new Set(input.chargeDates);
  const cents = (x: Q) => (x.n * BigInt(100)) / x.d;
  const placementOf = (kind: string): Placement =>
    kind === "repayment" ? input.eventOrder.scheduledRepayments : input.eventOrder.otherPayments;
  const apply = (day: string, where: Placement) => {
    for (const e of events.filter((p) => p.date === day && placementOf(p.kind) === where)) {
      balance = qadd(balance, q(e.amountMinor, 100));
      rows.push({ date: day, event: e.kind, amountMinor: BigInt(e.amountMinor), balanceAfterMinor: cents(balance) });
    }
  };
  const firstDay = isoOf(utcDay(input.anchorDate) + 1);
  const afterUntil = isoOf(utcDay(input.until) + 1);
  for (const day of eachDay(firstDay, afterUntil)) {
    apply(day, "before-accrual");
    const next = isoOf(utcDay(day) + 1);
    accrued = qadd(accrued, roundHalfAway(qmul(qmul(balance, qs(input.annualRate)), yearFraction(input.convention, day, next)), input.dailyInterestScale));
    if (charges.has(day)) {
      const charge = roundHalfAway(accrued, 2);
      balance = qadd(balance, charge);
      rows.push({ date: day, event: "interest-charge", amountMinor: cents(charge), balanceAfterMinor: cents(balance) });
      accrued = q(0);
    }
    apply(day, "after-accrual");
  }
  return rows;
}
