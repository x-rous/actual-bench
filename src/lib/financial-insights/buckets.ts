import { monthLabel } from "./period";

/** The unit the Spending tab's month-by-month cards can be read in. */
export type Granularity = "month" | "quarter" | "year";

export const GRANULARITY_NAME: Record<Granularity, { one: string; many: string }> = {
  month: { one: "month", many: "months" },
  quarter: { one: "quarter", many: "quarters" },
  year: { one: "year", many: "years" },
};

export type Bucket = {
  /** Unique within the period: `2026-03`, `2026-Q1` or `2026`. */
  key: string;
  label: string;
  /** The first and last month of the period that fall in it (`YYYY-MM`), for the transactions behind a figure. */
  first: string;
  last: string;
  /** Positions of its months in the period's list of months. */
  indexes: number[];
  /** Not a whole unit: a month still running, a quarter or year the period only partly covers, or one that includes a month before the budget has data. Never compared with whole ones. */
  partial: boolean;
  /** At least one of its months holds data. */
  hasData: boolean;
};

const unitKey = (month: string, g: Granularity): string => {
  if (g === "month") return month;
  if (g === "year") return month.slice(0, 4);
  return `${month.slice(0, 4)}-Q${Math.floor((Number(month.slice(5, 7)) - 1) / 3) + 1}`;
};

const unitLabel = (key: string, month: string, g: Granularity): string => (g === "month" ? monthLabel(month) : g === "year" ? key : `${key.slice(5)} ${key.slice(0, 4)}`);

/** How many months a whole unit has. */
const SPAN: Record<Granularity, number> = { month: 1, quarter: 3, year: 12 };

/**
 * Groups the months of a period into calendar quarters or years (or leaves them as months). A group is partial when the period
 * does not hold all of its months, when one of its months is the month still running, or when one of them has no data yet.
 */
export function bucketMonths(months: readonly string[], hasData: readonly boolean[], partial: readonly boolean[], g: Granularity): Bucket[] {
  const buckets: Bucket[] = [];
  months.forEach((month, i) => {
    const key = unitKey(month, g);
    const last = buckets[buckets.length - 1];
    if (last && last.key === key) {
      last.indexes.push(i);
      last.last = month;
      last.hasData ||= hasData[i];
      last.partial ||= partial[i] || !hasData[i];
      return;
    }
    buckets.push({ key, label: unitLabel(key, month, g), first: month, last: month, indexes: [i], partial: partial[i] || (g !== "month" && !hasData[i]), hasData: hasData[i] });
  });
  // A unit the period holds only part of: fewer months than a whole one.
  for (const b of buckets) if (b.indexes.length < SPAN[g]) b.partial = true;
  return buckets;
}

/** What a series adds up to over the months of a bucket; a month before the budget has data counts as nothing. */
export function sumOver(values: readonly number[], bucket: Bucket, hasData: readonly boolean[]): number {
  return bucket.indexes.reduce((sum, i) => sum + (hasData[i] ? values[i] : 0), 0);
}

// ─── Balances ─────────────────────────────────────────────────────────────────

/**
 * The unit a chart of month-end balances opens in, by how long the period is, so a long period is readable at once: months up to
 * eighteen, quarters up to five years, years beyond that. A viewer's own choice replaces it.
 */
export function defaultGranularity(monthCount: number): Granularity {
  return monthCount <= 18 ? "month" : monthCount <= 60 ? "quarter" : "year";
}

/** The months of a period grouped for a chart of balances. A balance is complete at any moment, so none is partial in itself. */
export function balanceBuckets(months: readonly string[], g: Granularity): Bucket[] {
  return bucketMonths(months, months.map(() => true), months.map(() => false), g);
}

/** The position, in the period's months, of the month whose end balance stands for the bucket: its last. */
export const lastIndex = (bucket: Bucket): number => bucket.indexes[bucket.indexes.length - 1];

/** The bucket stops before the end of its quarter or year because the period does: its balance is the period's end, not the quarter's or year's. */
export function endsEarly(bucket: Bucket, g: Granularity): boolean {
  const monthNo = Number(bucket.last.slice(5, 7));
  return g === "quarter" ? monthNo % 3 !== 0 : g === "year" ? monthNo !== 12 : false;
}
