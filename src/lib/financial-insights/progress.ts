import { cardsOwedAt, savingsRateOf, type CashBuffer, type Ledger, type SeriesPoint, type Status } from "./measures";
import type { MonthlyPoint, compositionSeries } from "./breakdowns";
import type { ScheduleInput } from "./debt";
import { monthLabel, monthOf, type ResolvedPeriod } from "./period";
import type { LinkedEquitySeries } from "./wealth";

/**
 * The Progress tab's share-safe data layer. `progressView` is the only thing `ProgressTab` receives: every number in it is a
 * `Shape`, `Percent`, `Months` or `Count`, and every string is built here from those, so the tab cannot draw a money amount, a
 * currency, or the name of an account, payee, loan or asset. The tests in `progress.test.ts` and `ProgressTab.test.tsx` hold
 * this line; a new card must follow the same contract (see the Progress block in `agents/knowledge.md`).
 */

// ─── What a number may be ────────────────────────────────────────────────────

declare const kind: unique symbol;
/** A point of a chart, already scaled into -1 to 1 and rounded to 3 decimals. */
export type Shape = number & { readonly [kind]: "Shape" };
/** A ratio in percent, one decimal. */
export type Percent = number & { readonly [kind]: "Percent" };
/** A duration in months, one decimal. */
export type Months = number & { readonly [kind]: "Months" };
/** A whole count: a streak, months, a position. */
export type Count = number & { readonly [kind]: "Count" };

export const asShape = (n: number): Shape => (Math.round(Math.max(-1, Math.min(1, n)) * 1000) / 1000 || 0) as Shape;
export const asPercent = (n: number): Percent => (Math.round(n * 10) / 10) as Percent;
export const asMonths = (n: number): Months => (Math.round(Math.max(0, n) * 10) / 10) as Months;
export const asCount = (n: number): Count => Math.max(0, Math.round(n)) as Count;

/** A line of text in its two forms: with the months named, and with them counted from the start of the period ("Month 4"). */
export type Dated = { on: string; off: string };

/** A chart series: points by month (null is a gap, never zero) and where zero sits on the same scale. */
export type ShapeSeries = { points: (Shape | null)[]; zero: Shape };

/** What the months of a chart are called, and which of them is not yet complete. */
export type Axis = { months: Dated[]; partial: boolean[] };

// ─── The view ────────────────────────────────────────────────────────────────

type CardBase = { id: string; title: string; /** The plain explanation behind the (i): never quotes an amount. */ info: string };

export type NetWorthCard = CardBase & { kind: "netWorth"; chart: ShapeSeries | null; axis: Axis; labels: Dated[]; /** Why there is no chart. */ empty: string | null };

export type DebtChoiceId = "cards" | "loans" | "all";
export type DebtChoice = { id: DebtChoiceId; label: string; chart: ShapeSeries; /** Where the peak is: the month shown as a dot. */ peak: Count; labels: Dated[] };
export type DebtCard = CardBase & { kind: "debt"; axis: Axis; defaultChoice: DebtChoiceId; choices: DebtChoice[] };

export type SavingsCard = CardBase & { kind: "savings"; bars: (Shape | null)[]; zero: Shape; axis: Axis; labels: Dated[]; /** Months below -100% are drawn at -100%: said so here. */ belowNote: string | null; /** Which months had no income: drawn as a gap with this note. */ gapNote: string | null; empty: string | null };

export type BufferCard = CardBase & { kind: "buffer"; /** "As of today" under the title. */ asOf: string } & (
  | { state: "ready"; fill: Shape; accessibleFill: Shape | null; marks: { at: Shape; label: string }[]; labels: Dated[] }
  | { state: "unavailable"; reason: string }
);

export type EquityCard = CardBase & { kind: "equity"; chart: ShapeSeries; axis: Axis; reference: { at: Shape; label: string }; labels: Dated[] };

