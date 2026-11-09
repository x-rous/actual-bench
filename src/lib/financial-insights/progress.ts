import { cardsOwedAt, cashBuffer, savingsRateOf, type CashBuffer, type Ledger, type LoanScheduleInput, type SeriesPoint, type Status } from "./measures";
import type { ClassKey, MonthlyPoint, compositionSeries } from "./breakdowns";
import type { ScheduleInput } from "./debt";
import { addMonths, monthLabel, monthOf, type ResolvedPeriod } from "./period";
import type { PropertySeries } from "./wealth";

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

export type SavingsCard = CardBase & { kind: "savings"; bars: (Shape | null)[]; zero: Shape; axis: Axis; labels: Dated[]; /** Months below -100% are drawn at -100%: said so here. */ provisionalNote: string | null; /** Months above 100% are drawn at 100%: said so here. */ aboveNote: string | null; belowNote: string | null; /** Which months had no income: drawn as a gap with this note. */ gapNote: string | null; empty: string | null };

export type BufferCard = CardBase & { kind: "buffer"; /** "As of today" under the title. */ asOf: string } & (
  | { state: "ready"; fill: Shape; accessibleFill: Shape | null; marks: { at: Shape; label: string }[]; labels: Dated[] }
  | { state: "unavailable"; reason: string }
);

/**
 * A property, vehicle or other asset: its value over time as a shape (scaled to its own highest month, so there is no amount to read), and
 * where a loan is linked the loan-to-value on a 0 to 100% scale, with a dashed line at 80%.
 */
export type PropertyCard = CardBase & { kind: "property"; axis: Axis; valueShape: ShapeSeries | null; ltv: { chart: ShapeSeries; /** The latest loan-to-value, labelled at the end of its line: the month it is for and the figure. */ latest: { index: Count; label: string }; reference: { at: Shape; label: string }; /** Where 100% sits: at the top, or lower when the loan is above the value. */ full: { at: Shape; label: string } } | null; labels: Dated[] };


/** Which months were saved: one square each, in order. Words, not amounts. */
export type MonthStatus = "saved" | "short" | "none";
export type ConsistencyCard = CardBase & { kind: "consistency"; /** "Last 12 complete months". */ note: string; strip: MonthStatus[]; axis: Axis; labels: Dated[] };

/** What you own, by type, at the start and the end of the period: each bar is shares that add up to 1, in the order of `classes`. */
export type CompositionCard = CardBase & { kind: "composition"; note: string; classes: string[]; startName: string; endName: string; start: Shape[]; end: Shape[]; labels: Dated[] };

/** Months of cover over time, with the goal when one is set. */
export type JourneyCard = CardBase & { kind: "journey"; note: string; chart: ShapeSeries; axis: Axis; goal: { at: Shape; label: string } | null; labels: Dated[] };

export type ProgressCard = NetWorthCard | CompositionCard | DebtCard | SavingsCard | ConsistencyCard | BufferCard | JourneyCard | PropertyCard;

export type ProgressView = {
  cards: ProgressCard[];
  /** Property values are still being read, so a home card may yet appear. */
  equityPending: boolean;
  /** The home cards cannot be drawn because property values could not be read (all of them, or some): one line says so. */
  equityUnavailable: boolean;
  /** A property account is not registered in Assets, so it has no card: the tab says to register it. */
  propertiesUnregistered: boolean;
};

