import type { SeriesId } from "../../lib/results";

/** Even amount grid in minor units, including zero and at most 15 lines. */
export function amountGrid(maximum: number): { grid: number[]; labels: number[] } {
  const rawStep = Math.max(maximum, 1) / 14;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const step = Math.max(1, ([1, 2, 5, 10].find((n) => n * magnitude >= rawStep) ?? 10) * magnitude);
  const count = Math.min(14, Math.ceil(Math.max(maximum, 1) / step));
  const grid = Array.from({ length: count + 1 }, (_, index) => index * step);
  const labelEvery = count > 10 ? 2 : 1;
  return { grid, labels: grid.filter((_, index) => index % labelEvery === 0) };
}

export const SERIES_META: Record<SeriesId, { label: string; color: string; dash?: string; axis: "balance" | "interest" }> = {
  balance: { label: "Loan balance", color: "var(--chart-1)", axis: "balance" },
  actualBalance: { label: "Balance in Actual", color: "var(--chart-2)", axis: "balance" },
  comparison: { label: "Saved loan balance", color: "var(--chart-3)", dash: "8 4", axis: "balance" },
  baseline: { label: "Without what-ifs", color: "var(--chart-4)", dash: "6 4", axis: "balance" },
  offsetBalance: { label: "Offset balance", color: "var(--chart-2)", dash: "2 3", axis: "balance" },
  interestBearing: { label: "Interest-bearing balance", color: "var(--chart-4)", dash: "10 3 2 3", axis: "balance" },
  cumulativeInterest: { label: "Interest paid", color: "var(--chart-5)", dash: "1 4", axis: "interest" },
};

const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatChartPeriod(period: string): string {
  if (period.startsWith("opening:")) return "Start";
  const match = /^(\d{4})-(\d{2})$/.exec(period);
  if (!match) return period;
  const month = SHORT_MONTHS[Number(match[2]) - 1];
  return month ? `${month} ’${match[1].slice(2)}` : period;
}

export function formatChartDate(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return date;
  const month = SHORT_MONTHS[Number(match[2]) - 1];
  return month ? `${match[3]} ${month} ${match[1]}` : date;
}

/** "3 years, 2 months", "1 year", "5 months": time elapsed since the loan started. */
export function formatElapsed(months: number): string {
  const years = Math.floor(months / 12);
  const rest = months % 12;
  const part = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"}`;
  if (years === 0 && rest === 0) return "Less than a month";
  return [years ? part(years, "year") : "", rest ? part(rest, "month") : ""].filter(Boolean).join(", ");
}