export type MilestonesCard = CardBase & { kind: "milestones"; note: string; items: Dated[]; empty: string; /** The period is not already all available history. */ canSeeAllTime: boolean };

export type ProgressCard = NetWorthCard | DebtCard | SavingsCard | BufferCard | EquityCard | MilestonesCard;

export type ProgressView = {
  cards: ProgressCard[];
  /** Property values are still being read, so a home card may yet appear. */
  equityPending: boolean;
  /** The home cards cannot be drawn because property values could not be read (all of them, or some): one line says so. */
  equityUnavailable: boolean;
};

export type ProgressInput = {
  today: string;
  period: ResolvedPeriod;
  ledger: Ledger;
  summary: { series: readonly SeriesPoint[]; savingsRate: Status<number> };
  monthly: readonly MonthlyPoint[];
  composition: ReturnType<typeof compositionSeries>;
  buffer: Status<CashBuffer>;
  schedules: readonly ScheduleInput[];
  /** The equity points of each asset with a loan linked; null while they are being read or when they could not be. */
  equity: readonly LinkedEquitySeries[] | null;
  /** Property values could not be read, wholly or in part. */
  equityFailed?: boolean;
  /** The page already shows all available history. */
  allTime: boolean;
};

// ─── Scaling ─────────────────────────────────────────────────────────────────

/**
 * Scales a series by its largest absolute value, so the furthest point is 1 or -1 and the sign is kept. `zero` is where zero sits
 * on that scale; a chart runs from `zero` to the extreme when every point is on one side of it, so the axis is never truncated and
 * the zero line is always inside the chart. A missing month stays null. A series with nothing but zeros and gaps has no shape.
 */
export function toShape(valuesMinor: readonly (number | null)[]): ShapeSeries | null {
  const known = valuesMinor.filter((v): v is number => v !== null);
  const largest = Math.max(0, ...known.map(Math.abs));
  if (largest === 0) return null;
  return { points: valuesMinor.map((v) => (v === null ? null : asShape(v / largest))), zero: asShape(0) };
}

// ─── Wording ─────────────────────────────────────────────────────────────────

const both = (text: string): Dated => ({ on: text, off: text });

/** A month named, or counted from the first month of the period. */
function whenOf(period: ResolvedPeriod) {
  const index = new Map(period.months.map((m, i) => [m, i]));
  return (month: string) => ({ on: monthLabel(month), off: `Month ${(index.get(month) ?? 0) + 1}` });
}
type When = ReturnType<ReturnType<typeof whenOf>>;

/** "after 1 month" / "after 14 months", for a date that is hidden. */
const after = (months: number) => `after ${months} ${months === 1 ? "month" : "months"}`;

const pct = (value: number) => `${value < 0 ? "−" : ""}${Math.abs(value).toFixed(1)}%`;

function axisOf(period: ResolvedPeriod): Axis {
  const when = whenOf(period);
  return { months: period.months.map(when), partial: period.months.map((_, i) => period.partial && i === period.months.length - 1) };
}

// ─── Guards for percentages ──────────────────────────────────────────────────

/**
 * The change from `start` to `end` as words, or null when it cannot be said safely. Only when both are on the same side of zero;
 * a change of more than 10 times (or a fall to under a tenth) is "more than 10×", never a number that would reveal a tiny base.
 */
export function changeBetween(start: number, end: number): { kind: "up" | "down" | "improved" | "worsened"; percent: Percent } | { kind: "tenfold"; direction: "up" | "down" | "improved" | "worsened" } | null {
  if (start === 0 || end === 0 || Math.sign(start) !== Math.sign(end)) return null;
  const ratio = end / start;
  const negative = start < 0;
  const direction = negative ? (ratio < 1 ? "improved" : "worsened") : ratio >= 1 ? "up" : "down";
  if (ratio > 10 || ratio < 0.1) return { kind: "tenfold", direction };
  return { kind: direction, percent: asPercent(Math.abs(ratio - 1) * 100) };
}

