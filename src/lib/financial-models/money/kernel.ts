import { assertScale, divRoundInt, pow10, round, type RoundingMode } from "./rounding";

/**
 * Exact fixed-point decimal arithmetic for RD-084 (research R-01, FR-155).
 *
 * A `Dec` is `int × 10^-scale` on `BigInt`. Addition, subtraction and
 * multiplication are exact; the scale of the result is whatever the operands
 * need, so nothing is rounded unless the caller asks for it. Division, powers
 * and roots take an explicit scale (and, where a result can tie, an explicit
 * rounding mode), because their exact results can have unbounded digits.
 *
 * No `number` ever carries a fractional value here. Numbers cross in and out
 * only as integers: minor units (`fromMinor` / `toMinor`) and small counts such
 * as exponents and scales.
 *
 * The behavior of every function below is `money-kernel@1`. Anything that would
 * change a result, including a rounding tie or the digits a root returns, is a
 * new kernel version, never an edit to this one (FR-181, FR-183).
 */
export type Dec = { readonly int: bigint; readonly scale: number };

export const MONEY_KERNEL_VERSION = "money-kernel@1";

/**
 * Decimal places kept for intermediate results unless a calculation profile
 * says otherwise. Versioned with the kernel and recorded in every snapshot.
 */
export const WORKING_SCALE = 30;

/** Guard on Newton iterations. Integer Newton from above converges long before this. */
export const NTH_ROOT_ITERATION_CAP = 10_000;

const ZERO = BigInt(0);
const ONE = BigInt(1);

const DECIMAL_RE = /^(-)?(\d+)(?:\.(\d+))?$/;

/** Parse a decimal string such as `"0.0449"`, `"-12.5"` or `"100"`. Scale is the written digits. */
export function dec(value: string): Dec {
  if (typeof value !== "string") throw new TypeError("dec() takes a decimal string, never a number");
  const match = DECIMAL_RE.exec(value.trim());
  if (!match) throw new RangeError(`Not a decimal: ${JSON.stringify(value)}`);
  const [, minus, whole, frac = ""] = match;
  const int = BigInt(whole + frac);
  return { int: minus ? -int : int, scale: frac.length };
}

/** An integer as a `Dec` at scale 0. Rejects fractional and unsafe numbers. */
export function decInt(value: number | bigint): Dec {
  if (typeof value === "number" && !Number.isSafeInteger(value)) {
    throw new RangeError(`decInt needs a safe integer, got ${value}`);
  }
  return { int: BigInt(value), scale: 0 };
}

export const DEC_ZERO: Dec = { int: ZERO, scale: 0 };
export const DEC_ONE: Dec = { int: ONE, scale: 0 };

function align(a: Dec, b: Dec): [bigint, bigint, number] {
  if (a.scale === b.scale) return [a.int, b.int, a.scale];
  if (a.scale > b.scale) return [a.int, b.int * pow10(a.scale - b.scale), a.scale];
  return [a.int * pow10(b.scale - a.scale), b.int, b.scale];
}

export function add(a: Dec, b: Dec): Dec {
  const [x, y, scale] = align(a, b);
  return { int: x + y, scale };
}

export function sub(a: Dec, b: Dec): Dec {
  const [x, y, scale] = align(a, b);
  return { int: x - y, scale };
}

/**
 * Exact product (scale `a.scale + b.scale`), or rounded to `scale` by `mode`
 * when both are given. A scale without a mode is refused: a silent default
 * rounding is the mistake this kernel exists to prevent.
 */
export function mul(a: Dec, b: Dec, scale?: number, mode?: RoundingMode): Dec {
  const exact: Dec = { int: a.int * b.int, scale: a.scale + b.scale };
  if (scale === undefined && mode === undefined) return exact;
  if (scale === undefined || mode === undefined) throw new RangeError("mul() takes a scale and a mode together");
  return round(exact, scale, mode);
}

/** `a / b` to `scale` decimal places, rounded once by `mode`. */
export function div(a: Dec, b: Dec, scale: number, mode: RoundingMode): Dec {
  assertScale(scale);
  if (b.int === ZERO) throw new RangeError("Division by zero");
  // a/b = (a.int / b.int) × 10^(b.scale - a.scale); scale the numerator so the
  // single integer division lands on `scale` digits.
  const shift = scale + b.scale - a.scale;
  const numerator = shift >= 0 ? a.int * pow10(shift) : a.int;
  const denominator = shift >= 0 ? b.int : b.int * pow10(-shift);
  return { int: divRoundInt(numerator, denominator, mode), scale };
}

export function cmp(a: Dec, b: Dec): -1 | 0 | 1 {
  const [x, y] = align(a, b);
  return x < y ? -1 : x > y ? 1 : 0;
}

export function neg(a: Dec): Dec {
  return { int: -a.int, scale: a.scale };
}

export function abs(a: Dec): Dec {
  return a.int < ZERO ? neg(a) : a;
}

export function sign(a: Dec): -1 | 0 | 1 {
  return a.int < ZERO ? -1 : a.int > ZERO ? 1 : 0;
}

