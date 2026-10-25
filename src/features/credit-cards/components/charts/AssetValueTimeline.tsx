"use client";
import { CartesianGrid, ComposedChart, Line, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatAmount } from "@/features/assets-debt/lib/money";

type Point = { label: string; title: string; value: number | null; debt: number | null; forecast: number | null; projected: boolean };
const AXIS = { fontSize: 11, fill: "var(--muted-foreground)" };
/** Same margins and axis width as the cash flow timeline, so both charts' columns line up. */
export const TIMELINE_MARGIN = { top: 8, right: 16, bottom: 4, left: 8 };
export const TIMELINE_AXIS_WIDTH = 64;
const compact = (minor: number) => Math.abs(minor) >= 100000 ? `${(minor / 100000).toLocaleString(undefined, { maximumFractionDigits: 1 })}k` : (minor / 100).toLocaleString(undefined, { maximumFractionDigits: 0 });
const DEBT = "#e11d48";

/** Recorded value, allocated debt (same scale) and an optional dashed forecast; equity is the gap, read in the tooltip. */
export default function AssetValueTimeline({ points, onActive }: { points: Point[]; /** The hovered column, or null when the pointer leaves. */ onActive?: (index: number | null) => void }) {
  const data = points.map((p) => ({ ...p, equity: p.value !== null && p.debt !== null ? p.value - p.debt : null }));
  const projected = data.filter((p) => p.projected);
  const hasDebt = data.some((p) => p.debt !== null);
  return <div className="h-[230px] w-full" role="img" aria-label="Recorded value over time with allocated debt and projected depreciation">
    <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 800, height: 230 }}>
      <ComposedChart data={data} margin={TIMELINE_MARGIN} onMouseMove={(state) => { const i = Number(state?.activeTooltipIndex); onActive?.(Number.isInteger(i) ? i : null); }} onMouseLeave={() => onActive?.(null)}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="var(--border)" />
        {projected.length > 0 && <ReferenceArea x1={projected[0].label} x2={projected[projected.length - 1].label} fill="var(--muted)" fillOpacity={0.45} ifOverflow="visible" label={{ value: "Projected", position: "insideTopRight", fontSize: 10, fill: "var(--muted-foreground)" }} />}
        <XAxis dataKey="label" scale="band" interval={0} tick={AXIS} />
        <YAxis domain={[0, (max: number) => Math.max(100, max)]} tickFormatter={compact} tick={AXIS} width={TIMELINE_AXIS_WIDTH} />
        <Tooltip filterNull={false} cursor={{ stroke: "var(--muted-foreground)", strokeDasharray: "3 3", strokeOpacity: 0.45 }} content={({ active, payload }) => {
          const p = payload?.[0]?.payload as (typeof data)[number] | undefined;
          if (!active || !p) return null;
          const row = (label: string, value: string, color?: string) => <div className="flex justify-between gap-4"><span className="flex items-center gap-1.5 text-muted-foreground">{color && <span className="size-2 rounded-full" style={{ background: color }} aria-hidden />}{label}</span><span className="font-medium tabular-nums">{value}</span></div>;
          return <div className="min-w-52 space-y-1 rounded-lg border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-lg"><p className="mb-1 font-medium">{p.title}</p>
            {p.projected ? row("Projected value", p.forecast === null ? "Unavailable" : formatAmount(p.forecast, 2), "var(--chart-1)") : <>
              {row("Recorded value", p.value === null ? "Before first row" : formatAmount(p.value, 2), "var(--chart-1)")}
              {hasDebt && row("Allocated debt", p.debt === null ? "Unavailable" : formatAmount(p.debt, 2), DEBT)}
              {hasDebt && row("Equity", p.equity === null ? "Unavailable" : formatAmount(p.equity, 2))}
              {p.forecast !== null && row("Projected if unposted months post", formatAmount(p.forecast, 2))}</>}
          </div>;
        }} />
        <Line type="stepAfter" dataKey="value" name="Recorded value" connectNulls={false} stroke="var(--chart-1)" strokeWidth={2.5} dot={{ r: 3, strokeWidth: 1.5 }} activeDot={{ r: 4, stroke: "var(--background)", strokeWidth: 2 }} isAnimationActive="auto" />
        {hasDebt && <Line type="stepAfter" dataKey="debt" name="Allocated debt" connectNulls={false} stroke={DEBT} strokeWidth={2} dot={{ r: 2.5, strokeWidth: 1.5 }} isAnimationActive="auto" />}
        <Line type="linear" dataKey="forecast" name="Projected" connectNulls={false} stroke="var(--chart-1)" strokeWidth={2} strokeDasharray="5 4" dot={false} isAnimationActive="auto" />
      </ComposedChart>
    </ResponsiveContainer>
  </div>;
}