/** A change past 10× either way, in words that say which way it went: a fall to under a tenth is "more than 90%", never "more than 10×". */
function tenfoldWording(direction: "up" | "down" | "improved" | "worsened"): string {
  switch (direction) {
    case "up": return "Net worth up by more than 10×";
    case "down": return "Net worth down by more than 90%";
    case "improved": return "Net worth improved by more than 90%";
    case "worsened": return "Net worth worsened by more than 10×";
  }
}

/** A reason that is safe to print: only those the measures write without a name or an amount in them; anything else is replaced. */
const KNOWN_REASONS = new Set([
  "Insufficient history: at least three complete months are needed",
  "There is no regular spending to measure against",
  "Cash & bank is below zero",
  "What you owe on credit cards is more than your cash & bank",
  "There was no income in this period",
]);
export const safeReason = (reason: string, fallback: string): string => (KNOWN_REASONS.has(reason) ? reason : fallback);

// ─── Net worth ───────────────────────────────────────────────────────────────

/** The first month the sign changes from the sign of the start, when the series starts and ends on different sides of zero. */
function zeroCrossing(values: readonly (number | null)[]): { month: number; direction: "up" | "down" } | null {
  const known = values.map((v, i) => ({ v, i })).filter((p): p is { v: number; i: number } => p.v !== null && p.v !== 0);
  if (known.length < 2) return null;
  const start = Math.sign(known[0].v), end = Math.sign(known[known.length - 1].v);
  if (start === end) return null;
  const first = known.find((p) => Math.sign(p.v) === end)!;
  return { month: first.i, direction: end > 0 ? "up" : "down" };
}

function netWorthCard(input: ProgressInput, when: ReturnType<typeof whenOf>): { card: NetWorthCard | null; crossing: { month: number; direction: "up" | "down" } | null } {
  const { period } = input;
  const values = input.summary.series.map((p) => p.netWorthMinor);
  const known = values.filter((v) => v !== null).length;
  if (known < 2) return { card: null, crossing: null };
  const shape = toShape(values);
  const crossing = zeroCrossing(values);
  const labels: Dated[] = [];
  const firstValue = values.find((v): v is number => v !== null)!;
  const lastValue = [...values].reverse().find((v): v is number => v !== null)!;
  if (crossing) {
    const w = when(period.months[crossing.month]);
    labels.push(crossing.direction === "up"
      ? { on: `Crossed zero in ${w.on}`, off: `Crossed zero ${after(crossing.month)}` }
      : { on: `Fell below zero in ${w.on}`, off: `Fell below zero ${after(crossing.month)}` });
  } else {
    const change = changeBetween(firstValue, lastValue);
    if (change?.kind === "tenfold") labels.push(both(tenfoldWording(change.direction)));
    else if (change) labels.push(both(change.kind === "improved" ? `Net worth improved by ${pct(change.percent)}` : change.kind === "worsened" ? `Net worth worsened by ${pct(change.percent)}` : `Net worth ${change.kind} ${pct(change.percent)} over the period`));
  }
  // The highest point: the latest complete month is the highest of the complete months in the period.
  const complete = input.summary.series.map((p, i) => ({ v: p.netWorthMinor, i, partial: p.partial })).filter((p): p is { v: number; i: number; partial: boolean } => p.v !== null && !p.partial);
  if (complete.length >= 2) {
    const top = Math.max(...complete.map((p) => p.v));
    const latest = complete[complete.length - 1];
    if (latest.v === top && complete.filter((p) => p.v === top).length === 1) {
      const w = when(period.months[latest.i]);
      labels.push({ on: `Highest point: ${w.on}`, off: `Highest point: ${w.off}` });
    }
  }
  return {
    crossing,
    card: {
      kind: "netWorth", id: "net-worth", title: "Net worth journey", axis: axisOf(period), chart: shape, empty: shape ? null : "Nothing to show in this period", labels,
      info: "Which way your net worth went over the period. Only the zero line is marked: the line shows the shape of the journey, not amounts. Same net worth as Summary.",
    },
  };
}

