import { dayCount, eachDay, levelPayment, periodicRate, yearFraction, type OracleConvention } from "./conventions";
import { q, qadd, qcmp, qdiv, qmul, qs, qsub, roundHalfAwayScaled, type Q } from "./rational";

/**
 * Reference schedules for the RD-084 golden suite (T068), written from the
 * spec's formulas (FR-036, FR-039, FR-043–FR-048, FR-055–FR-058, V3 §10) with
 * exact rationals and plain loops. Payment-numbered for periodic loans and
 * day-walked for daily ones; nothing here imports the engine it checks.
 */

export type Mode = "half-up" | "half-even" | "up" | "down";

/** Round `x` to `digits` places by `mode` (ties and directions symmetric about zero). */
export function rnd(x: Q, digits: number, mode: Mode): Q {
  const scale = BigInt(10) ** BigInt(digits);
  const scaled = qmul(x, q(scale));
  const neg = scaled.n < BigInt(0);
  const n = neg ? -scaled.n : scaled.n;
  const d = scaled.d;
  let whole = n / d;
  const rem = n % d;
  if (rem !== BigInt(0)) {
    if (mode === "up") whole += BigInt(1);
    else if (mode === "half-up" && rem * BigInt(2) >= d) whole += BigInt(1);
    else if (mode === "half-even" && (rem * BigInt(2) > d || (rem * BigInt(2) === d && whole % BigInt(2) === BigInt(1)))) whole += BigInt(1);
  }
  return q(neg ? -whole : whole, scale);
}

export const minorOf = (x: Q, digits = 2) => Number(roundHalfAwayScaled(x, digits));

// ─── Periodic (payment-numbered) ─────────────────────────────────────────────

export type PeriodicSpec = {
  principal: string;
  annualRate: string;
  /** Payments per year and the quote's compounding periods per year (12 simple monthly, 2 for j2). */
  paymentsPerYear: number;
  compoundsPerYear: number;
  /** Payments in the contract and on the amortization basis. */
  contractPayments: number;
  amortizationPayments: number;
  digits?: number;
  paymentRounding: Mode;
  interestRounding: Mode;
  carry?: boolean;
  /** Rate changes by payment number (the new rate first accrues for that payment). */
  rateChanges?: { payment: number; annualRate: string; recast: boolean; capFactor?: string }[];
  annualRecast?: boolean;
  /** Payments at which the level payment is recomputed at the rate then in force (a delayed payment change). */
  recastAt?: number[];
  interestOnlyPayments?: number;
  constantPrincipal?: boolean;
  fixedPayment?: string;
  feePerPayment?: string;
  finalPolicy: "true-up-to-zero" | "contractual-balloon" | "keep-level-payment-with-residual" | "continue-until-paid";
  negativeAmortizationAllowed?: boolean;
};

export type PeriodicRow = { n: number; payment: number; interest: number; principal: number; fee: number; balance: number };

export type PeriodicResult = { rows: PeriodicRow[]; balloon: number; residual: number; blockedAt: number | null };

