import type { IsoDate } from "../calendar/dates";

/**
 * Lining a loan's payments up against its schedule in one pass (owner decision 2026-10-07).
 *
 * Instead of asking, for each due date, "is there a payment within X days of about Y?", every
 * payment that belongs to the loan is set against every due date in order: each due date takes at
 * most one payment, payments keep their order, and the alignment with the lowest total cost wins.
 * Closeness of date and amount make a pairing cheaper or dearer; nothing is ruled out by a window.
 * A due date left without a payment is missed; a payment left without a due date is extra (or the
 * payoff, which the planner recognises on its own). Pure and deterministic.
 *
 * Cost of pairing due d with payment p (both in minor units and days):
 *   dateCost   = days late / period; days early / period × 0.75 up to half a period (paying early
 *                is common), rising steeply after that
 *   amountCost = 0 within the tolerance, else 2 × |ln(paid / expected)|
 * Leaving a due date or a payment unpaired costs 1 each, so a pairing is preferred while it costs
 * less than 2: a payment a whole period off with the right amount, or on the day with half or
 * double the amount (two repayments at once), still pairs; a tiny fraction of the repayment, or a
 * payoff many times it, does not.
 *
 * A due date not reached yet costs nothing to leave unpaid, so a payment pairs with it only when
 * that is cheaper than calling the payment extra (a repayment made a few days early).
 *
 * Settled due dates (a change already applied) and the user's pins ("this is the payment") are
 * fixed pairs: they split the problem into independent stretches, aligned one by one.
 *
 * Offset-funded repayments (FR-078a): when the model takes part of a repayment from an offset
 * account, a payment of only the rest (other funds) also pairs at no amount cost, but always for
 * Review. A payment of the offset part close by is named as such and is not extra, so it is never
 * counted as an extra payment. Nothing is grouped or split across the two.
 */

export type AlignDue = {
  key: string;
  date: IsoDate;
  expectedMinor: number;
  /** Already settled by an applied change: this payment, on this date. */
  settled?: { paymentId: string; date: IsoDate } | null;
  /** Not due yet: leaving it without a payment costs nothing (a payment made early may still pair). */
  upcoming?: boolean;
  /** The part of the repayment the model takes from an offset account (0 or absent when none). */
  offsetFundedMinor?: number;
};

export type AlignPayment = { id: string; date: IsoDate; amountMinor: number };

/** The user's choice: this payment is this due date's repayment. */
export type AlignPin = { key: string; paymentId: string };

export type AlignReasonCode = "late" | "early" | "amount-differs" | "another-candidate" | "covers-missed" | "offset-part" | "missed";
export type AlignReason = { code: AlignReasonCode; text: string };

export type AlignedDue = {
  key: string;
  date: IsoDate;
  expectedMinor: number;
  payment: AlignPayment | null;
  /** Settled by an applied change (not re-aligned). */
  settled: boolean;
  /** Chosen by the user. */
  pinned: boolean;
  /** Payment date minus due date; null when missed. */
  daysFromDue: number | null;
  /** True when nothing about the pairing needs a person to look (routine). */
  clean: boolean;
  reasons: AlignReason[];
};

/** offsetParts: payments taken for the offset-funded part of a repayment (neither paired nor extra). */
export type AlignmentResult = { dues: AlignedDue[]; extras: AlignPayment[]; offsetParts: AlignPayment[] };

export type AlignOptions = {
  toleranceMinor: number;
  /** Formats money for reason texts. */
  formatMinor?: (minor: number) => string;
};

const MISS = 1;
const EXTRA = 1;
const DAY = 86_400_000;
const days = (from: IsoDate, to: IsoDate) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Days between a due date and its neighbours, as the scale for "early" and "late". */
function periodsOf(dues: readonly AlignDue[]): number[] {
  return dues.map((d, i) => {
    const prev = i > 0 ? days(dues[i - 1].date, d.date) : null;
    const next = i < dues.length - 1 ? days(d.date, dues[i + 1].date) : null;
    const span = prev ?? next ?? 30;
    return Math.max(7, Math.min(span, next ?? span));
  });
}

function amountCost(paid: number, expected: number, tolerance: number): number {
  const diff = Math.abs(paid - expected);
  if (diff <= tolerance) return 0;
  if (paid <= 0 || expected <= 0) return Infinity;
  return 2 * Math.abs(Math.log(paid / expected));
}

/** The bank-paid part of an offset-funded repayment, when there is one to look for. */
function otherFundsOf(due: AlignDue): number | null {
  const offset = due.offsetFundedMinor ?? 0;
  return offset > 0 && offset < due.expectedMinor ? due.expectedMinor - offset : null;
}

