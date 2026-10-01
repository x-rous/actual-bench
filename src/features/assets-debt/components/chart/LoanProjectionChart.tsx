"use client";

import { useEffect, useState } from "react";
import { CartesianGrid, ComposedChart, Line, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatAmount, fractionToPercent } from "../../lib/money";
import type { ChartData, ChartRateChangeGroup, SeriesId } from "../../lib/results";
import { formatChartDate, formatChartPeriod, SERIES_META } from "./chartMeta";

/**
 * The loan chart (P1.3b T223; FR-223). The only module that imports Recharts,
 * and it only renders: the series and their values come from the pure
 * `chartSeries()` (lib/results.ts), which reads engine output. Series are
 * told apart by name, dash pattern and colour; Recharts' accessibility layer
 * lets the keyboard step through points; animation is off under reduced motion.
 */

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener?.("change", update);
    return () => query.removeEventListener?.("change", update);
  }, []);
  return reduced;
}

type TooltipEntry = { dataKey?: string | number; value?: string | number; color?: string };

function LoanTooltip({ active, payload, label, digits, rateChanges }: { active?: boolean; payload?: readonly TooltipEntry[]; label?: string | number; digits: number; rateChanges: ChartRateChangeGroup[] }) {
  const period = String(label ?? "");
  const rateChange = rateChanges.find((group) => group.period === period);
  if (!active || (!payload?.length && !rateChange)) return null;
  return (
    <div className="min-w-48 rounded-lg border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-lg">
      <p className="mb-1.5 font-medium">{formatChartPeriod(period)}</p>
      <dl className="flex flex-col gap-1">
        {payload?.map((entry) => {
          const id = String(entry.dataKey) as SeriesId;
          return (
            <div key={id} className="flex items-center justify-between gap-4">
              <dt className="flex items-center gap-2 text-muted-foreground"><span className="h-0 w-4 border-t-2" style={{ borderColor: entry.color, borderTopStyle: SERIES_META[id]?.dash ? "dashed" : "solid" }} aria-hidden />{SERIES_META[id]?.label ?? id}</dt>
              <dd className="font-medium tabular-nums">{formatAmount(Math.round(Number(entry.value)), digits)}</dd>
            </div>
          );
        })}
        {rateChange?.changes.map((change) => (
          <div key={`${change.date}-${change.annualRateDecimal}`} className="flex items-center justify-between gap-4 border-t border-border pt-1">
            <dt className="text-muted-foreground">Rate changed · {formatChartDate(change.date)}</dt>
            <dd className="font-medium tabular-nums">{fractionToPercent(change.annualRateDecimal)}%</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export default function LoanProjectionChart({ data, visible, digits, height = 320 }: { data: ChartData; visible: SeriesId[]; digits: number; height?: number }) {
  const reducedMotion = usePrefersReducedMotion();
  const compact = (v: number) => {
    const major = v / 10 ** digits;
    return Math.abs(major) >= 1_000_000 ? `${(major / 1_000_000).toFixed(1)}M` : Math.abs(major) >= 1_000 ? `${Math.round(major / 1_000)}k` : String(Math.round(major));
  };
  const hasInterestAxis = visible.includes("cumulativeInterest");
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 800, height }}>
        <ComposedChart data={data.points} margin={{ top: 12, right: hasInterestAxis ? 12 : 20, bottom: 4, left: 12 }} accessibilityLayer>
          <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis dataKey="period" tickFormatter={formatChartPeriod} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} minTickGap={24} />
          <YAxis yAxisId="balance" domain={[0, "auto"]} tickFormatter={compact} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} width={56} label={{ value: "Balance", angle: -90, position: "insideLeft", fill: "var(--muted-foreground)", fontSize: 10 }} />
          {hasInterestAxis ? <YAxis yAxisId="interest" orientation="right" domain={[0, "auto"]} tickFormatter={compact} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} width={56} label={{ value: "Interest paid", angle: 90, position: "insideRight", fill: "var(--muted-foreground)", fontSize: 10 }} /> : null}
          <Tooltip content={<LoanTooltip digits={digits} rateChanges={data.rateChanges} />} cursor={{ stroke: "var(--muted-foreground)", strokeDasharray: "3 3", strokeOpacity: 0.45 }} isAnimationActive={!reducedMotion} />
          <ReferenceLine yAxisId="balance" y={0} stroke="var(--border)" />
          {data.rateChanges.map((group) => (
            <ReferenceLine
              key={group.period}
              x={group.period}
              yAxisId="balance"
              stroke="var(--chart-rate-change)"
              strokeDasharray="2 4"
              strokeWidth={1.5}
              label={{
                value: group.changes.map((change) => `${fractionToPercent(change.annualRateDecimal)}%`).join(" → "),
                position: "insideTopRight",
                fill: "var(--chart-rate-change)",
                fontSize: 10,
              }}
            />
          ))}
          {visible.map((id) => (
            <Line
              key={id}
              yAxisId={SERIES_META[id].axis}
              type="monotone"
              dataKey={id}
              name={id}
              stroke={SERIES_META[id].color}
              strokeWidth={id === "balance" ? 2.5 : 1.75}
              strokeDasharray={SERIES_META[id].dash}
              strokeLinecap="round"
              dot={false}
              connectNulls
              isAnimationActive={!reducedMotion}
            />
          ))}
          {data.payoff ? <ReferenceDot yAxisId="balance" x={data.payoff.period} y={0} r={4} fill="var(--chart-1)" stroke="var(--background)" strokeWidth={2} label={{ value: "Paid off", position: "top", fill: "var(--foreground)", fontSize: 10 }} /> : null}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