export function isZero(a: Dec): boolean {
  return a.int === ZERO;
}

export function min(a: Dec, b: Dec): Dec {
  return cmp(a, b) <= 0 ? a : b;
}

export function max(a: Dec, b: Dec): Dec {
  return cmp(a, b) >= 0 ? a : b;
}

/** Re-express `a` at a larger scale without changing its value. */
export function rescale(a: Dec, scale: number): Dec {
  assertScale(scale);
  if (scale < a.scale) throw new RangeError("rescale() only widens; use round() to drop digits");
  return { int: a.int * pow10(scale - a.scale), scale };
}

/** The decimal string of `a` at its own scale (`"-0.0100"` stays as written). */
export function toDecString(a: Dec): string {
  const negative = a.int < ZERO;
  const digits = (negative ? -a.int : a.int).toString().padStart(a.scale + 1, "0");
  const whole = digits.slice(0, digits.length - a.scale);
  const frac = a.scale > 0 ? `.${digits.slice(digits.length - a.scale)}` : "";
  return `${negative ? "-" : ""}${whole}${frac}`;
}

/** The shortest decimal string for `a`: trailing fractional zeros removed. */
export function toPlainString(a: Dec): string {
  const s = toDecString(a);
  if (a.scale === 0) return s;
  const trimmed = s.replace(/0+$/, "").replace(/\.$/, "");
  return trimmed === "-0" ? "0" : trimmed;
}

/**
 * `a^n`, correctly rounded to `scale` by `mode`: the exact power is formed
 * first (repeated squaring on integers) and rounded once. A negative `n`
 * divides one by the exact power, again rounding once.
 */
export function powInt(a: Dec, n: number, scale: number, mode: RoundingMode = "half-even"): Dec {
  if (!Number.isSafeInteger(n)) throw new RangeError(`powInt needs an integer exponent, got ${n}`);
  assertScale(scale);
  const exact = exactPow(a, Math.abs(n));
  if (n >= 0) return round(exact, scale, mode);
  return div(DEC_ONE, exact, scale, mode);
}

function exactPow(a: Dec, n: number): Dec {
  let result = ONE;
  let base = a.int;
  let e = n;
  while (e > 0) {
    if (e % 2 === 1) result *= base;
    e = Math.floor(e / 2);
    if (e > 0) base *= base;
  }
  return { int: result, scale: a.scale * n };
}

/**
 * The `n`th root of a non-negative `a`, **truncated** to `scale` decimal
 * places: the largest `x` at that scale with `x^n <= a`. Computed as an exact
 * integer root by Newton's method from above, so the same inputs always give
 * the same digits. Callers wanting a rounded root compute at a wider scale and
 * round.
 */
export function nthRoot(a: Dec, n: number, scale: number): Dec {
  if (!Number.isSafeInteger(n) || n < 1) throw new RangeError(`nthRoot needs a positive integer degree, got ${n}`);
  assertScale(scale);
  if (a.int < ZERO) throw new RangeError("nthRoot of a negative value");
  // root(a) at `scale` = floor(root(a.int × 10^(n·scale − a.scale))) × 10^-scale.
  // Truncating the radicand first is safe: floor(root(y)) = floor(root(floor(y))).
  const shift = n * scale - a.scale;
  const radicand = shift >= 0 ? a.int * pow10(shift) : a.int / pow10(-shift);
  return { int: integerRoot(radicand, n), scale };
}

function integerRoot(value: bigint, n: number): bigint {
  if (value < BigInt(2) || n === 1) return value;
  const big = BigInt(n);
  const bigMinusOne = BigInt(n - 1);
  // Start from a power of two at or above the root, then descend monotonically.
  let x = ONE << BigInt(Math.ceil(value.toString(2).length / n));
  for (let i = 0; i < NTH_ROOT_ITERATION_CAP; i++) {
    const next = (bigMinusOne * x + value / x ** bigMinusOne) / big;
    if (next >= x) return x;
    x = next;
  }
  throw new RangeError(`nthRoot did not converge within ${NTH_ROOT_ITERATION_CAP} iterations`);
}

/** Integer minor units as a `Dec` (`1234`, 2 digits → `12.34`). */
export function fromMinor(minor: number, digits: number): Dec {
  if (!Number.isSafeInteger(minor)) throw new RangeError(`Minor units must be a safe integer, got ${minor}`);
  assertScale(digits);
  return { int: BigInt(minor), scale: digits };
}

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

/**
 * `value` rounded to `digits` decimal places by `mode`, as integer minor units.
 * Throws when the result falls outside the safe-integer range instead of
 * returning an imprecise number.
 */
export function toMinor(value: Dec, digits: number, mode: RoundingMode): number {
  const rounded = round(value, digits, mode);
  if (rounded.int > MAX_SAFE || rounded.int < -MAX_SAFE) {
    throw new RangeError(`${toDecString(value)} is outside the safe minor-unit range`);
  }
  return Number(rounded.int);
}

export { round, type RoundingMode };
