"use client";

import { Bar, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { compactMoney, money } from "../format";

export type ChartSeries = { label: string; color: string };
export type ChartPoint = { label: string; partial: boolean; values: (number | null)[] };

const AXIS_TICK = { fontSize: 11, fill: "var(--muted-foreground)" };

/**
 * The drawn chart behind the Line and Bars modes. Both draw the same series and points, on one shared scale; a month
 * with no value is a gap, never zero.
 */
export default function ChartCanvas({ title, series, points, mode }: { title: string; series: ChartSeries[]; points: ChartPoint[]; mode: "line" | "bar" }) {
  const data = points.map((p) => ({ label: p.label, partial: p.partial, ...Object.fromEntries(p.values.map((v, i) => [`s${i}`, v])) }));
  return (
    <div className="h-80 w-full" role="group" aria-label={`${title}. A table of the same figures is available.`}>
      <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 800, height: 320 }}>
        <ComposedChart data={data} margin={{ top: 12, right: 20, bottom: 4, left: 12 }} accessibilityLayer>
          <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis dataKey="label" tick={AXIS_TICK} minTickGap={16} />
          <YAxis tickFormatter={compactMoney} tick={AXIS_TICK} width={64} domain={mode === "bar" ? [(min: number) => Math.min(0, min), "auto"] : ["auto", "auto"]} />
          {mode === "bar" && <ReferenceLine y={0} stroke="var(--border)" />}
          <Tooltip
            cursor={mode === "bar" ? { fill: "var(--muted)", opacity: 0.4 } : { stroke: "var(--muted-foreground)", strokeDasharray: "3 3", strokeOpacity: 0.45 }}
            content={({ active, payload }) => {
              const point = payload?.[0]?.payload as { label: string; partial: boolean } | undefined;
              if (!active || !point) return null;
              return (
                <div className="min-w-52 rounded-lg border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-lg">
                  <p className="mb-1.5 font-medium">{point.label}{point.partial && <span className="ml-2 font-normal text-muted-foreground">partial month</span>}</p>
                  {series.map((s, i) => {
                    const value = (payload?.find((p) => p.dataKey === `s${i}`)?.value ?? null) as number | null;
                    return (
                      <div key={s.label} className="flex items-center justify-between gap-4 py-0.5">
                        <span className="flex items-center gap-2 text-muted-foreground"><span className="size-2 rounded-sm" style={{ background: s.color }} aria-hidden />{s.label}</span>
                        <span className="font-medium tabular-nums">{value === null ? "Unavailable" : money(value)}</span>
                      </div>
                    );
                  })}
                </div>
              );
            }}
          />
          {series.map((s, i) => mode === "bar"
            ? <Bar key={s.label} dataKey={`s${i}`} name={s.label} fill={s.color} radius={[2, 2, 0, 0]} isAnimationActive={false} />
            : <Line key={s.label} dataKey={`s${i}`} name={s.label} stroke={s.color} strokeWidth={i === 0 ? 2.5 : 2} type="linear" connectNulls={false} dot={points.length <= 24} isAnimationActive={false} />)}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