export type ProgressInput = {
  today: string;
  period: ResolvedPeriod;
  ledger: Ledger;
  summary: { series: readonly SeriesPoint[]; savingsRate: Status<number>; /** Net worth at the end of the month before the period and at its end: what Summary reports the change between. */ netWorth: { opening: number; closing: number } };
  monthly: readonly MonthlyPoint[];
  composition: ReturnType<typeof compositionSeries>;
  buffer: Status<CashBuffer>;
  schedules: readonly ScheduleInput[];
  /** The equity points of each asset with a loan linked; null while they are being read or when they could not be. */
  equity: readonly PropertySeries[] | null;
  /** Property values could not be read, wholly or in part. */
  equityFailed?: boolean;
  /** A property account is not registered in Assets, so it has no card. */
  propertiesUnregistered?: boolean;
  /** The cash buffer settings: the goal in months (null when none is set) and how a typical month is taken. */
  bufferSettings?: { goalMonths: number | null; averageMonths: number; method: "average" | "median" };
  /** What the tracked loans cost a month, as the cash buffer takes them (the same for every month of the journey). */
  bufferSchedules?: ReadonlyMap<string, LoanScheduleInput>;
  /** For a median typical month: the typical month's spending as of a day, worked out as Summary's buffer does (it needs the categories, so the page supplies it). Undefined where it cannot be worked out. */
  medianSpendingAt?: (day: string) => number | undefined;
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

function netWorthCard(input: ProgressInput, when: ReturnType<typeof whenOf>): NetWorthCard | null {
  const { period } = input;
  const values = input.summary.series.map((p) => p.netWorthMinor);
  const known = values.filter((v) => v !== null).length;
  if (known < 2) return null;
  const shape = toShape(values);
  // The change is measured from the balance before the period, as Summary's is, when the budget has history that far back; otherwise from its first month.
  const hasOpening = input.ledger.firstMonth !== null && input.ledger.firstMonth < period.startMonth;
  const opening = hasOpening ? input.summary.netWorth.opening : null;
  const found = zeroCrossing(opening === null ? values : [opening, ...values]);
  const crossing = found && { ...found, month: found.month - (opening === null ? 0 : 1) };
  const labels: Dated[] = [];
  const firstValue = opening ?? values.find((v): v is number => v !== null)!;
  const lastValue = [...values].reverse().find((v): v is number => v !== null)!;
  if (crossing) {
    const w = when(period.months[crossing.month]);
    const later = crossing.month === 0 ? "in the first month" : after(crossing.month);
    labels.push(crossing.direction === "up"
      ? { on: `Crossed zero in ${w.on}`, off: `Crossed zero ${later}` }
      : { on: `Fell below zero in ${w.on}`, off: `Fell below zero ${later}` });
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
    kind: "netWorth", id: "net-worth", title: "Net worth journey", axis: axisOf(period), chart: shape, empty: shape ? null : "Nothing to show in this period", labels,
    info: "Which way your net worth went over the period. Only the zero line is marked: the line shows the shape of the journey, not amounts. Same net worth as Summary.",
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

type Dropped = { peak: number; latest: number; paidOff: number | null; streak: number };

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
  return { peak: peak.i, latest: latest.i, paidOff, streak };
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

/** What was owed at the end of the month before the period, per group, when the budget has history that far back; zero otherwise. */
function openingOwed(input: ProgressInput): Record<DebtChoiceId, number> & { other: number } {
  const { ledger, period, composition } = input;
  const before = addMonths(period.startMonth, -1);
  if (ledger.firstMonth === null || ledger.firstMonth > before) return { cards: 0, loans: 0, all: 0, other: 0 };
  const cards = cardsOwedAt(ledger, before);
  const loans = Math.max(0, 0 - composition.opening.loans);
  const other = Math.max(0, 0 - composition.opening.otherLiability);
  return { cards, loans, other, all: cards + loans + other };
}

function debtCard(input: ProgressInput, when: ReturnType<typeof whenOf>): DebtCard | null {
  const { period } = input;
  const owed = owedByMonth(input);
  const opening = openingOwed(input);
  const partial = axisOf(period).partial;
  // A group counts when it was owed at any month of the period, or at the start of it (a debt paid off in the first month).
  const owedIn = (series: (number | null)[], start: number) => start > 0 || series.some((v) => v !== null && v > 0);
  const groups = [owedIn(owed.cards, opening.cards), owedIn(owed.loans, opening.loans), owedIn(owed.other, opening.other)].filter(Boolean).length;
  const offered: DebtChoiceId[] = [];
  if (owedIn(owed.cards, opening.cards)) offered.push("cards");
  if (owedIn(owed.loans, opening.loans)) offered.push("loans");
  if (groups >= 2 || owedIn(owed.other, opening.other)) offered.push("all");
  const choices: DebtChoice[] = [];
  let paidFirstAny = false;
  for (const id of offered) {
    const series = owed[id];
    // Nothing owed at any month of the period, but something at its start: it was paid off in the first month. The line lies on zero and the label says when.
    const paidInFirstMonth = !series.some((v) => v !== null && v > 0) && opening[id] > 0;
    const chart = toShape(series) ?? (paidInFirstMonth ? { points: series.map((v) => (v === null ? null : asShape(0))), zero: asShape(0) } : null);
    const drop = dropOf(series, partial);
    if (!chart) continue;
    const labels: Dated[] = [];
    if (paidInFirstMonth) {
      paidFirstAny = true;
      const first = when(period.months[Math.max(0, series.findIndex((v) => v !== null))]);
      labels.push({ on: `Paid off in ${first.on}`, off: "Paid off in the first month" });
    } else if (drop) {
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
  // Two months of data are needed to show a fall, except for a debt paid off in the first month, which one month with data can show.
  if (choices.length < 1 || (period.months.filter((_, i) => input.composition.hasData[i]).length < 2 && !paidFirstAny)) return null;
  return {
    kind: "debt", id: "debt-payoff", title: "Debt payoff progress", axis: axisOf(period), choices, defaultChoice: choices.find((c) => c.id === "cards")?.id ?? choices.find((c) => c.id === "loans")?.id ?? choices[0].id,
    info: "How what you owe changed over the period, as a shape that falls toward the zero line, with the highest month marked. Credit cards, Loans or all debt: never single accounts. A card in credit counts as nothing owed. The debt-free date is shown for loans only, from the payoff dates in Loans, and only when every loan you still owe has one.",
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

function savingsCard(input: ProgressInput, when: ReturnType<typeof whenOf>): SavingsCard | null {
  const { period, monthly } = input;
  const rates = monthlyRates(monthly);
  if (!monthly.some((m) => m.hasData && m.received > 0)) {
    // No income at all: the card says so, instead of vanishing, and the reason is shown whatever Show text says.
    const reason = "There was no income in this period";
    return {
      kind: "savings", id: "savings-rate", title: "Savings rate", axis: axisOf(period), bars: rates.map(() => null), zero: asShape(0), labels: [],
      provisionalNote: null, aboveNote: null, belowNote: null, gapNote: null, empty: reason,
      info: "How much of what you received you kept, month by month and over the period: the same savings rate as Summary. Bars below the line are months you spent more than you received.",
    };
  }
  const complete = rates.map((r, i) => ({ r, i })).filter((p): p is { r: number; i: number } => p.r !== null && !monthly[p.i].partial);
  const labels: Dated[] = [];
  const overall = input.summary.savingsRate;
  if (overall.state === "ready") labels.push(both(overall.value < -100 ? "Savings rate below −100% over the period" : `Savings rate ${pct(overall.value)} over the period`));
  else labels.push(both(safeReason(overall.reason, "The savings rate needs a review on Summary")));
  if (complete.length > 0) {
    const best = complete.reduce((a, b) => (b.r > a.r ? b : a));
    const w = when(period.months[best.i]);
    labels.push({ on: `Best month: ${w.on}, ${pct(best.r)}`, off: `Best month: ${w.off}, ${pct(best.r)}` });
    // The run of months above 0% counted back from the latest complete month with a rate; a month with no income ends it.
    const lastComplete = monthly.map((m, i) => ({ m, i })).filter((p) => p.m.hasData && !p.m.partial).map((p) => p.i);
    let streak = 0;
    for (let k = lastComplete.length - 1; k >= 0; k--) { const r = rates[lastComplete[k]]; if (r !== null && r > 0) streak++; else break; }
    // How many months were saved has its own card (Savings consistency); this one keeps the current run.
    if (streak >= 2) labels.push(both(`${streak} months in a row above 0%`));
  }
  const bars = rates.map((r) => (r === null ? null : asShape(r / 100)));
  const noIncome = monthly.some((m, i) => m.hasData && rates[i] === null);
  return {
    kind: "savings", id: "savings-rate", title: "Savings rate", axis: axisOf(period), bars, zero: asShape(0), labels, provisionalNote: overall.state === "ready" && overall.warning ? "Some entries may be counted twice; see Summary" : null,
    aboveNote: rates.some((r) => r !== null && r > 100) ? "Months above 100% are drawn at 100%" : null,
    belowNote: rates.some((r) => r !== null && r < -100) ? "Months below −100% are drawn at −100%" : null,
    gapNote: noIncome ? "Months with no income are left blank" : null,
    empty: bars.some((b) => b !== null) ? null : "Nothing to show in this period",
    info: "How much of what you received you kept, month by month and over the period: the same savings rate as Summary. Bars below the line are months you spent more than you received.",
  };
}

// ─── Savings consistency ─────────────────────────────────────────────────────

/** The most months drawn: ten years, as squares small enough to fit several lines. */
const CONSISTENCY_MONTHS = 120;

/** In how many of the complete months of the period was the savings rate above 0% (you spent less than you received)? One square for each month: saved, short, or no income. */
function consistencyCard(input: ProgressInput, when: ReturnType<typeof whenOf>): ConsistencyCard | null {
  const { period, monthly } = input;
  const rates = monthlyRates(monthly);
  const shown = monthly.map((m, i) => ({ m, i })).filter((p) => p.m.hasData && !p.m.partial).slice(-CONSISTENCY_MONTHS);
  const strip: MonthStatus[] = shown.map((p) => (rates[p.i] === null ? "none" : rates[p.i]! > 0 ? "saved" : "short"));
  const rated = strip.filter((x) => x !== "none").length;
  if (rated < 2) return null;
  const saved = strip.filter((x) => x === "saved").length;
  return {
    kind: "consistency", id: "savings-consistency", title: "Savings consistency", note: shown.length <= 12 || shown.length === CONSISTENCY_MONTHS ? `Last ${shown.length} complete months` : `${shown.length} complete months`, strip,
    axis: { months: shown.map((p) => when(period.months[p.i])), partial: shown.map(() => false) },
    labels: [both(`${saved} of ${rated} months saved`), both(`${pct(asPercent((saved / rated) * 100))} positive months`)],
    info: "In how many of the complete months of the period you spent less than you received: the months with a savings rate above 0%. A month with no income is left out of the count. The savings rate is the one on Summary.",
  };
}

// ─── Asset composition ───────────────────────────────────────────────────────

const COMPOSITION: { name: string; keys: ClassKey[] }[] = [
  { name: "Cash & deposits", keys: ["cash", "fixed"] },
  { name: "Investments", keys: ["invest"] },
  { name: "Property", keys: ["property"] },
  { name: "Other", keys: ["vehicle", "other"] },
];

/** The share of what you own in each type, adding up to 1, from the class balances Summary shows; null when there is nothing owned. */
function sharesOf(balances: Record<ClassKey, number>): number[] | null {
  const parts = COMPOSITION.map((g) => g.keys.reduce((sum, k) => sum + Math.max(0, balances[k]), 0));
  const total = parts.reduce((a, b) => a + b, 0);
  return total > 0 ? parts.map((v) => v / total) : null;
}

function compositionCard(input: ProgressInput): CompositionCard | null {
  const { composition, ledger, period } = input;
  const firstData = composition.hasData.findIndex(Boolean);
  const lastData = composition.hasData.lastIndexOf(true);
  if (firstData < 0) return null;
  // The start is the balance before the period when the budget has history that far back; otherwise its first month.
  const hasBefore = ledger.firstMonth !== null && ledger.firstMonth < period.startMonth;
  if (!hasBefore && firstData === lastData) return null;
  const start = sharesOf(hasBefore ? composition.opening : composition.months[firstData]);
  const end = sharesOf(composition.months[lastData]);
  if (!start || !end) return null;
  const names = COMPOSITION.map((g) => g.name);
  const labels: Dated[] = [];
  // Ties (a move between two types shifts both equally) are decided by the order of the types, not by rounding noise.
  const shift = names.map((name, i) => ({ name, from: start[i] * 100, to: end[i] * 100 })).sort((a, b) => Math.round(Math.abs(b.to - b.from) * 10) - Math.round(Math.abs(a.to - a.from) * 10))[0];
  if (Math.abs(shift.to - shift.from) >= 1) labels.push(both(`${shift.name} ${shift.to > shift.from ? "up" : "down"} from ${pct(asPercent(shift.from))} to ${pct(asPercent(shift.to))} of what you own`));
  const biggest = names.map((name, i) => ({ name, share: end[i] * 100 })).sort((a, b) => b.share - a.share)[0];
  labels.push(both(`Largest now: ${biggest.name}, ${pct(asPercent(biggest.share))}`));
  return {
    kind: "composition", id: "asset-composition", title: "Asset composition", note: "Share of what you own", classes: names,
    startName: "Start", endName: period.partial ? "Today" : "End of period", start: start.map(asShape), end: end.map(asShape), labels,
    info: "How what you own is split between cash and deposits (including fixed or restricted deposits), investments, property and other assets, at the start and at the end of the period. Each bar is 100% of your assets at that point: only shares are shown, never amounts. The classes are the ones on Summary.",
  };
}

// ─── Cash buffer journey ─────────────────────────────────────────────────────

const JOURNEY_MONTHS = 24;

/**
 * Months of cover at the end of each of the last months of the period, with the goal. Every month, the current one included, is the same cash
 * buffer measure with the same settings and the same loan schedules, as of that month: its balances, over the typical month of the complete
 * months before it. So the line is one measure, and its last point is the buffer on Summary, for an average or a median typical month alike.
 */
function journeyCard(input: ProgressInput, when: ReturnType<typeof whenOf>): JourneyCard | null {
  const { period, ledger } = input;
  const settings = input.bufferSettings ?? { goalMonths: null, averageMonths: 12, method: "average" as const };
  const shown = period.months.map((m, i) => ({ m, i })).filter((p) => ledger.firstMonth !== null && p.m >= ledger.firstMonth).slice(-JOURNEY_MONTHS);
  const values = shown.map(({ m, i }) => {
    const current = period.partial && i === period.months.length - 1;
    const day = current ? input.today : `${m}-28`;
    // A median typical month takes its spending the way Summary's buffer does, for each month. Where that cannot be worked out the month is a gap:
    // the average is a different measure, so it is never put in its place. The average needs nothing more.
    const median = settings.method === "median" ? input.medianSpendingAt?.(day) : undefined;
    if (settings.method === "median" && median === undefined) return null;
    const status = cashBuffer(ledger, day, input.bufferSchedules ?? new Map(), { months: settings.averageMonths, method: settings.method, spendingMinor: median });
    return status.state === "ready" ? Math.round(status.value.months * 10) / 10 : null;
  });
  const known = values.filter((v): v is number => v !== null);
  if (known.length < 3) return null;
  const top = Math.max(...known, settings.goalMonths ?? 0);
  if (top <= 0) return null;
  const labels: Dated[] = [];
  const first = known[0], last = known[known.length - 1];
  if (first !== last) labels.push(both(`Cover ${last > first ? "up" : "down"} from ${asMonths(first).toFixed(1)} to ${asMonths(last).toFixed(1)} months`));
  else labels.push(both(`Cover steady at ${asMonths(last).toFixed(1)} months`));
  const goal = settings.goalMonths;
  if (goal !== null && goal > 0) {
    // The first month from which the cover stays at or above the goal to the end.
    let k = values.length;
    while (k > 0 && (values[k - 1] === null || values[k - 1]! >= goal)) k--;
    const reachedAt = values.slice(k).findIndex((v) => v !== null);
    if (k > 0 && reachedAt >= 0 && k < values.length) { const w = when(shown[k + reachedAt].m); labels.push({ on: `Goal of ${goal} months reached in ${w.on}`, off: `Goal of ${goal} months reached (${w.off})` }); }
  }
  return {
    kind: "journey", id: "cash-buffer-journey", title: "Cash buffer journey", note: "Months of cover", labels,
    axis: { months: shown.map((p) => when(p.m)), partial: shown.map((p) => period.partial && p.i === period.months.length - 1) },
    chart: { points: values.map((v) => (v === null ? null : asShape(v / top))), zero: asShape(0) },
    goal: goal !== null && goal > 0 ? { at: asShape(goal / top), label: "Goal" } : null,
    info: "How many months of spending your cash could have covered at the end of each month, with the goal from your cash buffer settings. It is the cash buffer on Summary worked out as of each month: that month's balances over the typical month before it, with the same loan schedules. A month that cannot be worked out is a gap, never zero.",
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

function propertyCards(input: ProgressInput, when: ReturnType<typeof whenOf>): PropertyCard[] {
  const { period } = input;
  // Vehicles are not drawn: only a property, or another fixed asset. Of those, only the ones with a value or a loan-to-value to draw count, so a sole card keeps its plain title.
  const drawable = (input.equity ?? []).filter((e) => e.accountClass !== "vehicle").map((asset) => {
    // The value is a shape: a month before the asset had a value is a gap, and nothing here is an amount.
    const values = asset.points.map((p) => (p.assetValueMinor !== null && p.assetValueMinor > 0 ? p.assetValueMinor : null));
    const ltv = asset.linked ? asset.points.map((p) => p.ltvPercent) : [];
    const known = ltv.map((v, i) => ({ v, i })).filter((p): p is { v: number; i: number } => p.v !== null);
    return { asset, values, valueShape: toShape(values), ltv, known };
  }).filter((d) => d.valueShape || d.known.length > 0);
  const names = drawable.map((d) => `${d.asset.accountClass === "property" ? "Property" : "Asset"} value${d.asset.linked ? " & LTV" : ""}`);
  const used = new Map<string, number>();
  const cards: PropertyCard[] = [];
  drawable.forEach(({ values, valueShape, ltv, known }, n) => {
    const number = (used.get(names[n]) ?? 0) + 1;
    used.set(names[n], number);
    const title = names.filter((t) => t === names[n]).length > 1 ? `${names[n]} ${number}` : names[n];
    const labels: Dated[] = [];
    let ltvBlock: PropertyCard["ltv"] = null;
    const extra: Dated[] = [];
    if (known.length > 0) {
      const first = known[0], latest = known[known.length - 1];
      // The latest month with a figure. When later months have none, it is dated rather than called current, and no claim is made about what held since.
      const stale = latest.i < period.months.length - 1;
      const wl = when(period.months[latest.i]);
      if (latest.v > 100) labels.push(stale ? { on: `The loan was above the value in ${wl.on}`, off: `The loan was above the value (${wl.off})` } : both("The loan is above the value"));
      else labels.push(stale ? { on: `You owned ${pct(100 - latest.v)} in ${wl.on}`, off: `You owned ${pct(100 - latest.v)} (${wl.off})` } : both(`You own ${pct(100 - latest.v)}`));
      // Below a mark since the month it got there for good, when it was at or above the mark earlier in the period.
      const crossed = stale ? null : crossedBelow(known, LTV_REFERENCE);
      if (crossed !== null) { const w = when(period.months[crossed]); extra.push({ on: `Below ${LTV_REFERENCE}% since ${w.on}`, off: `Below ${LTV_REFERENCE}% since ${w.off}` }); }
      if (first.i !== latest.i && first.v !== latest.v) extra.push(both(`LTV ${latest.v < first.v ? "down" : "up"} from ${pct(first.v)} to ${pct(latest.v)}`));
      // The chart runs to 100%, or to the highest loan-to-value when the loan is above the value, so a fall from 150% to 120% still shows.
      const top = Math.max(100, ...known.map((p) => p.v));
      ltvBlock = {
        chart: { points: ltv.map((v) => (v === null ? null : asShape(v / top))), zero: asShape(0) },
        latest: { index: asCount(latest.i), label: pct(latest.v) },
        reference: { at: asShape(LTV_REFERENCE / top), label: `${LTV_REFERENCE}%` }, full: { at: asShape(100 / top), label: "100%" },
      };
    }
    // How the value moved over the period, with the same guard as net worth: a change past ten times is not given as a number.
    const knownValues = values.filter((v): v is number => v !== null);
    if (knownValues.length >= 2) {
      const change = changeBetween(knownValues[0], knownValues[knownValues.length - 1]);
      if (change?.kind === "tenfold") labels.push(both(change.direction === "up" ? "Value up by more than 10×" : "Value down by more than 90%"));
      else if (change && (change.kind === "up" || change.kind === "down")) labels.push(both(`Value ${change.kind} ${pct(change.percent)} over the period`));
    }
    labels.push(...extra);
    cards.push({
      kind: "property", id: `property-${n + 1}`, title, axis: axisOf(period), labels: labels.slice(0, 3), valueShape, ltv: ltvBlock,
      info: ltvBlock
        ? "How the asset's value moved over the period, as a shape scaled to its own highest month (no amount is shown), and how much of it is still financed (loan-to-value, a ratio), with a dashed line at 80%. The same figures as Property & assets. The asset and its loan are not named, and no loan terms are shown."
        : "How the asset's value moved over the period, as a shape scaled to its own highest month: no amount is shown. It has no loan linked. The same value as Property & assets, and the asset is not named.",
    });
  });
  return cards;
}

/** The month from which the series stays below `mark` to the end, when an earlier month was at or above it. */
function crossedBelow(known: readonly { v: number; i: number }[], mark: number): number | null {
  if (known[known.length - 1].v >= mark) return null;
  let k = known.length - 1;
  while (k > 0 && known[k - 1].v < mark) k--;
  return k === 0 ? null : known[k].i;
}

// ─── Entry point ─────────────────────────────────────────────────────────────

/** Builds everything the Progress tab shows. The result holds no money amount, currency or name; see the module note. */
export function progressView(input: ProgressInput): ProgressView {
  const when = whenOf(input.period);
  const worth = netWorthCard(input, when);
  const debt = debtCard(input, when);
  const savings = savingsCard(input, when);
  const buffer = bufferCard(input);
  const equity = propertyCards(input, when);
  const composition = compositionCard(input);
  const consistency = consistencyCard(input, when);
  const journey = journeyCard(input, when);
  // The order of the tab: how net worth moved, what is owed, the homes, what you own, then saving and the cash buffer.
  const cards: ProgressCard[] = [];
  if (worth) cards.push(worth);
  if (debt) cards.push(debt);
  cards.push(...equity);
  if (composition) cards.push(composition);
  if (savings) cards.push(savings);
  if (consistency) cards.push(consistency);
  if (journey) cards.push(journey);
  cards.push(buffer);
  return { cards, equityPending: input.equity === null && !input.equityFailed, equityUnavailable: input.equityFailed === true, propertiesUnregistered: input.propertiesUnregistered === true };
}

export type { When };
