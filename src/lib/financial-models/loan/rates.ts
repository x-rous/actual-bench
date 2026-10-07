import { compareDates, isIsoDate, type IsoDate } from "../calendar/dates";
import { dec, div, max, min, mul, nthRoot, sub, WORKING_SCALE, DEC_ONE, type Dec } from "../money/kernel";
import { pow10, round } from "../money/rounding";

/**
 * Rates: effective-dated lookup (FR-043) and quoted-rate conventions (FR-037).
 *
 * How a rate is quoted is independent of how days are counted. The quote
 * convention turns an annual rate into the rate for one repayment period;
 * the day count (./daycount) turns it into interest for a span of days. The
 * two are never folded together.
 */

export const RATES_VERSION = "rates@1";
export const RATE_QUOTE_VERSION = "rate-quote@1";

/** One effective-dated rate row (data-model `debt_rate_periods`). Rates are decimal strings. */
export type RatePeriod = {
  accrualEffectiveFrom: IsoDate;
  annualRateDecimal: string;
  announcedAt?: IsoDate | null;
  /** Per-change recast override (a `RecastPolicy`); null uses the profile's. */
  paymentRecalcPolicy?: string | null;
  /** When the recalculated payment starts; may differ from the accrual date (FR-044). */
  paymentEffectiveFrom?: IsoDate | null;
  /** Limits on the rate itself. */
  rateCapDecimal?: string | null;
  rateFloorDecimal?: string | null;
  /** Limit on the payment; never a rate limit (decision 2026-09-29). */
  paymentCap?: PaymentLimit | null;
  source?: string | null;
  note?: string | null;
};

/**
 * A cap on a recalculated payment: an absolute amount, or a factor of the
 * previous scheduled payment (`1.075` caps an increase at 7.5%). Factors are
 * exact decimal strings.
 */
export type PaymentLimit =
  | { kind: "absolute"; amountMinor: number }
  | { kind: "previous-payment-factor"; factor: string };

export const PAYMENT_LIMIT_KINDS: readonly PaymentLimit["kind"][] = ["absolute", "previous-payment-factor"];

export type RateLookup =
  | { ok: true; rate: Dec; period: RatePeriod }
  | { ok: false; code: "rate-gap"; date: IsoDate };

function checkPeriods(periods: readonly RatePeriod[]): RatePeriod[] {
  const sorted = [...periods].sort((a, b) => compareDates(a.accrualEffectiveFrom, b.accrualEffectiveFrom));
  for (let i = 0; i < sorted.length; i++) {
    const p = sorted[i];
    if (!isIsoDate(p.accrualEffectiveFrom)) throw new RangeError(`Bad accrual effective date: ${p.accrualEffectiveFrom}`);
    dec(p.annualRateDecimal);
    if (i > 0 && sorted[i - 1].accrualEffectiveFrom === p.accrualEffectiveFrom) {
      throw new RangeError(`Two rates take effect on ${p.accrualEffectiveFrom}`);
    }
  }
  return sorted;
}

/** The rate a period's cap and floor allow. */
function effectiveRate(period: RatePeriod): Dec {
  let rate = dec(period.annualRateDecimal);
  if (period.rateFloorDecimal) rate = max(rate, dec(period.rateFloorDecimal));
  if (period.rateCapDecimal) rate = min(rate, dec(period.rateCapDecimal));
  return rate;
}

/**
 * The annual rate accruing on `date`: the latest row effective on or before
 * it, held within that row's cap and floor. A date before every row is a
 * rate gap, which blocks calculation rather than guessing a rate.
 */
export function rateOn(periods: readonly RatePeriod[], date: IsoDate): RateLookup {
  const sorted = checkPeriods(periods);
  let found: RatePeriod | null = null;
  for (const p of sorted) {
    if (compareDates(p.accrualEffectiveFrom, date) <= 0) found = p;
    else break;
  }
  return found ? { ok: true, rate: effectiveRate(found), period: found } : { ok: false, code: "rate-gap", date };
}

export type RateSegment = { from: IsoDate; to: IsoDate; rate: Dec; period: RatePeriod };

/** [from, to) split wherever a new rate takes effect; a gap anywhere blocks the whole span. */
export function rateSegments(
  periods: readonly RatePeriod[],
  from: IsoDate,
  to: IsoDate
): { ok: true; segments: RateSegment[] } | { ok: false; code: "rate-gap"; date: IsoDate } {
  if (compareDates(from, to) > 0) throw new RangeError(`Span ends before it starts: ${from} to ${to}`);
  const sorted = checkPeriods(periods);
  const first = rateOn(sorted, from);
  if (!first.ok) return first;
  const segments: RateSegment[] = [];
  let start = from;
  let current = first.period;
  for (const p of sorted) {
    if (compareDates(p.accrualEffectiveFrom, from) <= 0) continue;
    if (compareDates(p.accrualEffectiveFrom, to) >= 0) break;
    segments.push({ from: start, to: p.accrualEffectiveFrom, rate: effectiveRate(current), period: current });
    start = p.accrualEffectiveFrom;
    current = p;
  }
  if (compareDates(start, to) < 0) segments.push({ from: start, to, rate: effectiveRate(current), period: current });
  return { ok: true, segments };
}