// ─── Debt ────────────────────────────────────────────────────────────────────

const CHOICE_LABEL: Record<DebtChoiceId, string> = { cards: "Credit cards", loans: "Loans", all: "All debt" };

/** What is owed at the end of each month, a positive amount per month (null before the budget has data). */
function owedByMonth(input: ProgressInput): Record<DebtChoiceId, (number | null)[]> & { other: (number | null)[] } {
  const { composition, ledger, period } = input;
  const row = (pick: (i: number, month: string) => number) => period.months.map((m, i) => (composition.hasData[i] ? pick(i, m) : null));
  // Loans and other liabilities are the class balances Summary and Loans & cards show; a card in credit is ignored as in the cash buffer.
  const cards = row((_, m) => cardsOwedAt(ledger, m));
  const loans = row((i) => Math.max(0, 0 - composition.months[i].loans));
  const other = row((i) => Math.max(0, 0 - composition.months[i].otherLiability));
  const all = cards.map((c, i) => (c === null ? null : c + loans[i]! + other[i]!));
  return { cards, loans, all, other };
}

/** The month with the most owed (the first, when several match), over the complete months with data: the same peak the label names. */
function peakOf(owed: readonly (number | null)[], partial: readonly boolean[]): number {
  let best = -1;
  owed.forEach((v, i) => { if (v !== null && !partial[i] && (best < 0 || v > owed[best]!)) best = i; });
  return Math.max(0, best);
}

type Dropped = { peak: number; latest: number; paidOff: number | null; streak: number; ratios: (number | null)[] };

/** How many months in a row a balance must have fallen before "paid off since the peak" is said: one good month is not progress yet. */
export const MIN_FALLING_MONTHS = 3;

/** Peak, the latest complete month, when it was paid off and the run of months it fell, from one owed series (complete months only). */
function dropOf(owed: readonly (number | null)[], partial: readonly boolean[]): Dropped | null {
  const idx = owed.map((v, i) => ({ v, i })).filter((p): p is { v: number; i: number } => p.v !== null && !partial[p.i]);
  if (idx.length < 2) return null;
  let peak = idx[0];
  for (const p of idx) if (p.v > peak.v) peak = p;
  const latest = idx[idx.length - 1];
  let paidOff: number | null = null;
  if (latest.v === 0 && peak.v > 0) {
    // The first month from which it stays zero to the end.
    let k = idx.length - 1;
    while (k > 0 && idx[k - 1].v === 0) k--;
    paidOff = idx[k].i;
  }
  // The run of months it fell, counted back from the latest month, or from the month it was paid off (months at zero after that are not falls).
  let streak = 0;
  let end = idx.length - 1;
  if (paidOff !== null) end = idx.findIndex((p) => p.i === paidOff);
  for (let k = end; k > 0 && idx[k].v < idx[k - 1].v; k--) streak++;
  const ratios = owed.map((v, i) => (v === null || partial[i] || i < peak.i || peak.v <= 0 ? null : (peak.v - v) / peak.v));
  return { peak: peak.i, latest: latest.i, paidOff, streak, ratios };
}

/** The debt-free label for the loans, as of today: only when every loan still owed has a payoff date from Loans. */
function debtFreeLabel(input: ProgressInput): Dated | null {
  const { ledger, today } = input;
  const current = monthOf(today);
  const owing = [...ledger.account.values()].filter((a) => a.accountClass === "loan" && ledger.balanceAt(a.id, current) < 0);
  if (owing.length === 0) return null;
  const dates: string[] = [];
  for (const account of owing) {
    const schedule = input.schedules.find((s) => s.accountId === account.id);
    const date = schedule?.state === "ready" ? schedule.payoffDate : null;
    if (!date || date <= today) return null;
    dates.push(date);
  }
  const last = dates.sort().at(-1)!;
  const index = (month: string) => Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7));
  const months = asMonths(index(monthOf(last)) - index(current));
  const years = Math.round(months / 12);
  const lead = months === 0 ? "Debt-free this month" : months > 24 ? `Debt-free in about ${years} years` : `Debt-free in about ${months} ${months === 1 ? "month" : "months"}`;
  return { on: `${lead} (${monthLabel(monthOf(last))})`, off: lead };
}

