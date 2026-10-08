import type { Dec } from "./kernel";

/**
 * Rounding for the money kernel (FR-046, FR-155).
 *
 * Every mode is symmetric about zero, so a negative amount rounds to the
 * negation of its magnitude's result and a sign is never lost:
 *
 *   half-up    ties away from zero        2.5 → 3, −2.5 → −3
 *   half-even  ties to the even neighbour 2.5 → 2, 3.5 → 4, −2.5 → −2
 *   up         away from zero            2.1 → 3, −2.1 → −3
 *   down       toward zero (truncate)    2.9 → 2, −2.9 → −2
 *
 * Part of `money-kernel@1`: changing what any mode does is a kernel version bump.
 */
export type RoundingMode = "half-up" | "half-even" | "up" | "down";

export const ROUNDING_MODES: readonly RoundingMode[] = ["half-up", "half-even", "up", "down"];

const ZERO = BigInt(0);
const ONE = BigInt(1);
const TWO = BigInt(2);
const TEN = BigInt(10);

export function pow10(n: number): bigint {
  if (!Number.isInteger(n) || n < 0) throw new RangeError(`pow10 needs a non-negative integer, got ${n}`);
  return TEN ** BigInt(n);
}

/** `numerator / denominator` rounded to an integer by `mode`. */
export function divRoundInt(numerator: bigint, denominator: bigint, mode: RoundingMode): bigint {
  if (denominator === ZERO) throw new RangeError("Division by zero");
  const negative = numerator < ZERO !== denominator < ZERO;
  const n = numerator < ZERO ? -numerator : numerator;
  const d = denominator < ZERO ? -denominator : denominator;
  let q = n / d;
  const r = n % d;
  if (r !== ZERO) {
    switch (mode) {
      case "down":
        break;
      case "up":
        q += ONE;
        break;
      case "half-up":
        if (r * TWO >= d) q += ONE;
        break;
      case "half-even": {
        const twice = r * TWO;
        if (twice > d || (twice === d && q % TWO === ONE)) q += ONE;
        break;
      }
      default:
        throw new RangeError(`Unknown rounding mode: ${String(mode)}`);
    }
  }
  return negative ? -q : q;
}

/**
 * `a` rounded to `scale` decimal places. A value already at or below that scale
 * is only re-expressed at it: rounding never happens unless digits are dropped.
 */
export function round(a: Dec, scale: number, mode: RoundingMode): Dec {
  assertScale(scale);
  if (a.scale <= scale) return { int: a.int * pow10(scale - a.scale), scale };
  return { int: divRoundInt(a.int, pow10(a.scale - scale), mode), scale };
}

export function assertScale(scale: number): void {
  if (!Number.isInteger(scale) || scale < 0) throw new RangeError(`Scale must be a non-negative integer, got ${scale}`);
}