// ─── Quoted-rate conventions (FR-037) ─────────────────────────────────────────

export type RateQuote =
  | "nominal-simple-periodic"
  | "nominal-compounded-monthly"
  | "nominal-compounded-semiannual"
  | "annual-effective";

export const RATE_QUOTES: readonly RateQuote[] = [
  "nominal-simple-periodic",
  "nominal-compounded-monthly",
  "nominal-compounded-semiannual",
  "annual-effective",
];

/** Extra digits carried before the final half-even rounding of a compounded rate. */
const ROOT_GUARD_DIGITS = 10;

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/**
 * The rate for one repayment period when `paymentsPerYear` payments are made.
 *
 * - `nominal-simple-periodic`: r / k.
 * - `nominal-compounded-monthly`: (1 + r/12)^(12/k) − 1.
 * - `nominal-compounded-semiannual` (Canadian j2): (1 + r/2)^(2/k) − 1.
 * - `annual-effective`: (1 + r)^(1/k) − 1.
 *
 * When compounding and payment frequencies match, the result is r/m exactly
 * (then rounded). Otherwise the power is formed as an exact ratio of integers,
 * its root taken exactly to `scale + 10` places (truncated) and the result
 * rounded half-even to `scale`.
 */
export function periodicRate(quote: RateQuote, annualRate: Dec, paymentsPerYear: number, scale: number = WORKING_SCALE): Dec {
  if (!Number.isInteger(paymentsPerYear) || paymentsPerYear < 1) {
    throw new RangeError(`Payments per year must be a positive integer, got ${paymentsPerYear}`);
  }
  const k = paymentsPerYear;
  if (quote === "nominal-simple-periodic") return div(annualRate, { int: BigInt(k), scale: 0 }, scale, "half-even");
  const m = quote === "nominal-compounded-monthly" ? 12 : quote === "nominal-compounded-semiannual" ? 2 : quote === "annual-effective" ? 1 : 0;
  if (m === 0) throw new RangeError(`Unknown rate quote: ${String(quote)}`);
  if (m === k) return div(annualRate, { int: BigInt(m), scale: 0 }, scale, "half-even");

  // (1 + r/m)^(p/q) with p/q = m/k reduced. With r = R·10^-s:
  // 1 + r/m = (m·10^s + R) / (m·10^s), so the p-th power is N / D exactly.
  const g = gcd(m, k);
  const p = m / g;
  const q = k / g;
  const base = BigInt(m) * pow10(annualRate.scale);
  const numerator = (base + annualRate.int) ** BigInt(p);
  const denominator = base ** BigInt(p);
  const wide = scale + ROOT_GUARD_DIGITS;
  // q-th root of N/D to `wide` places: floor(root(N·10^(q·wide) / D)) at scale `wide`.
  const radicand: Dec = { int: (numerator * pow10(q * wide)) / denominator, scale: q * wide };
  const growth = nthRoot(radicand, q, wide);
  return round(sub(growth, DEC_ONE), scale, "half-even");
}

/** Effective annual rate of a quote: (1 + r/m)^m − 1; `nominal-simple-periodic` has none. */
export function effectiveAnnualRate(quote: Exclude<RateQuote, "nominal-simple-periodic">, annualRate: Dec, scale: number = WORKING_SCALE): Dec {
  const m = quote === "nominal-compounded-monthly" ? 12 : quote === "nominal-compounded-semiannual" ? 2 : 1;
  const base = BigInt(m) * pow10(annualRate.scale);
  const numerator = (base + annualRate.int) ** BigInt(m) - base ** BigInt(m);
  return div({ int: numerator, scale: 0 }, { int: base ** BigInt(m), scale: 0 }, scale, "half-even");
}

export function isRateQuote(value: string): value is RateQuote {
  return (RATE_QUOTES as readonly string[]).includes(value);
}


/**
 * Interest for one period at a quote's periodic rate, rounded once. When the
 * periodic rate is an exact ratio (a simple periodic quote, or compounding at
 * the payment frequency: r ÷ k), the product is formed exactly as
 * `balance × r ÷ k`, so a result that should be a whole number of minor units
 * is one. Only compounded conversions, whose rate is irrational, go through
 * the rate at `scale` places.
 */
export function periodInterestAt(quote: RateQuote, annualRate: Dec, paymentsPerYear: number, balance: Dec, scale: number, mode: Parameters<typeof round>[2]): Dec {
  if (!Number.isInteger(paymentsPerYear) || paymentsPerYear < 1) {
    throw new RangeError(`Payments per year must be a positive integer, got ${paymentsPerYear}`);
  }
  const m = quote === "nominal-compounded-monthly" ? 12 : quote === "nominal-compounded-semiannual" ? 2 : quote === "annual-effective" ? 1 : 0;
  if (quote === "nominal-simple-periodic" || m === paymentsPerYear) {
    return div(mul(balance, annualRate), { int: BigInt(paymentsPerYear), scale: 0 }, scale, mode);
  }
  return round(mul(balance, periodicRate(quote, annualRate, paymentsPerYear, WORKING_SCALE + ROOT_GUARD_DIGITS)), scale, mode);
}