function debtCard(input: ProgressInput, when: ReturnType<typeof whenOf>): { card: DebtCard | null; drops: Partial<Record<DebtChoiceId, Dropped>> } {
  const { period } = input;
  const owed = owedByMonth(input);
  const partial = axisOf(period).partial;
  const owedIn = (series: (number | null)[]) => series.some((v) => v !== null && v > 0);
  const groups = [owedIn(owed.cards), owedIn(owed.loans), owedIn(owed.other)].filter(Boolean).length;
  const offered: DebtChoiceId[] = [];
  if (owedIn(owed.cards)) offered.push("cards");
  if (owedIn(owed.loans)) offered.push("loans");
  if (groups >= 2 || owedIn(owed.other)) offered.push("all");
  const choices: DebtChoice[] = [];
  const drops: Partial<Record<DebtChoiceId, Dropped>> = {};
  for (const id of offered) {
    const series = owed[id];
    const chart = toShape(series);
    const drop = dropOf(series, partial);
    if (!chart) continue;
    if (drop) drops[id] = drop;
    const labels: Dated[] = [];
    if (drop) {
      const peak = when(period.months[drop.peak]);
      if (drop.paidOff !== null) {
        const w = when(period.months[drop.paidOff]);
        labels.push({ on: `Paid off in ${w.on}`, off: `Paid off ${after(drop.paidOff)}` });
      } else if (drop.latest === drop.peak || series[drop.latest]! >= series[drop.peak]!) {
        labels.push(both("At its highest in this period"));
      } else if (drop.streak >= MIN_FALLING_MONTHS) {
        const paid = asPercent(((series[drop.peak]! - series[drop.latest]!) / series[drop.peak]!) * 100);
        labels.push({ on: `${pct(paid)} paid off since the peak in ${peak.on}`, off: `${pct(paid)} paid off since the peak (${peak.off})` });
      }
      if (drop.streak >= 2) labels.push(both(`Lower ${drop.streak} months in a row`));
    }
    if (id === "loans") {
      const free = debtFreeLabel(input);
      if (free) labels.push(free);
    }
    choices.push({ id, label: CHOICE_LABEL[id], chart, peak: asCount(drop?.peak ?? peakOf(series, partial)), labels: labels.slice(0, 3) });
  }
  if (choices.length < 1 || period.months.filter((_, i) => input.composition.hasData[i]).length < 2) return { card: null, drops: {} };
  return {
    drops,
    card: {
      kind: "debt", id: "debt-payoff", title: "Debt payoff progress", axis: axisOf(period), choices, defaultChoice: choices.find((c) => c.id === "cards")?.id ?? choices.find((c) => c.id === "loans")?.id ?? choices[0].id,
      info: "How what you owe changed over the period, as a shape that falls toward the zero line, with the highest month marked. Credit cards, Loans or all debt: never single accounts. A card in credit counts as nothing owed. The debt-free date is shown for loans only, from the payoff dates in Loans, and only when every loan you still owe has one.",
    },
  };
}

// ─── Savings rate ────────────────────────────────────────────────────────────

/** Each month's savings rate, from the same definition as Summary's (`savingsRateOf`); null where it cannot be known (no income, or money kept needs review). */
function monthlyRates(monthly: readonly MonthlyPoint[]): (number | null)[] {
  return monthly.map((m) => {
    if (!m.hasData) return null;
    const rate = savingsRateOf(m.kept === null ? { state: "needsReview", reason: "" } : { state: "ready", value: m.kept }, m.received);
    return rate.state === "ready" ? rate.value : null;
  });
}

