"use client";

import { useEffect, useState } from "react";
import { CartesianGrid, ComposedChart, Line, ReferenceArea, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatAmount, fractionToPercent } from "../../lib/money";
import type { ChartData, ChartPoint, ChartRateChangeGroup, SeriesId } from "../../lib/results";
import { amountGrid, formatChartDate, formatChartPeriod, formatElapsed, SERIES_META } from "./chartMeta";

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
const EVENT_LABELS: Record<string, string> = { "extra-repayment": "Extra payment", draw: "Draw", fee: "Fee", recast: "Repayment recalculated", "payment-change": "Repayment change", "offset-change": "Offset changed" };

type TooltipEntry = { dataKey?: string | number; value?: string | number; color?: string; payload?: ChartPoint };

function LoanTooltip({ active, payload, label, digits, rateChanges, showEvents }: { active?: boolean; payload?: readonly TooltipEntry[]; label?: string | number; digits: number; rateChanges: ChartRateChangeGroup[]; showEvents?: boolean }) {
  const point = payload?.[0]?.payload;
  const period = point?.period ?? (typeof label === "number" && Number.isFinite(label) ? new Date(label).toISOString().slice(0, 7) : String(label ?? ""));
  const rateChange = rateChanges.find((group) => group.period === period);
  const percentage = (amount: number, total: number | undefined, description: string) => {
    if (total === undefined || total <= 0 || amount < 0 || amount > total) return null;
    const value = Math.round(amount / total * 1000) / 10;
    return <span className="mr-1 text-[10px] font-normal text-muted-foreground" aria-label={`${value}% ${description}`}>({value}%)</span>;
  };
  if (!active || (!payload?.length && !rateChange)) return null;
  return (
    <div className="min-w-48 rounded-lg border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-lg">
      <p className="mb-1.5 font-medium">{point?.openingDate ? `Start · ${formatChartDate(point.openingDate)}` : formatChartPeriod(period)}</p>
      {point && (point.installment !== undefined || point.elapsedMonths !== undefined || point.repaidPercent !== undefined) ? (
        <dl className="mb-1.5 flex flex-col gap-1 border-b border-border pb-1.5">
          {point.installment !== undefined ? <div className="flex items-center justify-between gap-4"><dt className="text-muted-foreground">Last installment</dt><dd className="font-medium tabular-nums">{point.installment}</dd></div> : null}
          {point.elapsedMonths !== undefined ? <div className="flex items-center justify-between gap-4"><dt className="text-muted-foreground">Elapsed</dt><dd className="font-medium">{formatElapsed(point.elapsedMonths)}</dd></div> : null}
          {point.repaidPercent !== undefined ? <div className="flex items-center justify-between gap-4"><dt className="text-muted-foreground">Paid</dt><dd className="font-medium tabular-nums">{point.repaidPercent}%</dd></div> : null}
        </dl>
      ) : null}
      {point && (point.paymentMinor !== undefined || point.periodInterestMinor || point.cashFeesMinor || point.capitalizedFeesMinor || point.extraMinor !== undefined || point.source || point.sources?.length) ? (
        <dl className="mb-1.5 flex flex-col gap-1 border-b border-border pb-1.5">
          {point.paymentMinor !== undefined ? <>
            <div className="flex items-center justify-between gap-4"><dt className="text-muted-foreground">{period.length === 4 ? "Repayments" : "Repayment"}</dt><dd className="font-medium tabular-nums">{formatAmount(point.paymentMinor, digits)}</dd></div>
            <div className="flex items-center justify-between gap-4 pl-3 text-[11px] text-muted-foreground"><dt>Principal</dt><dd className="tabular-nums">{point.paymentBreakdown ? <>{percentage(point.paymentBreakdown.principal ?? 0, point.paymentMinor, "of repayments")}{formatAmount(point.paymentBreakdown.principal ?? 0, digits)}</> : "Unavailable"}</dd></div>
            <div className="flex items-center justify-between gap-4 pl-3 text-[11px] text-muted-foreground"><dt>Interest</dt><dd className="tabular-nums">{point.paymentBreakdown ? <>{percentage(point.paymentBreakdown.interest ?? 0, point.paymentMinor, "of repayments")}{formatAmount(point.paymentBreakdown.interest ?? 0, digits)}</> : "Unavailable"}</dd></div>
            {([ ["fee", "Fees"], ["escrow", "Escrow"], ["insurance", "Insurance"], ["tax", "Tax"], ["other", "Other"] ] as const).map(([kind, name]) => point.paymentBreakdown?.[kind] ? <div key={kind} className="flex items-center justify-between gap-4 pl-3 text-[11px] text-muted-foreground"><dt>{name}</dt><dd className="tabular-nums">{percentage(point.paymentBreakdown[kind]!, point.paymentMinor, "of repayments")}{formatAmount(point.paymentBreakdown[kind]!, digits)}</dd></div> : null)}
          </> : null}
          {point.periodInterestMinor && point.periodInterestMinor !== point.paymentBreakdown?.interest ? <div className="flex items-center justify-between gap-4"><dt className="text-muted-foreground">Interest charged</dt><dd className="tabular-nums text-muted-foreground">{formatAmount(point.periodInterestMinor, digits)}</dd></div> : null}
          {point.cashFeesMinor ? <div className="flex items-center justify-between gap-4"><dt className="text-muted-foreground">Fees paid separately</dt><dd className="tabular-nums text-muted-foreground">{formatAmount(point.cashFeesMinor, digits)}</dd></div> : null}
          {point.capitalizedFeesMinor ? <div className="flex items-center justify-between gap-4"><dt className="text-muted-foreground">Fees added to loan</dt><dd className="tabular-nums text-muted-foreground">{formatAmount(point.capitalizedFeesMinor, digits)}</dd></div> : null}
          {point.extraMinor ? <div className="flex items-center justify-between gap-4"><dt className="text-muted-foreground">Extra payment</dt><dd className="font-medium tabular-nums">{formatAmount(point.extraMinor, digits)}</dd></div> : null}
          {point.sources?.length || point.source ? <div className="flex items-center justify-between gap-4"><dt className="text-muted-foreground">Source</dt><dd className="font-medium">{(point.sources ?? (point.source ? [point.source] : [])).map((source) => SOURCE_LABEL[source]).join(" + ")}</dd></div> : null}
        </dl>
      ) : null}
      {payload?.length ? <p className="mb-1 text-[10px] font-medium text-muted-foreground">At this point</p> : null}
      <dl className="flex flex-col gap-1">
        {payload?.filter((entry) => entry.value != null).map((entry) => {
          const id = String(entry.dataKey) as SeriesId;
          return (
            <div key={id} className="flex items-center justify-between gap-4">
              <dt className="flex items-center gap-2 text-muted-foreground"><span className="h-0 w-4 shrink-0 border-t-2" style={{ borderColor: entry.color, borderTopStyle: SERIES_META[id]?.dash ? "dashed" : "solid" }} aria-hidden /><span>{SERIES_META[id]?.label ?? id}</span></dt>
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
        {showEvents && point?.events?.map((event, index) => <div key={`${event.date}-${event.type}-${index}`} className="border-t border-border pt-1 text-muted-foreground">{EVENT_LABELS[event.type] ?? event.type} · {formatChartDate(event.date)}</div>)}
      </dl>
    </div>
  );
}

export default function LoanProjectionChart({ data, visible, digits, showEvents = false, separateInterest = false, height = 320 }: { data: ChartData; visible: SeriesId[]; digits: number; showEvents?: boolean; separateInterest?: boolean; height?: number }) {
  const reducedMotion = usePrefersReducedMotion();
  const compact = (v: number) => {
    const major = v / 10 ** digits;
    const format = (value: number) => Number(value.toPrecision(5)).toString();
    return Math.abs(major) >= 1_000_000 ? `${format(major / 1_000_000)}M` : Math.abs(major) >= 1_000 ? `${format(major / 1_000)}k` : format(major);
  };
  const timestamp = (date: string) => Date.parse(`${date.length === 4 ? `${date}-01-01` : date.length === 7 ? `${date}-01` : date}T00:00:00Z`);
  const points = data.points.map((point) => ({ ...point, x: timestamp(point.date ?? point.openingDate ?? point.period) })).filter((point) => Number.isFinite(point.x)).sort((a, b) => a.x - b.x);
  const firstX = points[0]?.x;
  const lastX = points.at(-1)?.x;
  const shortMonthly = firstX !== undefined && lastX !== undefined && lastX - firstX <= 366 * 86_400_000 && data.points.some((point) => /^\d{4}-\d{2}$/.test(point.period));
  const tickValues: number[] = [];
  if (firstX !== undefined && lastX !== undefined) {
    tickValues.push(firstX);
    if (shortMonthly) {
      const start = new Date(firstX);
      for (let month = 1; ; month++) {
        const tick = Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + month, 1);
        if (tick > lastX) break;
        tickValues.push(tick);
      }
    } else for (let year = new Date(firstX).getUTCFullYear() + 1; Date.UTC(year, 0, 1) <= lastX; year++) tickValues.push(Date.UTC(year, 0, 1));
  }
  const tickDate = (value: number) => shortMonthly ? formatChartPeriod(new Date(value).toISOString().slice(0, 7)) : String(new Date(value).getUTCFullYear());
  const interestAxis = separateInterest && visible.includes("cumulativeInterest");
  const maxAmount = points.reduce((max, point) => visible.reduce((m, id) => Math.max(m, interestAxis && id === "cumulativeInterest" ? 0 : point[id] ?? 0), max), 0);
  const amounts = amountGrid(maxAmount);
  const interestAmounts = amountGrid(points.reduce((max, point) => Math.max(max, point.cumulativeInterest ?? 0), 0));
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 800, height }}>
        <ComposedChart data={points} margin={{ top: 12, right: interestAxis ? 0 : 20, bottom: 4, left: 0 }} accessibilityLayer>
          <CartesianGrid yAxisId="balance" horizontalValues={amounts.grid} verticalValues={tickValues} stroke="var(--border)" strokeOpacity={0.45} />
          <XAxis dataKey="x" type="number" domain={["dataMin", "dataMax"]} ticks={tickValues} tickFormatter={tickDate} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} axisLine={{ stroke: "var(--muted-foreground)", strokeOpacity: 0.4 }} tickLine={{ stroke: "var(--muted-foreground)", strokeOpacity: 0.4 }} minTickGap={4} />
          <YAxis yAxisId="balance" domain={[0, amounts.grid.at(-1)!]} ticks={amounts.labels} tickFormatter={compact} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} axisLine={{ stroke: "var(--muted-foreground)", strokeOpacity: 0.4 }} tickLine={{ stroke: "var(--muted-foreground)", strokeOpacity: 0.4 }} width={48} />
          {interestAxis ? <YAxis yAxisId="interest" orientation="right" domain={[0, interestAmounts.grid.at(-1)!]} ticks={interestAmounts.labels} tickFormatter={compact} tick={{ fontSize: 11, fill: "var(--chart-5)" }} axisLine={{ stroke: "var(--chart-5)", strokeOpacity: 0.5 }} tickLine={{ stroke: "var(--chart-5)", strokeOpacity: 0.5 }} width={48} label={{ value: "Interest", angle: 90, position: "insideRight", fill: "var(--chart-5)", fontSize: 10 }} /> : null}
          <Tooltip filterNull={false} content={<LoanTooltip digits={digits} rateChanges={data.rateChanges} showEvents={showEvents} />} cursor={{ stroke: "var(--muted-foreground)", strokeDasharray: "3 3", strokeOpacity: 0.45 }} isAnimationActive={!reducedMotion} />
          <ReferenceLine yAxisId="balance" y={0} stroke="var(--border)" strokeOpacity={0.5} />
          {data.tracking && data.tracking.untrackedBefore && data.tracking.startPeriod > data.tracking.firstPeriod ? (
            <ReferenceArea yAxisId="balance" x1={points[0]?.x} x2={timestamp(data.tracking.startDate ?? data.tracking.startPeriod)} fill="var(--muted)" fillOpacity={0.6} strokeOpacity={0} label={{ value: "Before tracking", position: "insideLeft", fill: "var(--muted-foreground)", fontSize: 10 }} />
          ) : null}
          {data.tracking ? <ReferenceLine yAxisId="balance" x={timestamp(data.tracking.todayDate ?? data.tracking.todayPeriod)} stroke="var(--foreground)" strokeOpacity={0.5} strokeDasharray="3 3" label={{ value: "Today", position: "insideTopLeft", fill: "var(--foreground)", fontSize: 10 }} /> : null}
          {data.rateChanges.map((group) => (
            <ReferenceLine
              key={group.period}
              x={timestamp(group.changes[0].date)}
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
          {showEvents ? [...new Set(points.flatMap((point) => point.events?.map((event) => event.date) ?? []))].map((date) => <ReferenceLine key={`events-${date}`} x={timestamp(date)} yAxisId="balance" stroke="var(--muted-foreground)" strokeDasharray="2 4" strokeOpacity={0.5} />) : null}
          {visible.map((id) => (
            <Line
              key={id}
              yAxisId={interestAxis && id === "cumulativeInterest" ? "interest" : "balance"}
              type={id === "actualBalance" ? "stepAfter" : "linear"}
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
          {data.payoff && visible.includes("balance") ? <ReferenceDot yAxisId="balance" x={timestamp(data.payoff.date)} y={0} r={4} fill="var(--chart-1)" stroke="var(--background)" strokeWidth={2} /> : null}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