/** The amount this payment is nearest to: the whole repayment, or only its other-funds part. */
function targetOf(due: AlignDue, paid: number, tolerance: number): { minor: number; part: boolean } {
  const other = otherFundsOf(due);
  if (other === null) return { minor: due.expectedMinor, part: false };
  return amountCost(paid, other, tolerance) < amountCost(paid, due.expectedMinor, tolerance) ? { minor: other, part: true } : { minor: due.expectedMinor, part: false };
}

function pairCost(due: AlignDue, period: number, payment: AlignPayment, tolerance: number): number {
  const offset = days(due.date, payment.date);
  const early = -offset / period;
  // Early is common up to about half a period; beyond that it gets dear quickly.
  const dateCost = offset >= 0 ? offset / period : early <= 0.5 ? early * 0.75 : 0.375 + (early - 0.5) * 2.5;
  return dateCost + amountCost(payment.amountMinor, targetOf(due, payment.amountMinor, tolerance).minor, tolerance);
}

/** Lowest-cost order-preserving alignment of one stretch; returns, per due, the payment index or -1. */
function alignStretch(dues: readonly AlignDue[], periods: readonly number[], payments: readonly AlignPayment[], tolerance: number): number[] {
  const n = dues.length;
  const m = payments.length;
  const cost: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(Infinity));
  const step: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  cost[0][0] = 0;
  for (let i = 0; i <= n; i++) {
    for (let j = 0; j <= m; j++) {
      if (i === 0 && j === 0) continue;
      let best = Infinity;
      let how = 0;
      // Preference on ties: pair, then miss the due date, then leave the payment extra.
      if (i > 0 && j > 0) {
        const c = cost[i - 1][j - 1] + pairCost(dues[i - 1], periods[i - 1], payments[j - 1], tolerance);
        if (c < best - 1e-9) { best = c; how = 1; }
      }
      if (i > 0) {
        const c = cost[i - 1][j] + (dues[i - 1].upcoming ? 0 : MISS);
        if (c < best - 1e-9) { best = c; how = 2; }
      }
      if (j > 0) {
        const c = cost[i][j - 1] + EXTRA;
        if (c < best - 1e-9) { best = c; how = 3; }
      }
      cost[i][j] = best;
      step[i][j] = how;
    }
  }
  const chosen = new Array<number>(n).fill(-1);
  for (let i = n, j = m; i > 0 || j > 0;) {
    const how = step[i][j];
    if (how === 1) { chosen[i - 1] = j - 1; i--; j--; }
    else if (how === 2) i--;
    else j--;
  }
  return chosen;
}

