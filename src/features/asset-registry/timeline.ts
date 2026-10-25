import { daysInMonth } from "@/lib/financial-models/calendar/dates";
import type { CapitalMovement } from "@/lib/asset-registry/capitalMovements";
import type { CashflowType } from "@/lib/asset-registry/models";

/** Pure data for the two Overview timelines. Both charts use the same buckets, so their columns line up. */
export type View = "monthly" | "yearly";
export type Bucket = { label: string; title: string; from: string; to: string; projected: boolean; current: boolean };
const pad = (n: number) => String(n).padStart(2, "0");
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MAX_YEARS = 15;

/**
 * Last 12 months or every year since `firstDate`, ending with the current (to-date) period, then `future` projected
 * periods. A bucket's `to` is its last day, except the current one, which ends today.
 */
export function buildBuckets(view: View, today: string, firstDate: string | null, future = 0): Bucket[] {
  const year = Number(today.slice(0, 4)); const month = Number(today.slice(5, 7));
  const out: Bucket[] = [];
  if (view === "monthly") {
    for (let i = 11 - 0; i >= -future; i--) {
      const index = year * 12 + (month - 1) - i; const y = Math.floor(index / 12); const m = (index % 12) + 1;
      const end = `${y}-${pad(m)}-${pad(daysInMonth(y, m))}`; const current = i === 0; const projected = i < 0;
      out.push({ label: `${MONTHS[m - 1]} ’${String(y).slice(2)}`, title: `${MONTHS[m - 1]} ${y}${current ? " (to date)" : projected ? " (projected)" : ""}`, from: `${y}-${pad(m)}-01`, to: current ? today : end, projected, current });
    }
  } else {
    const start = Math.max(Math.min(firstDate ? Number(firstDate.slice(0, 4)) : year, year), year - MAX_YEARS + 1);
    for (let y = start; y <= year + future; y++) {
      const current = y === year; const projected = y > year;
      out.push({ label: String(y), title: `${y}${current ? " (to date)" : projected ? " (projected)" : ""}`, from: `${y}-01-01`, to: current ? today : `${y}-12-31`, projected, current });
    }
  }
  return out;
}
/** The bucket containing a date, or -1 when it falls outside the range. */
export const bucketOf = (buckets: Bucket[], date: string) => buckets.findIndex((b) => date >= b.from && date <= b.to);

/** The running value after the last row on or before a date; null before the first row. */
export function valueAtDate(rows: { date: string; runningMinor: number | null }[], date: string): number | null {
  let value: number | null = null; let last = "";
  rows.forEach((row) => { if (row.date <= date && row.date >= last) { last = row.date; value = row.runningMinor; } });
  return value;
}

export type ValuePoint = { label: string; value: number | null; debt: number | null; forecast: number | null };
/**
 * Value and allocated debt at each bucket end. `debtAt` returns null where no debt is plotted (before the first loan
 * allocation, or its dated balance is unknown). The forecast is today's recorded value less the planned decreases of the
 * unposted schedule months up to each future bucket's end; it never rebases on revaluations.
 */
export function valuePoints(buckets: Bucket[], rows: { date: string; runningMinor: number | null }[], currentValue: number | null, debtAt: (date: string) => number | null, unposted: { postDate: string; amountMinor: number }[]): ValuePoint[] {
  return buckets.map((b) => {
    if (b.projected) return { label: b.label, value: null, debt: null, forecast: currentValue === null ? null : currentValue - unposted.filter((u) => u.postDate <= b.to).reduce((s, u) => s + u.amountMinor, 0) };
    return { label: b.label, value: b.current ? currentValue : valueAtDate(rows, b.to), debt: debtAt(b.to), forecast: b.current && unposted.length > 0 ? currentValue : null };
  });
}

export type MarkerKind = "in" | "revalue" | "out" | "depreciation" | "operating" | "financing";
export type Marker = { index: number; kind: MarkerKind; count: number; amountMinor: number; types: string[]; from: string; to: string; /** Plain-language text for markers that are not transactions (financing changes). */ note?: string };
const BOOK_KIND: Record<string, MarkerKind> = { acquisition: "in", "capital-expenditure": "in", revaluation: "revalue", impairment: "revalue", "ownership-adjustment": "revalue", disposal: "out", depreciation: "depreciation" };
/** Book events grouped per bucket and kind, so a busy month is one marker, not a pile. */
export function bookMarkers(buckets: Bucket[], rows: { date: string; classification: string | null; amountMinor: number }[]): Marker[] {
  const groups = new Map<string, Marker>();
  for (const row of rows) {
    const kind = BOOK_KIND[row.classification ?? ""]; const index = bucketOf(buckets, row.date);
    if (!kind || index < 0) continue;
    const key = `${index}:${kind}`; const g = groups.get(key) ?? { index, kind, count: 0, amountMinor: 0, types: [], from: buckets[index].from, to: buckets[index].to };
    g.count += 1; g.amountMinor += row.amountMinor; if (!g.types.includes(row.classification!)) g.types.push(row.classification!); groups.set(key, g);
  }
  return [...groups.values()].sort((a, b) => a.index - b.index);
}

