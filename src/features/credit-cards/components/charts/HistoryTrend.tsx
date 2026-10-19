"use client";
import { CartesianGrid, ComposedChart, LabelList, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatAmount } from "@/features/assets-debt/lib/money";
import { formatChartDate, formatChartPeriod, SERIES_META } from "@/features/assets-debt/components/chart/chartMeta";

type Point = { date: string; label?: string; value: number | null; source?: string; breakdown?: { label: string; value: number | null }[] };
type Props = {
  title: string;
  points: Point[];
  percent: boolean;
  tone: "debt" | "interest" | "utilization";
  fullDates?: boolean;
  discrete?: boolean;
  solid?: boolean;
};

const DAY = 86400000;
const time = (date: string) => Date.parse(`${date}T00:00:00Z`);
const AXIS_TICK = { fontSize: 11, fill: "var(--muted-foreground)" };

export default function HistoryTrend({ title, points, percent, tone, fullDates = false, discrete = false, solid = false }: Props) {
  const meta = SERIES_META[tone === "interest" ? "cumulativeInterest" : tone === "utilization" ? "interestBearing" : "balance"];
  const display = (value: number) => (percent ? `${value.toFixed(1)}%` : formatAmount(Math.round(value), 2));
  const single = points.filter((point) => point.value !== null).length === 1;
  const lone = single && points.length === 1;
  const compact = (value: number) => (percent ? `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })}%`
    : Math.abs(value) >= 100000 ? `${(value / 100000).toLocaleString(undefined, { maximumFractionDigits: 1 })}k`
      : (value / 100).toLocaleString(undefined, { maximumFractionDigits: 2 }));
  const tickLabel = (value: string | number) => {
    const date = typeof value === "number" ? new Date(value).toISOString().slice(0, 10) : value;
    return fullDates ? formatChartDate(date) : formatChartPeriod(date.slice(0, 7));
  };
  const domain = discrete ? lone ? [time(points[0].date) - DAY, time(points[0].date) + DAY] : ["dataMin", "dataMax"] : undefined;
  const dot = ({ cx, cy, payload }: { cx?: number; cy?: number; payload?: Point }) => (payload?.value == null ? <g />
    : <circle cx={cx} cy={cy} r={3} fill={/estimate|partial coverage/i.test(payload.source ?? "") ? "var(--background)" : meta.color}
      stroke={meta.color} strokeWidth={1.5} />);
  return <div className="h-45 w-full" role="group" aria-label={`${title}. Focus the chart and use arrow keys to step through statements.`}>
    <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 600, height: 180 }}>
      <ComposedChart data={points.map((point) => ({ ...point, timestamp: time(point.date) }))} margin={{ top: 12, right: 20, bottom: 4, left: 12 }}
        accessibilityLayer>
        <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="var(--border)" />
        <XAxis dataKey={discrete ? "timestamp" : "date"} type={discrete ? "number" : "category"} scale={discrete ? "time" : "auto"} domain={domain}
          tickFormatter={tickLabel} tick={AXIS_TICK} minTickGap={24} ticks={lone ? [discrete ? time(points[0].date) : points[0].date] : undefined} />
        <YAxis domain={[0, (max: number) => Math.max(percent ? 1 : 100, max)]} tickFormatter={compact} tick={AXIS_TICK} width={56} />
        <Tooltip
          filterNull={false}
          cursor={{ stroke: "var(--muted-foreground)", strokeDasharray: "3 3", strokeOpacity: 0.45 }}
          isAnimationActive="auto"
          content={({ active, payload }) => {
            const point = (payload?.find((entry) => entry.dataKey === "value")?.payload ?? payload?.[0]?.payload) as Point | undefined;
            if (!active || !point) return null;
            return <div className="min-w-48 rounded-lg border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-lg">
              <p className="mb-1.5 font-medium">{point.label ?? formatChartDate(point.date)}</p>
              <div className="flex items-center justify-between gap-4">
                <span className="flex items-center gap-2 text-muted-foreground">
                  <span className="h-0 w-4 border-t-2" aria-hidden
                    style={{ borderColor: meta.color, borderTopStyle: !solid && meta.dash ? "dashed" : "solid" }} />{title}
                </span>
                <span className="font-medium tabular-nums">{point.value === null ? "Missing evidence" : display(point.value)}</span>
              </div>
              {point.breakdown?.map((item) => <div key={item.label} className="mt-1 flex justify-between gap-4">
                <span className="text-muted-foreground">{item.label}</span>
                <span>{item.value === null ? "Unavailable" : formatAmount(item.value, 2)}</span>
              </div>)}
              {point.source && <p className="mt-2 text-muted-foreground">{point.source}</p>}
            </div>;
          }}
        />
        <ReferenceLine y={0} stroke="var(--border)" />
        <Line type="linear" connectNulls={false} strokeOpacity={1} dataKey="value" name={title} stroke={meta.color} strokeWidth={tone === "debt" ? 2.5 : 1.75}
          strokeDasharray={solid ? undefined : meta.dash} strokeLinecap="round" dot={discrete || single ? dot : false}
          activeDot={{ r: 4, stroke: "var(--background)", strokeWidth: 2 }} isAnimationActive="auto">
          {single && <LabelList dataKey="value" position="top" className="fill-muted-foreground text-[10px]"
            formatter={(value) => (typeof value === "number" ? display(value) : "")} />}
        </Line>
      </ComposedChart>
    </ResponsiveContainer>
  </div>;
}