export function periodicSchedule(spec: PeriodicSpec): PeriodicResult {
  const digits = spec.digits ?? 2;
  const cents = (x: Q, mode: Mode) => rnd(x, digits, mode);
  const toMinor = (x: Q) => Number(roundHalfAwayScaled(x, digits));
  let rate = spec.annualRate;
  const rateCache = new Map<string, Q>();
  const periodic = () => {
    let r = rateCache.get(rate);
    if (!r) rateCache.set(rate, (r = periodicRate(rate, spec.compoundsPerYear, spec.paymentsPerYear, 50)));
    return r;
  };
  let balance = qs(spec.principal);
  let carry = q(0);
  const fee = spec.feePerPayment ? qs(spec.feePerPayment) : q(0);
  const io = spec.interestOnlyPayments ?? 0;
  const annuity = (b: Q, n: number) => cents(levelPayment(qTo(b, digits), periodic(), n).payment, spec.paymentRounding);
  let payment: Q | null = spec.fixedPayment ? qs(spec.fixedPayment) : spec.constantPrincipal || io > 0 ? null : annuity(balance, spec.amortizationPayments);
  const installment = spec.constantPrincipal ? cents(qdiv(qs(spec.principal), q(spec.amortizationPayments)), spec.paymentRounding) : null;
  const rows: PeriodicRow[] = [];
  let balloon = 0;
  let residual = 0;
  const lastN = spec.finalPolicy === "continue-until-paid" ? spec.contractPayments + 2000 : spec.contractPayments;
  for (let n = 1; n <= lastN; n++) {
    const change = spec.rateChanges?.find((c) => c.payment === n);
    if (change) {
      rate = change.annualRate;
      if (change.recast && !spec.fixedPayment) {
        const fresh = annuity(balance, spec.amortizationPayments - (n - 1));
        const capped = change.capFactor && payment ? cents(qmul(payment, qs(change.capFactor)), spec.paymentRounding) : null;
        payment = capped && qcmp(capped, fresh) < 0 ? capped : fresh;
      }
    } else if (spec.annualRecast && n > 1 && (n - 1) % spec.paymentsPerYear === 0 && !spec.fixedPayment && n > io) {
      payment = annuity(balance, spec.amortizationPayments - (n - 1));
    }
    if (io > 0 && n === io + 1) payment = annuity(balance, spec.amortizationPayments - io);
    if (spec.recastAt?.includes(n)) payment = annuity(balance, spec.amortizationPayments - (n - 1));

    const exact = qadd(qmul(balance, periodic()), carry);
    const interest = cents(exact, spec.interestRounding);
    carry = spec.carry ? qsub(exact, interest) : q(0);
    let level = n <= io ? interest : installment ? qadd(installment, interest) : (payment as Q);
    const owed = qadd(balance, interest);
    const contractFinal = n === spec.contractPayments;
    let paidOff = false;
    if (qcmp(level, owed) >= 0) {
      level = owed;
      paidOff = true;
    } else if (contractFinal && spec.finalPolicy === "true-up-to-zero") {
      level = owed;
      paidOff = true;
    }
    if (qcmp(level, interest) < 0 && !spec.negativeAmortizationAllowed && n > io) return { rows, balloon, residual, blockedAt: n };
    balance = qsub(owed, level);
    rows.push({ n, payment: toMinor(qadd(level, fee)), interest: toMinor(interest), principal: toMinor(qsub(level, interest)), fee: toMinor(fee), balance: toMinor(balance) });
    if (paidOff) break;
    if (contractFinal && spec.finalPolicy === "contractual-balloon") {
      balloon = toMinor(balance);
      balance = q(0);
      break;
    }
    if (contractFinal && spec.finalPolicy === "keep-level-payment-with-residual") {
      residual = toMinor(balance);
      break;
    }
  }
  return { rows, balloon, residual, blockedAt: null };
}

function qTo(x: Q, digits: number): string {
  // Balances are whole minor units here; print exactly.
  const v = roundHalfAwayScaled(x, digits);
  const s = (v < BigInt(0) ? -v : v).toString().padStart(digits + 1, "0");
  return `${v < BigInt(0) ? "-" : ""}${s.slice(0, s.length - digits)}${digits ? "." + s.slice(s.length - digits) : ""}`;
}

// ─── Daily (day-walked) ──────────────────────────────────────────────────────

type Place = "before" | "after";

export type DailySpec = {
  anchorDate: string;
  principal: string;
  convention: OracleConvention;
  rates: { from: string; annualRate: string }[];
  /** Charge dates, or "at-repayment" to charge with each scheduled repayment. */
  charges: string[] | "at-repayment";
  scheduled: { date: string; amount: string }[];
  events?: { date: string; kind: "extra" | "draw" | "fee-capitalized" | "offset"; amount: string; account?: string }[];
  offsets?: { account: string; bps: number; cap?: string; from: string; to?: string }[];
  order: { scheduled: Place; other: Place; offsets: Place };
  compounded?: boolean;
  /** Places a day's interest is held to (null keeps it exact); and the mode. */
  dayScale: number | null;
  dayMode: Mode;
  postingMode: Mode;
  carry?: boolean;
  until: string;
  digits?: number;
};

export type DailyRow = { date: string; kind: string; amount: number; balance: number };

/**
 * FR-047's day in plain terms: extra repayments, draws and offsets placed
 * before the accrual; the accrual on the debt net of offsets (plus accrued
 * interest when compounded); the charge on a charge date covering the days
 * since the last one; then anything placed after the accrual. A scheduled
 * repayment with interest charged at repayment first charges the accrued
 * interest. The first day to accrue is the day after the anchor.
 */