function savingsCard(input: ProgressInput, when: ReturnType<typeof whenOf>): { card: SavingsCard | null; streakReached: Map<number, number> } {
  const { period, monthly } = input;
  if (!monthly.some((m) => m.hasData && m.received > 0)) return { card: null, streakReached: new Map() };
  const rates = monthlyRates(monthly);
  const complete = rates.map((r, i) => ({ r, i })).filter((p): p is { r: number; i: number } => p.r !== null && !monthly[p.i].partial);
  const labels: Dated[] = [];
  const overall = input.summary.savingsRate;
  if (overall.state === "ready") labels.push(both(overall.value < -100 ? "Savings rate below −100% over the period" : `Savings rate ${pct(overall.value)} over the period`));
  else labels.push(both(safeReason(overall.reason, "The savings rate needs a review on Summary")));
  if (complete.length > 0) {
    const best = complete.reduce((a, b) => (b.r > a.r ? b : a));
    const w = when(period.months[best.i]);
    labels.push({ on: `Best month: ${w.on}, ${pct(best.r)}`, off: `Best month: ${w.off}, ${pct(best.r)}` });
    const saved = complete.filter((p) => p.r > 0).length;
    // The run of months above 0% counted back from the latest complete month with a rate; a month with no income ends it.
    const lastComplete = monthly.map((m, i) => ({ m, i })).filter((p) => p.m.hasData && !p.m.partial).map((p) => p.i);
    let streak = 0;
    for (let k = lastComplete.length - 1; k >= 0; k--) { const r = rates[lastComplete[k]]; if (r !== null && r > 0) streak++; else break; }
    labels.push(both(streak >= 2 ? `Saved in ${saved} of ${complete.length} months · ${streak} months in a row` : `Saved in ${saved} of ${complete.length} months`));
  }
  // The first month each run of months above 0% reached 6 and 12 (for the milestones).
  const reached = new Map<number, number>();
  let run = 0;
  for (const m of monthly.map((m, i) => ({ m, i })).filter((p) => p.m.hasData && !p.m.partial)) {
    const r = rates[m.i];
    run = r !== null && r > 0 ? run + 1 : 0;
    for (const mark of [6, 12]) if (run === mark && !reached.has(mark)) reached.set(mark, m.i);
  }
  const bars = rates.map((r) => (r === null ? null : asShape(r / 100)));
  const noIncome = monthly.some((m, i) => m.hasData && rates[i] === null);
  return {
    streakReached: reached,
    card: {
      kind: "savings", id: "savings-rate", title: "Savings rate", axis: axisOf(period), bars, zero: asShape(0), labels, belowNote: rates.some((r) => r !== null && r < -100) ? "Months below −100% are drawn at −100%" : null,
      gapNote: noIncome ? "Months with no income are left blank" : null,
      empty: bars.some((b) => b !== null) ? null : "Nothing to show in this period",
      info: "How much of what you received you kept, month by month and over the period: the same savings rate as Summary. Bars below the line are months you spent more than you received.",
    },
  };
}

// ─── Cash buffer ─────────────────────────────────────────────────────────────

const BUFFER_SCALE = 12;
const BUFFER_UNAVAILABLE = "The cash buffer could not be worked out yet. Open Summary to see why.";

