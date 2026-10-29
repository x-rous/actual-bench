"use client";

import { useEffect, useState } from "react";
import { CartesianGrid, ComposedChart, Line, ReferenceArea, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatAmount, fractionToPercent } from "../../lib/money";
import type { ChartData, ChartPoint, ChartRateChangeGroup, SeriesId } from "../../lib/results";
import { formatChartDate, formatChartPeriod, formatElapsed, SERIES_META } from "./chartMeta";

/**
 * The loan chart (P1.3b T223; FR-223). Loaded lazily alongside the other financial charts,
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

const SOURCE_LABEL = { contract: "Contract", actual: "Actual", projected: "Projected" } as const;

type TooltipEntry = { dataKey?: string | number; value?: string | number; color?: string; payload?: ChartPoint };

function LoanTooltip({ active, payload, label, digits, rateChanges }: { active?: boolean; payload?: readonly TooltipEntry[]; label?: string | number; digits: number; rateChanges: ChartRateChangeGroup[] }) {
  const period = String(label ?? "");
  const rateChange = rateChanges.find((group) => group.period === period);
  const point = payload?.[0]?.payload;
  if (!active || (!payload?.length && !rateChange)) return null;
  return (
    <div className="min-w-48 rounded-lg border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-lg">
      <p className="mb-1.5 font-medium">{formatChartPeriod(period)}</p>
      {point && (point.installment !== undefined || point.elapsedMonths !== undefined || point.repaidPercent !== undefined) ? (
        <dl className="mb-1.5 flex flex-col gap-1 border-b border-border pb-1.5">
          {point.installment !== undefined ? <div className="flex items-center justify-between gap-4"><dt className="text-muted-foreground">Installment</dt><dd className="font-medium tabular-nums">{point.installment}</dd></div> : null}
          {point.elapsedMonths !== undefined ? <div className="flex items-center justify-between gap-4"><dt className="text-muted-foreground">Elapsed</dt><dd className="font-medium">{formatElapsed(point.elapsedMonths)}</dd></div> : null}
          {point.repaidPercent !== undefined ? <div className="flex items-center justify-between gap-4"><dt className="text-muted-foreground">Repaid</dt><dd className="font-medium tabular-nums">{point.repaidPercent}%</dd></div> : null}
        </dl>
      ) : null}
      {point && (point.paymentMinor !== undefined || point.extraMinor !== undefined || point.source) ? (
        <dl className="mb-1.5 flex flex-col gap-1 border-b border-border pb-1.5">
          {point.paymentMinor !== undefined ? <div className="flex items-center justify-between gap-4"><dt className="text-muted-foreground">Payment</dt><dd className="font-medium tabular-nums">{formatAmount(point.paymentMinor, digits)}</dd></div> : null}
          {point.paymentMinor !== undefined && point.paymentInterestMinor ? <div className="flex items-center justify-between gap-4"><dt className="pl-3 text-muted-foreground">of which interest</dt><dd className="tabular-nums text-muted-foreground">{formatAmount(point.paymentInterestMinor, digits)}</dd></div> : null}
          {point.extraMinor ? <div className="flex items-center justify-between gap-4"><dt className="text-muted-foreground">Extra payment</dt><dd className="font-medium tabular-nums">{formatAmount(point.extraMinor, digits)}</dd></div> : null}
          {point.source ? <div className="flex items-center justify-between gap-4"><dt className="text-muted-foreground">Source</dt><dd className="font-medium">{SOURCE_LABEL[point.source]}</dd></div> : null}
        </dl>
      ) : null}
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
  // One shared axis when interest paid reaches 40% of the largest balance; two otherwise, so a short loan's interest line
  // isn't flattened. The 35%–45% band keeps the current choice, so the chart doesn't flip while a figure is typed.
  const maxBalance = data.points.reduce((m, p) => Math.max(m, p.balance ?? 0, p.actualBalance ?? 0, p.comparison ?? 0), 0);
  const maxInterest = data.points.reduce((m, p) => Math.max(m, p.cumulativeInterest ?? 0), 0);
  const [sharedAxis, setSharedAxis] = useState<boolean | null>(null);
  const ratio = maxBalance > 0 ? maxInterest / maxBalance : 0;
  const shared = sharedAxis === null ? ratio >= 0.4 : sharedAxis ? ratio >= 0.35 : ratio >= 0.45;
  if (shared !== sharedAxis) setSharedAxis(shared);
  const hasInterestAxis = visible.includes("cumulativeInterest") && !shared;
  const axisOf = (id: SeriesId) => (SERIES_META[id].axis === "interest" && !hasInterestAxis ? "balance" : SERIES_META[id].axis);
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 800, height }}>
        <ComposedChart data={data.points} margin={{ top: 12, right: hasInterestAxis ? 12 : 20, bottom: 4, left: 12 }} accessibilityLayer>
          <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis dataKey="period" tickFormatter={formatChartPeriod} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} minTickGap={24} />
          <YAxis yAxisId="balance" domain={[0, "auto"]} tickFormatter={compact} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} width={56} label={{ value: hasInterestAxis || !visible.includes("cumulativeInterest") ? "Balance" : "Amount", angle: -90, position: "insideLeft", fill: "var(--muted-foreground)", fontSize: 10 }} />
          {hasInterestAxis ? <YAxis yAxisId="interest" orientation="right" domain={[0, "auto"]} tickFormatter={compact} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} width={56} label={{ value: "Interest paid", angle: 90, position: "insideRight", fill: "var(--muted-foreground)", fontSize: 10 }} /> : null}
          <Tooltip content={<LoanTooltip digits={digits} rateChanges={data.rateChanges} />} cursor={{ stroke: "var(--muted-foreground)", strokeDasharray: "3 3", strokeOpacity: 0.45 }} isAnimationActive={!reducedMotion} />
          <ReferenceLine yAxisId="balance" y={0} stroke="var(--border)" />
          {data.tracking && data.tracking.untrackedBefore && data.tracking.startPeriod > data.tracking.firstPeriod ? (
            <ReferenceArea yAxisId="balance" x1={data.tracking.firstPeriod} x2={data.tracking.startPeriod} fill="var(--muted)" fillOpacity={0.6} strokeOpacity={0} label={{ value: "Before tracking", position: "insideLeft", fill: "var(--muted-foreground)", fontSize: 10 }} />
          ) : null}
          {data.tracking ? <ReferenceLine yAxisId="balance" x={data.tracking.todayPeriod} stroke="var(--foreground)" strokeOpacity={0.5} strokeDasharray="3 3" label={{ value: "Today", position: "insideTopLeft", fill: "var(--foreground)", fontSize: 10 }} /> : null}
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
              yAxisId={axisOf(id)}
              type={id === "actualBalance" ? "stepAfter" : "monotone"}
              dataKey={id}
              name={id}
              stroke={SERIES_META[id].color}
              // Actual's balance steps on payment dates; drawn lighter so it reads as a reference beside the loan's line.
              strokeWidth={id === "balance" ? 2.5 : id === "actualBalance" ? 1.5 : 1.75}
              strokeOpacity={id === "actualBalance" ? 0.75 : 1}
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
