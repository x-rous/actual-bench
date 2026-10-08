/**
 * Exact rationals for the RD-084 reference oracle.
 *
 * Deliberately a different technique from the production money kernel
 * (fixed-point decimals): every value here is an exact fraction, so a
 * disagreement between the two points at one of them rather than at a shared
 * rounding habit. Test-only; never imported by production code.
 */
export type Q = { n: bigint; d: bigint };

const Z = BigInt(0);
const I = BigInt(1);

function gcd(a: bigint, b: bigint): bigint {
  let x = a < Z ? -a : a;
  let y = b < Z ? -b : b;
  while (y !== Z) [x, y] = [y, x % y];
  return x;
}

export function q(n: bigint | number, d: bigint | number = 1): Q {
  let nn = BigInt(n);
  let dd = BigInt(d);
  if (dd === Z) throw new Error("zero denominator");
  if (dd < Z) {
    nn = -nn;
    dd = -dd;
  }
  const g = gcd(nn, dd) || I;
  return { n: nn / g, d: dd / g };
}

/** "600000", "0.045", "-12.5" → exact fraction. */
export function qs(text: string): Q {
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(text);
  if (!m) throw new Error(`bad decimal ${text}`);
  const frac = m[3] ?? "";
  const n = BigInt(m[2] + frac) * (m[1] ? -I : I);
  return q(n, BigInt(10) ** BigInt(frac.length));
}

export const qadd = (a: Q, b: Q) => q(a.n * b.d + b.n * a.d, a.d * b.d);
export const qsub = (a: Q, b: Q) => q(a.n * b.d - b.n * a.d, a.d * b.d);
export const qmul = (a: Q, b: Q) => q(a.n * b.n, a.d * b.d);
export const qdiv = (a: Q, b: Q) => q(a.n * b.d, a.d * b.n);
export const qcmp = (a: Q, b: Q) => {
  const l = a.n * b.d;
  const r = b.n * a.d;
  return l < r ? -1 : l > r ? 1 : 0;
};

/** a^e exactly. A reduced fraction stays reduced under powers, so no gcd is needed. */
export function qpow(a: Q, e: number): Q {
  const k = BigInt(Math.abs(e));
  const out = { n: a.n ** k, d: a.d ** k };
  return e >= 0 ? out : qdiv(q(1), out);
}

/** Round to `digits` decimals, ties away from zero, as a scaled integer. */
export function roundHalfAwayScaled(a: Q, digits: number): bigint {
  const scaled = qmul(a, q(BigInt(10) ** BigInt(digits)));
  const neg = scaled.n < Z;
  const n = neg ? -scaled.n : scaled.n;
  const v = (BigInt(2) * n + scaled.d) / (BigInt(2) * scaled.d);
  return neg ? -v : v;
}

export function roundHalfAway(a: Q, digits: number): Q {
  return q(roundHalfAwayScaled(a, digits), BigInt(10) ** BigInt(digits));
}

/**
 * The `k`th root of `a > 0` by bisection on rationals until the bracket is
 * narrower than 10^-digits. Returns the lower bound. A different algorithm
 * from the kernel's Newton root on purpose.
 */
export function qroot(a: Q, k: number, digits: number): Q {
  let lo = q(0);
  let hi = qcmp(a, q(1)) > 0 ? a : q(1);
  const width = q(1, BigInt(10) ** BigInt(digits + 2));
  while (qcmp(qsub(hi, lo), width) > 0) {
    const mid = qdiv(qadd(lo, hi), q(2));
    // Keep fractions small: snap the midpoint to a decimal grid finer than the target.
    const snapped = q(roundHalfAwayScaled(mid, digits + 4), BigInt(10) ** BigInt(digits + 4));
    if (qcmp(qpow(snapped, k), a) <= 0) lo = snapped;
    else hi = snapped;
    if (qcmp(lo, hi) >= 0) break;
  }
  return lo;
}

export function qToFixed(a: Q, digits: number): string {
  const v = roundHalfAwayScaled(a, digits);
  const neg = v < Z;
  const s = (neg ? -v : v).toString().padStart(digits + 1, "0");
  return `${neg ? "-" : ""}${s.slice(0, s.length - digits)}${digits ? "." + s.slice(s.length - digits) : ""}`;
}