function bufferCard(input: ProgressInput): BufferCard {
  const base = { kind: "buffer" as const, id: "cash-buffer", title: "Cash buffer", asOf: "As of today", info: "How many months your cash could cover your usual spending, as of today, with what is owed on credit cards taken off. It is the cash buffer on Summary. Investments you can reach are counted in a second figure when you have set them." };
  const status = input.buffer;
  if (status.state !== "ready") return { ...base, state: "unavailable", reason: safeReason(status.reason, BUFFER_UNAVAILABLE) };
  const months = asMonths(status.value.months);
  const reach = status.value.monthsWithAccessible === undefined ? null : asMonths(status.value.monthsWithAccessible);
  const labels: Dated[] = [both(months >= BUFFER_SCALE ? `${BUFFER_SCALE}+ months of spending covered` : `${months.toFixed(1)} months of spending covered`)];
  if (reach !== null) labels.push(both(reach >= BUFFER_SCALE ? `${BUFFER_SCALE}+ months counting investments you can reach` : `${reach.toFixed(1)} months counting investments you can reach`));
  return {
    ...base, state: "ready", labels,
    fill: asShape(months / BUFFER_SCALE), accessibleFill: reach === null ? null : asShape(reach / BUFFER_SCALE),
    marks: [3, 6].map((m) => ({ at: asShape(m / BUFFER_SCALE), label: `${m} months` })),
  };
}

// ─── Home equity ─────────────────────────────────────────────────────────────

const LTV_REFERENCE = 80;

function equityCards(input: ProgressInput, when: ReturnType<typeof whenOf>): { cards: EquityCard[]; crossings: { title: string; mark: number; month: number }[] } {
  const { period } = input;
  const cards: EquityCard[] = [];
  const crossings: { title: string; mark: number; month: number }[] = [];
  const used = new Map<string, number>();
  const titles = (input.equity ?? []).map((e) => (e.accountClass === "property" ? "Home" : e.accountClass === "vehicle" ? "Vehicle" : "Asset"));
  (input.equity ?? []).forEach((asset, n) => {
    const ltv = asset.points.map((p) => p.ltvPercent);
    const known = ltv.map((v, i) => ({ v, i })).filter((p): p is { v: number; i: number } => p.v !== null);
    if (known.length === 0) return;
    const base = titles[n];
    const number = (used.get(base) ?? 0) + 1;
    used.set(base, number);
    const title = titles.filter((t) => t === base).length > 1 ? `${base} ${number}` : base;
    const first = known[0], latest = known[known.length - 1];
    const labels: Dated[] = [];
    labels.push(both(latest.v <= 100 ? `You own ${pct(100 - latest.v)}` : "The loan is above the value"));
    if (first.i !== latest.i && first.v !== latest.v) labels.push(both(`LTV ${latest.v < first.v ? "down" : "up"} from ${pct(first.v)} to ${pct(latest.v)}`));
    // Below a mark since the month it got there for good, when it was at or above the mark earlier in the period.
    for (const mark of [LTV_REFERENCE, 50]) {
      const crossed = crossedBelow(known, mark);
      if (crossed === null) continue;
      crossings.push({ title, mark, month: crossed });
      if (mark === LTV_REFERENCE) { const w = when(period.months[crossed]); labels.push({ on: `Below ${mark}% since ${w.on}`, off: `Below ${mark}% since ${w.off}` }); }
    }
    cards.push({
      kind: "equity", id: `equity-${n + 1}`, title, axis: axisOf(period), labels: labels.slice(0, 3), reference: { at: asShape(LTV_REFERENCE / 100), label: `${LTV_REFERENCE}%` },
      chart: { points: ltv.map((v) => (v === null ? null : asShape(v / 100))), zero: asShape(0) },
      info: "How much of the asset is still financed over the period (loan-to-value, a ratio), with a dashed line at 80%. The same loan-to-value as Property & assets. The asset and its loan are not named, and no loan terms are shown.",
    });
  });
  return { cards, crossings };
}

/** The month from which the series stays below `mark` to the end, when an earlier month was at or above it. */
function crossedBelow(known: readonly { v: number; i: number }[], mark: number): number | null {
  if (known[known.length - 1].v >= mark) return null;
  let k = known.length - 1;
  while (k > 0 && known[k - 1].v < mark) k--;
  return k === 0 ? null : known[k].i;
}

// ─── Milestones ──────────────────────────────────────────────────────────────

