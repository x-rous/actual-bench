"use client";
import { useState } from "react";
import { Bar, CartesianGrid, Cell, ComposedChart, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatAmount } from "@/features/assets-debt/lib/money";
import { formatChartDate, formatChartPeriod } from "@/features/assets-debt/components/chart/chartMeta";

export type CardPoint = { date: string; label?: string; value: number | null; source?: string; breakdown?: { label: string; value: number | null }[] };
type Props = { title: string; points: CardPoint[]; tone: "debt" | "interest" | "utilization"; monthly: boolean; percent?: boolean };

const AXIS_TICK = { fontSize: 11, fill: "var(--muted-foreground)" };

/** Period charges use bars; balance trends use the shared loan HistoryTrend. */
export default function CardTrend({ title, points, tone, monthly, percent = false }: Props) {
  const [width, setWidth] = useState(500);
  const color = tone === "interest" ? "var(--chart-5)" : "var(--chart-1)";
  const display = (value: number) => (percent ? `${value.toFixed(1)}%` : formatAmount(value, 2));
  const compact = (value: number) => (percent ? `${value}%`
    : Math.abs(value) >= 100000 ? `${(value / 100000).toLocaleString(undefined, { maximumFractionDigits: 1 })}k`
      : (value / 100).toLocaleString(undefined, { maximumFractionDigits: 2 }));
  return <div className="h-45 w-full" role="group" aria-label={`${title}. Focus the chart and use arrow keys to inspect observations.`}>
    <ResponsiveContainer width="100%" height="100%" onResize={(next) => setWidth(next)} initialDimension={{ width: 500, height: 180 }}>
      <ComposedChart data={points} margin={{ top: 18, right: 20, left: 12, bottom: 4 }} accessibilityLayer>
        <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
        <XAxis dataKey="date" tickFormatter={(date: string) => (monthly ? formatChartPeriod(date.slice(0, 7)) : formatChartDate(date))}
          tick={AXIS_TICK} minTickGap={24} />
        <YAxis tickFormatter={compact} tick={AXIS_TICK} width={56} />
        <Tooltip content={({ active, payload }) => {
          const point = payload?.[0]?.payload as CardPoint | undefined;
          if (!active || !point) return null;
          return <div className="max-w-sm rounded-lg border bg-popover p-3 text-xs text-popover-foreground shadow-lg">
            <p className="font-medium">{point.label ?? formatChartDate(point.date)}</p>
            <p className="mt-1 tabular-nums">{point.value === null ? "Missing evidence" : display(point.value)}</p>
            {point.breakdown?.map((item) => <div key={item.label} className="mt-1 flex justify-between gap-4">
              <span className="text-muted-foreground">{item.label}</span><span>{item.value == null ? "Unavailable" : display(item.value)}</span>
            </div>)}
            <p className="mt-2 text-muted-foreground">{point.source}</p>
          </div>;
        }} />
        <Bar dataKey="value" maxBarSize={52} radius={[4, 4, 0, 0]} isAnimationActive={false}>
          {points.length * 68 < width && <LabelList dataKey="value" position="top" className="fill-muted-foreground text-[10px]"
            formatter={(value) => (typeof value === "number" ? display(value) : "")} />}
          {points.map((point) => <Cell key={point.date} fill={/estimate|partial coverage/i.test(point.source ?? "") ? "var(--background)" : color}
            fillOpacity={0.8} stroke={color} />)}
        </Bar>
      </ComposedChart>
    </ResponsiveContainer>
  </div>;
}
