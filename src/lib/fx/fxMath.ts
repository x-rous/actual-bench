import { FxError } from "./errors";

/**
 * Precise FX arithmetic (RD-056 / PR-025a, FX doc §12–13). Rates are decimal
 * strings; amounts are integer minor units. All conversion/inversion uses BigInt
 * so the FX rate is never rounded before conversion and only the final amount is
 * rounded. No third-party decimal dependency.
 */

const DECIMAL_RE = /^\d+(\.\d+)?$/;

/** Parse a non-negative decimal string into a scaled integer + its scale. */
function parseDecimal(value: string): { int: bigint; scale: number } {
  const trimmed = value.trim();
  if (!DECIMAL_RE.test(trimmed)) {
    throw new FxError("INVALID_RATE", `Malformed decimal: ${value}`);
  }
  const [whole, frac = ""] = trimmed.split(".");
  return { int: BigInt(whole + frac), scale: frac.length };
}

/** True for a syntactically valid, strictly-positive rate. */
export function isValidRate(value: string): boolean {
  try {
    const { int } = parseDecimal(value);
    return int > BigInt(0);
  } catch {
    return false;
  }
}

/**
 * Convert integer minor units by a decimal-string rate, rounding half-up on the
 * final amount only. Preserves the source sign (Actual amounts are signed).
 */
export function convertMinorUnits(sourceMinor: number, rate: string): number {
  if (!Number.isInteger(sourceMinor)) {
    throw new FxError("INVALID_AMOUNT", `Amount must be integer minor units: ${sourceMinor}`);
  }
  const { int: rateInt, scale } = parseDecimal(rate);
  const divisor = BigInt(10) ** BigInt(scale);
  const magnitude = BigInt(Math.abs(sourceMinor)) * rateInt;
  // Round half-up: (magnitude + divisor/2) / divisor.
  const rounded = (magnitude + divisor / BigInt(2)) / divisor;
  const result = Number(rounded);
  return sourceMinor < 0 ? -result : result;
}

/**
 * Invert a rate to `precision` decimal places (FX doc §13). `1 / rate`, used to
 * derive a direct rate from a stored inverse. Returns a trimmed decimal string.
 */
export function invertRate(rate: string, precision = 12): string {
  const { int, scale } = parseDecimal(rate);
  if (int === BigInt(0)) throw new FxError("INVALID_RATE", "Cannot invert a zero rate");
  // 1/rate = 10^scale / int ; scale the numerator up by 10^precision for digits.
  const numerator = BigInt(10) ** BigInt(scale + precision);
  const quotient = numerator / int; // integer with `precision` implied decimals
  const s = quotient.toString().padStart(precision + 1, "0");
  const whole = s.slice(0, s.length - precision);
  const frac = s.slice(s.length - precision).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole;
}

/** Exact `numerator / denominator`, rounded half-up to `precision` places, as a trimmed decimal string. */
function ratioToDecimal(numerator: bigint, denominator: bigint, precision: number): string {
  const factor = BigInt(10) ** BigInt(precision);
  const scaled = (numerator * factor * BigInt(2) + denominator) / (denominator * BigInt(2));
  const digits = scaled.toString().padStart(precision + 1, "0");
  const whole = digits.slice(0, digits.length - precision);
  const frac = digits.slice(digits.length - precision).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole;
}

/** True for a percentage from 0 up to, but not including, 100. */
export function isValidPercent(value: string): boolean {
  try {
    const { int, scale } = parseDecimal(value);
    return int < BigInt(100) * BigInt(10) ** BigInt(scale);
  } catch {
    return false;
  }
}

/**
 * Move a rate by a percentage, for a bank's card or conversion fee. `direction`
 * +1 raises the rate (spending costs more), -1 lowers it (money received is worth
 * less). Exact to 12 places.
 */
export function adjustRateByPercent(rate: string, percent: string, direction: 1 | -1): string {
  const r = parseDecimal(rate);
  const p = parseDecimal(percent);
  const hundred = BigInt(100) * BigInt(10) ** BigInt(p.scale);
  const factor = direction === 1 ? hundred + p.int : hundred - p.int;
  return ratioToDecimal(r.int * factor, BigInt(10) ** BigInt(r.scale) * hundred, 12);
}

/** Exact mean of positive decimal-string rates, to 12 places. */
export function averageRates(rates: readonly string[]): string {
  if (rates.length === 0) throw new FxError("INVALID_RATE", "Cannot average an empty rate list");
  const parsed = rates.map(parseDecimal);
  const scale = Math.max(...parsed.map((p) => p.scale));
  const sum = parsed.reduce((total, p) => total + p.int * BigInt(10) ** BigInt(scale - p.scale), BigInt(0));
  return ratioToDecimal(sum, BigInt(rates.length) * BigInt(10) ** BigInt(scale), 12);
}

/** The rate implied by two amounts in minor units: `|target| / |source|`, to 8 places. */
export function impliedRate(sourceMinor: number, targetMinor: number): string {
  if (!Number.isInteger(sourceMinor) || !Number.isInteger(targetMinor) || sourceMinor === 0 || targetMinor === 0) {
    throw new FxError("INVALID_AMOUNT", "Both amounts must be non-zero integer minor units.");
  }
  return ratioToDecimal(BigInt(Math.abs(targetMinor)), BigInt(Math.abs(sourceMinor)), 8);
}
