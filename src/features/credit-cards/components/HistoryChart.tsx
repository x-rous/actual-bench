"use client";

import { lazyChart } from "./charts/lazyChart";
import { addMonths } from "@/lib/financial-models/calendar/dates";

const loading = <div className="h-45 animate-pulse rounded bg-muted/40" aria-hidden />;
const trend = lazyChart(() => import("./charts/HistoryTrend"));
const bars = lazyChart(() => import("./charts/CardStatementTrend"));
const HistoryTrend = trend.Chart;
const MonthlyBars = bars.Chart;
/** Warms both trend chart modules (the All cards Trends panel and Insights). */
export const preloadHistoryCharts = () => Promise.all([trend.preload(), bars.preload()]);

type Point = { date: string; label?: string; value: number | null; source?: string; breakdown?: { label: string; value: number | null }[] };
type Props = {
  title: string;
  points: Point[];
  kind?: "bar" | "line";
  allowSingle?: boolean;
  monthly?: boolean;
  observationLabel?: string;
  historical?: boolean;
  percent?: boolean;
  tone?: "debt" | "interest" | "utilization";
};

/** Same interactive chart library and visual conventions as the loan calculator; no hypothetical baseline (UI-15). */
export function HistoryChart(props: Props) {
  const { title, points, percent = false, tone = "debt", historical = true, monthly = false, allowSingle = true, observationLabel, kind } = props;
  const chartPoints = points.flatMap((point, index) => {
    const previous = points[index - 1];
    const gap = historical && previous && point.date.slice(0, 7) > addMonths(previous.date, 1).slice(0, 7);
    return gap ? [{ date: addMonths(previous.date, 1), value: null }, point] : [point];
  });
  if (points.filter((point) => point.value !== null).length < (allowSingle ? 1 : 2)) {
    return <div className="flex min-w-0 flex-col rounded-lg border border-border bg-background p-4">
      <h3 className="text-sm font-semibold">{title}</h3>
      <p className="mt-3 text-xs text-muted-foreground">
        {allowSingle ? "No known values in the tracked history yet." : "At least two statement periods with known values are needed for a trend."}
      </p>
    </div>;
  }
  return <figure className="flex min-w-0 flex-col rounded-lg border border-border bg-background p-4">
    <figcaption className="mb-3 text-sm font-semibold">{title}</figcaption>
    {kind === "bar"
      ? <MonthlyBars fallback={loading} title={title} points={chartPoints} monthly={monthly} tone={tone} percent={percent} />
      : <HistoryTrend fallback={loading} title={title} points={chartPoints} percent={percent} tone={tone} fullDates={!monthly} discrete={historical} solid />}
    {historical && observationLabel && <p className="mt-1 text-xs text-muted-foreground">{observationLabel}</p>}
  </figure>;
}
