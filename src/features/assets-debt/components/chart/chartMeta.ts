import type { SeriesId } from "../../lib/results";

export const SERIES_META: Record<SeriesId, { label: string; color: string; dash?: string; axis: "balance" | "interest" }> = {
  balance: { label: "Loan balance", color: "var(--chart-1)", axis: "balance" },
  comparison: { label: "Saved loan balance", color: "var(--chart-3)", dash: "8 4", axis: "balance" },
  offsetBalance: { label: "Offset balance", color: "var(--chart-2)", dash: "2 3", axis: "balance" },
  interestBearing: { label: "Interest-bearing balance", color: "var(--chart-4)", dash: "10 3 2 3", axis: "balance" },
  cumulativeInterest: { label: "Interest paid so far", color: "var(--chart-5)", dash: "1 4", axis: "interest" },
};

const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatChartPeriod(period: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(period);
  if (!match) return period;
  const month = SHORT_MONTHS[Number(match[2]) - 1];
  return month ? `${month} ’${match[1].slice(2)}` : period;
}

export function formatChartDate(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return date;
  const month = SHORT_MONTHS[Number(match[2]) - 1];
  return month ? `${Number(match[3])} ${month} ${match[1]}` : date;
}