export function alignPayments(input: { dues: readonly AlignDue[]; payments: readonly AlignPayment[]; pins?: readonly AlignPin[] }, options: AlignOptions): AlignmentResult {
  const money = options.formatMinor ?? ((minor: number) => (minor / 100).toFixed(2));
  const tolerance = Math.max(0, options.toleranceMinor);
  const dues = [...input.dues].sort((a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key));
  const periods = periodsOf(dues);
  const byId = new Map(input.payments.map((p) => [p.id, p]));
  const pins = new Map((input.pins ?? []).filter((pin) => byId.has(pin.paymentId)).map((pin) => [pin.key, pin.paymentId]));
  const fixedIds = new Set<string>([...dues.flatMap((d) => (d.settled ? [d.settled.paymentId] : [])), ...pins.values()]);
  const free = [...input.payments].filter((p) => !fixedIds.has(p.id)).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));

  const assigned = new Map<string, AlignPayment | null>();
  // Fixed pairs (settled or pinned) split the dues into stretches; each stretch takes the free
  // payments dated between its fixed neighbours.
  const fixedDate = (d: AlignDue): IsoDate | null => d.settled?.date ?? (pins.has(d.key) ? byId.get(pins.get(d.key)!)!.date : null);
  let start = 0;
  let lowerDate: IsoDate | null = null;
  const flush = (end: number, upperDate: IsoDate | null) => {
    const stretch = dues.slice(start, end);
    const stretchPeriods = periods.slice(start, end);
    const pool = free.filter((p) => (lowerDate === null || p.date > lowerDate) && (upperDate === null || p.date < upperDate));
    const chosen = alignStretch(stretch, stretchPeriods, pool, tolerance);
    stretch.forEach((d, k) => assigned.set(d.key, chosen[k] >= 0 ? pool[chosen[k]] : null));
  };
  dues.forEach((d, i) => {
    const fixed = fixedDate(d);
    if (fixed === null) return;
    flush(i, fixed);
    assigned.set(d.key, d.settled ? (byId.get(d.settled.paymentId) ?? { id: d.settled.paymentId, date: d.settled.date, amountMinor: d.expectedMinor }) : byId.get(pins.get(d.key)!)!);
    start = i + 1;
    lowerDate = fixed;
  });
  flush(dues.length, null);

  const used = new Set([...assigned.values()].flatMap((p) => (p ? [p.id] : [])));
  // The offset part of a repayment paid as its own payment near the other-funds part: named, not extra.
  const offsetParts = new Map<string, AlignPayment>();
  dues.forEach((d, i) => {
    const payment = assigned.get(d.key);
    if (!payment || d.settled || !targetOf(d, payment.amountMinor, tolerance).part) return;
    const part = free
      .filter((p) => !used.has(p.id) && Math.abs(p.amountMinor - (d.offsetFundedMinor ?? 0)) <= tolerance && Math.abs(days(payment.date, p.date)) <= periods[i] / 2)
      .sort((a, b) => Math.abs(days(payment.date, a.date)) - Math.abs(days(payment.date, b.date)))[0];
    if (part) { offsetParts.set(d.key, part); used.add(part.id); }
  });
  const extras = free.filter((p) => !used.has(p.id));

  const aligned: AlignedDue[] = dues.map((d, i) => {
    const payment = assigned.get(d.key) ?? null;
    const settled = !!d.settled;
    const pinned = !settled && pins.has(d.key);
    const reasons: AlignReason[] = [];
    if (!payment && d.upcoming) return { key: d.key, date: d.date, expectedMinor: d.expectedMinor, payment: null, settled, pinned, daysFromDue: null, clean: true, reasons };
    if (!payment) {
      const before = [...dues.slice(0, i)].reverse().map((x) => assigned.get(x.key)).find(Boolean)?.date ?? null;
      const after = dues.slice(i + 1).map((x) => assigned.get(x.key)).find(Boolean)?.date ?? null;
      const between = before && after ? ` between the payments on ${before} and ${after}` : before ? ` after the payment on ${before}` : after ? ` before the payment on ${after}` : "";
      const fromOffset = (d.offsetFundedMinor ?? 0) >= d.expectedMinor ? " The model pays this repayment from the offset account; no transfer from it into the loan was found." : "";
      reasons.push({ code: "missed", text: `No payment to this loan was found for this due date${between}.${fromOffset}` });
      return { key: d.key, date: d.date, expectedMinor: d.expectedMinor, payment: null, settled, pinned, daysFromDue: null, clean: false, reasons };
    }
    const offset = days(d.date, payment.date);
    if (!settled) {
      const period = periods[i];
      if (offset > 5) reasons.push({ code: "late", text: `Paid ${plural(offset, "day")} after the due date.` });
      if (offset < -Math.round(period * 0.6)) reasons.push({ code: "early", text: `Paid ${plural(-offset, "day")} before the due date.` });
      const target = targetOf(d, payment.amountMinor, tolerance);
      if (target.part) {
        const part = offsetParts.get(d.key);
        reasons.push({ code: "offset-part", text: part
          ? `${money(payment.amountMinor)} paid here and ${money(part.amountMinor)} on ${part.date}, which looks like the part the model takes from the offset account. Bench splits only this payment; check both in Actual before applying.`
          : `${money(payment.amountMinor)} paid: the model takes the other ${money(d.offsetFundedMinor ?? 0)} of the ${money(d.expectedMinor)} repayment from the offset account, and no payment of that amount into the loan was found. Check the offset account in Actual before applying.` });
      }
      const diff = payment.amountMinor - target.minor;
      if (Math.abs(diff) > Math.max(tolerance, Math.round(target.minor / 100))) {
        const ratio = payment.amountMinor / Math.max(1, d.expectedMinor);
        const multiple = Math.round(ratio);
        const previousMissed = i > 0 && !assigned.get(dues[i - 1].key);
        if (multiple >= 2 && Math.abs(ratio - multiple) <= 0.05 && previousMissed) {
          reasons.push({ code: "covers-missed", text: `About ${multiple} repayments in one payment (${money(payment.amountMinor)}); the repayment due ${dues[i - 1].date} was not found and may be included. Check before applying.` });
        } else {
          reasons.push({ code: "amount-differs", text: `${money(payment.amountMinor)} paid, ${money(Math.abs(diff))} ${diff > 0 ? "more" : "less"} than the scheduled ${money(target.minor)}${target.part ? " from other funds" : ""}.` });
        }
      }
      if (!pinned) {
        const chosenCost = pairCost(d, period, payment, tolerance);
        const rival = extras
          .filter((p) => Math.abs(days(d.date, p.date)) <= period)
          .map((p) => ({ p, c: pairCost(d, period, p, tolerance) }))
          .filter(({ c }) => c <= chosenCost + 0.15)
          .sort((a, b) => a.c - b.c)[0];
        if (rival) reasons.push({ code: "another-candidate", text: `Another payment of ${money(rival.p.amountMinor)} on ${rival.p.date} could also be this repayment. Choose the right one if needed.` });
      }
    }
    return { key: d.key, date: d.date, expectedMinor: d.expectedMinor, payment, settled, pinned, daysFromDue: offset, clean: settled || pinned || reasons.length === 0, reasons };
  });
  return { dues: aligned, extras, offsetParts: [...offsetParts.values()] };
}