export const INCOME_TYPES: CashflowType[] = ["rental-income", "dividends-distributions", "interest-yield", "other-income"];
export const EXPENSE_TYPES: CashflowType[] = ["operating-expense", "taxes-insurance-service-charges", "financing-interest"];
export type OperatingEntry = { date: string; type: CashflowType; amountMinor: number };
export type CashflowPoint = { label: string; income: number; expenses: number; net: number; investment: number; capex: number; disposal: number; projected: boolean };
/** Operating income (positive) and expenses (negative) per bucket; capital movements kept apart so they never change the net. */
export function cashflowPoints(buckets: Bucket[], operating: OperatingEntry[], capital: CapitalMovement[]): CashflowPoint[] {
  return buckets.map((b, index) => {
    const inB = (date: string) => bucketOf(buckets, date) === index;
    const income = operating.filter((e) => inB(e.date) && INCOME_TYPES.includes(e.type) && e.amountMinor > 0).reduce((s, e) => s + e.amountMinor, 0);
    const expenses = operating.filter((e) => inB(e.date) && EXPENSE_TYPES.includes(e.type) && e.amountMinor < 0).reduce((s, e) => s + e.amountMinor, 0);
    const cap = (kind: CapitalMovement["kind"]) => capital.filter((m) => m.kind === kind && inB(m.date)).reduce((s, m) => s + m.amountMinor, 0);
    return { label: b.label, income, expenses, net: income + expenses, investment: cap("investment"), capex: cap("capex"), disposal: cap("disposal"), projected: b.projected };
  });
}
/** Capital movements grouped per bucket and kind, plus one "operating" marker for each bucket with income or expenses. */
export function cashflowMarkers(buckets: Bucket[], points: CashflowPoint[], capital: CapitalMovement[]): Marker[] {
  const markers: Marker[] = [];
  points.forEach((p, index) => {
    if (p.income !== 0 || p.expenses !== 0) markers.push({ index, kind: "operating", count: 0, amountMinor: p.net, types: [], from: buckets[index].from, to: buckets[index].to });
    for (const kind of ["investment", "capex", "disposal"] as const) {
      const items = capital.filter((m) => m.kind === kind && bucketOf(buckets, m.date) === index);
      if (items.length) markers.push({ index, kind: kind === "disposal" ? "out" : "in", count: items.length, amountMinor: items.reduce((s, m) => s + m.amountMinor, 0), types: [kind], from: buckets[index].from, to: buckets[index].to });
    }
  });
  return markers;
}

export type FinancingEvent = { date: string; text: string };
/**
 * Loan allocation changes in plain words, so a drop in allocated debt is not mistaken for a repayment. A period that
 * starts where the previous one for the same loan ended is a change; the first is a link; an end with no successor is an end.
 */
export function financingEvents(links: { debtId: string; allocationBps: number; effectiveFrom: string; effectiveTo: string | null }[], loanName: (debtId: string) => string): FinancingEvent[] {
  const pct = (bps: number) => `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 2)}%`;
  const events: FinancingEvent[] = [];
  for (const debtId of [...new Set(links.map((l) => l.debtId))]) {
    const periods = links.filter((l) => l.debtId === debtId).sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
    periods.forEach((link, i) => {
      const previous = periods[i - 1];
      events.push({ date: link.effectiveFrom, text: !previous ? `${loanName(debtId)}: allocated at ${pct(link.allocationBps)}` : previous.effectiveTo === link.effectiveFrom ? `${loanName(debtId)}: allocation changed from ${pct(previous.allocationBps)} to ${pct(link.allocationBps)}` : `${loanName(debtId)}: allocation resumed at ${pct(link.allocationBps)}` });
      if (link.effectiveTo && !periods.some((other) => other.effectiveFrom === link.effectiveTo)) events.push({ date: link.effectiveTo, text: `${loanName(debtId)}: allocation ended` });
    });
  }
  return events.sort((a, b) => a.date.localeCompare(b.date));
}
/** One marker per bucket for financing changes, carrying their text. */
export function financingMarkers(buckets: Bucket[], events: FinancingEvent[]): Marker[] {
  const byBucket = new Map<number, string[]>();
  for (const e of events) { const index = bucketOf(buckets, e.date); if (index >= 0) byBucket.set(index, [...(byBucket.get(index) ?? []), e.text]); }
  return [...byBucket].map(([index, texts]) => ({ index, kind: "financing" as const, count: texts.length, amountMinor: 0, types: [], from: buckets[index].from, to: buckets[index].to, note: texts.join("; ") })).sort((a, b) => a.index - b.index);
}