function milestonesCard(input: ProgressInput, when: ReturnType<typeof whenOf>, found: {
  crossing: { month: number; direction: "up" | "down" } | null; drops: Partial<Record<DebtChoiceId, Dropped>>; streakReached: Map<number, number>; equity: { title: string; mark: number; month: number }[]; bufferMonths: number | null;
}): MilestonesCard {
  const { period, ledger } = input;
  const dated: { month: number; text: Dated }[] = [];
  const at = (month: number, lead: string): { month: number; text: Dated } => {
    const w = when(period.months[month]);
    return { month, text: { on: `${lead}: ${w.on}`, off: `${lead}: ${w.off}` } };
  };
  if (found.crossing?.direction === "up") dated.push(at(found.crossing.month, "Net worth above zero"));
  const cards = found.drops.cards;
  if (cards?.paidOff != null) dated.push(at(cards.paidOff, "Credit cards paid off"));
  // A loan paid off: a loan account whose own owed balance reached zero in the period.
  const flags = axisOf(period).partial;
  for (const account of ledger.account.values()) {
    if (account.accountClass !== "loan") continue;
    const owed = period.months.map((m, i) => (input.composition.hasData[i] && !flags[i] ? Math.max(0, 0 - ledger.balanceAt(account.id, m)) : null));
    const drop = dropOf(owed, flags);
    if (drop?.paidOff != null) dated.push(at(drop.paidOff, "A loan paid off"));
  }
  const loans = found.drops.loans;
  // The same rule as the card's label: only a balance that has been falling for a while counts as paid off since its peak.
  if (loans && loans.streak >= MIN_FALLING_MONTHS) for (const mark of [0.25, 0.5, 0.75]) {
    const month = loans.ratios.findIndex((r) => r !== null && r >= mark);
    if (month >= 0) dated.push(at(month, `${mark * 100}% of loans paid off since the peak`));
  }
  for (const [mark, month] of found.streakReached) dated.push(at(month, `Saved ${mark} months in a row`));
  for (const e of found.equity) dated.push(at(e.month, `${e.title} LTV below ${e.mark}%`));
  dated.sort((a, b) => b.month - a.month);
  const now: Dated[] = [];
  const reached = found.bufferMonths === null ? undefined : [6, 3].find((mark) => found.bufferMonths! >= mark);
  if (reached !== undefined) now.push(both(`Now: ${reached}+ months of cash buffer`));
  return {
    kind: "milestones", id: "milestones", title: "Milestones", note: "In this period", canSeeAllTime: !input.allTime,
    items: [...now, ...dated.map((d) => d.text)].slice(0, 8), empty: "No milestones in this period yet.",
    info: "What you reached within the selected period, newest first. The cash buffer is as of today, so it carries no date. Select See all time to look across all available history.",
  };
}

// ─── Entry point ─────────────────────────────────────────────────────────────

/** Builds everything the Progress tab shows. The result holds no money amount, currency or name; see the module note. */
export function progressView(input: ProgressInput): ProgressView {
  const when = whenOf(input.period);
  const worth = netWorthCard(input, when);
  const debt = debtCard(input, when);
  const savings = savingsCard(input, when);
  const buffer = bufferCard(input);
  const equity = equityCards(input, when);
  const cards: ProgressCard[] = [];
  if (worth.card) cards.push(worth.card);
  if (debt.card) cards.push(debt.card);
  if (savings.card) cards.push(savings.card);
  cards.push(buffer);
  cards.push(...equity.cards);
  cards.push(milestonesCard(input, when, {
    crossing: worth.crossing, drops: debt.drops, streakReached: savings.streakReached, equity: equity.crossings,
    bufferMonths: input.buffer.state === "ready" ? input.buffer.value.months : null,
  }));
  return { cards, equityPending: input.equity === null && !input.equityFailed, equityUnavailable: input.equityFailed === true };
}

export type { When };