export function dailySchedule(spec: DailySpec): DailyRow[] {
  const digits = spec.digits ?? 2;
  let debt = qs(spec.principal);
  let accrued = q(0);
  let carry = q(0);
  const offsetBal = new Map<string, Q>();
  const rows: DailyRow[] = [];
  const minor = (x: Q) => Number(roundHalfAwayScaled(x, digits));
  const chargeSet = spec.charges === "at-repayment" ? null : new Set(spec.charges);
  const sortedRates = [...spec.rates].sort((a, b) => dayCount(b.from, a.from));
  const rateOn = (d: string) => {
    let r: string | null = null;
    for (const x of sortedRates) if (dayCount(x.from, d) >= 0) r = x.annualRate;
    return r;
  };
  const post = () => {
    const total = qadd(accrued, carry);
    const charged = rnd(total, digits, spec.postingMode);
    carry = spec.carry ? qsub(total, charged) : q(0);
    accrued = q(0);
    debt = qadd(debt, charged);
    return charged;
  };
  const apply = (date: string, where: Place) => {
    for (const e of spec.events ?? []) {
      if (e.date !== date) continue;
      const place = e.kind === "offset" ? spec.order.offsets : spec.order.other;
      if (place !== where) continue;
      if (e.kind === "offset") offsetBal.set(e.account!, qs(e.amount));
      else if (e.kind === "extra") { debt = qsub(debt, qs(e.amount)); rows.push({ date, kind: "extra-repayment", amount: -minor(qs(e.amount)), balance: minor(debt) }); }
      else if (e.kind === "draw") { debt = qadd(debt, qs(e.amount)); rows.push({ date, kind: "draw", amount: minor(qs(e.amount)), balance: minor(debt) }); }
      else { debt = qadd(debt, qs(e.amount)); rows.push({ date, kind: "fee", amount: minor(qs(e.amount)), balance: minor(debt) }); }
    }
    if (spec.order.scheduled === where) {
      for (const s of spec.scheduled.filter((x) => x.date === date)) {
        const interest = chargeSet === null ? post() : q(0);
        debt = qsub(debt, qs(s.amount));
        rows.push({ date, kind: "repayment", amount: -minor(qs(s.amount)), balance: minor(debt) });
        if (chargeSet === null) rows[rows.length - 1] = { ...rows[rows.length - 1], kind: `repayment+interest:${minor(interest)}` };
      }
    }
  };
  // Offset balances known on or before the anchor are part of the starting state.
  for (const e of spec.events ?? []) if (e.kind === "offset" && dayCount(e.date, spec.anchorDate) >= 0) offsetBal.set(e.account!, qs(e.amount));
  for (const date of eachDay(addDay(spec.anchorDate), addDay(spec.until))) {
    apply(date, "before");
    const rate = rateOn(date);
    if (rate === null) throw new Error(`oracle: no rate on ${date}`);
    let eligible = q(0);
    for (const o of spec.offsets ?? []) {
      if (dayCount(o.from, date) < 0 || (o.to && dayCount(date, o.to) <= 0)) continue;
      const bal = offsetBal.get(o.account) ?? q(0);
      let e = qmul(qcmp(bal, q(0)) > 0 ? bal : q(0), q(o.bps, 10000));
      if (o.cap && qcmp(e, qs(o.cap)) > 0) e = qs(o.cap);
      eligible = qadd(eligible, e);
    }
    let base = qsub(debt, eligible);
    if (qcmp(base, q(0)) < 0) base = q(0);
    if (spec.compounded) base = qadd(base, accrued);
    let day = qmul(qmul(base, qs(rate)), yearFraction(spec.convention, date, addDay(date)));
    if (spec.dayScale !== null) day = rnd(day, spec.dayScale, spec.dayMode);
    accrued = qadd(accrued, day);
    if (chargeSet?.has(date)) {
      const charged = post();
      rows.push({ date, kind: "interest-charge", amount: minor(charged), balance: minor(debt) });
    }
    apply(date, "after");
  }
  return rows;
}

function addDay(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

/** Independent date helpers for building golden-case inputs (Date.UTC, clamped month ends). */
export function oracleMonthly(first: string, count: number, anchorDay?: number): string[] {
  const [y, m, d] = first.split("-").map(Number);
  const day = anchorDay ?? d;
  const out: string[] = [];
  for (let k = 0; k < count; k++) {
    const last = new Date(Date.UTC(y, m - 1 + k + 1, 0)).getUTCDate();
    out.push(new Date(Date.UTC(y, m - 1 + k, Math.min(day, last))).toISOString().slice(0, 10));
  }
  return out;
}

export function oracleEveryNDays(first: string, stepDays: number, until: string): string[] {
  const out: string[] = [];
  for (let date = first; dayCount(date, until) >= 0; date = shift(date, stepDays)) out.push(date);
  return out;
}

function shift(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}
