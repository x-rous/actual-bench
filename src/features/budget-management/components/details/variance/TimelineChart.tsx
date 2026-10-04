"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { nextMonth } from "@/lib/budget/monthMath";
import { barsAxis, MIN_BAR_PX } from "../../../lib/varianceInvestigation/varianceChartScale";
import type { VarianceFormat } from "../../../lib/varianceInvestigation/varianceFormat";
import type { MonthPoint, VarianceModel } from "../../../lib/varianceInvestigation";
import { ChartTip, FAVOURABLE_TEXT, TipRow, UNFAVOURABLE_TEXT, useChartFrame } from "./useChartFrame";

const HEIGHT = 290;
const TOP = 24;
const BOTTOM = 46;
const LEFT = 54;

export function monthParts(month: string): { name: string; year: string } {
  const [year, mo] = month.split("-").map(Number);
  return {
    name: new Date(year, mo - 1, 1).toLocaleString("en-US", { month: "short" }),
    year: String(year),
  };
}

type Props = {
  model: VarianceModel;
  format: VarianceFormat;
  /** One point per month drawn, oldest first. */
  points: MonthPoint[];
  /** Months that belong to the period. Others are drawn faded, as context. */
  periodMonths: readonly string[];
  /** Tracking only: a running total through the period. */
  showCumulative: boolean;
  selectedMonth: string | null;
  /** Absent when the months are context only and not a filter. */
  onMonthClick?: (month: string) => void;
};

/**
 * Month by month, around a zero line.
 *
 * Tracking draws each month's variance (unfavourable above the line,
 * favourable below) and, over a period, the running total. Envelope draws the
 * balances categories ended each month with: available above the line, in
 * deficit below.
 */
export function TimelineChart({
  model,
  format,
  points,
  periodMonths,
  showCumulative,
  selectedMonth,
  onMonthClick,
}: Props) {
  const { attach, width: frameWidth, tip, showTip, hideTip } = useChartFrame();
  const envelope = model.mode === "envelope";
  const v = model.vocab;
  const width = Math.max(280, frameWidth);
  const right = showCumulative ? 88 : 8;
  const plotWidth = width - LEFT - right;
  const band = plotWidth / Math.max(points.length, 1);
  const barWidth = Math.min(band * 0.5, 46);
  const inPeriod = useMemo(() => new Set(periodMonths), [periodMonths]);

  const series = useMemo(
    () =>
      points.map((p) => ({
        up: envelope ? (p.envelope?.available ?? 0) : Math.max(p.variance, 0),
        down: envelope ? (p.envelope?.deficit ?? 0) : Math.max(-p.variance, 0),
      })),
    [points, envelope]
  );
  const cumulative = useMemo(
    () => (showCumulative ? points.map((p) => p.cumulative) : []),
    [points, showCumulative]
  );
  const axis = useMemo(
    () =>
      barsAxis(
        Math.max(1, ...series.map((s) => s.up), ...cumulative.map((c) => Math.max(c, 0))),
        Math.max(0, ...series.map((s) => s.down), ...cumulative.map((c) => Math.max(-c, 0)))
      ),
    [series, cumulative]
  );
  const plotHeight = HEIGHT - TOP - BOTTOM;
  const perUnit = plotHeight / (axis.upMax + axis.downMax);
  const zeroY = TOP + axis.upMax * perUnit;
  const y = (value: number) => zeroY - value * perUnit;
  const minUnits = MIN_BAR_PX / perUnit;
  const label = (value: number) => (value < 0 ? "−" : "") + format.axis(value);

  const last = points.length - 1;
  const finalCumulative = cumulative[last] ?? 0;

  return (
    <div ref={attach} className="relative min-w-0">
      <svg
        width={width}
        height={HEIGHT}
        viewBox={`0 0 ${width} ${HEIGHT}`}
        role="group"
        aria-label={envelope ? "Balances by month" : "Variance by month"}
        className="block max-w-full overflow-visible"
      >
        {[...axis.up.map((t) => t), 0, ...axis.down.map((t) => -t)].map((tick) => (
          <g key={tick}>
            <line x1={LEFT} x2={width - right} y1={y(tick)} y2={y(tick)} className={tick === 0 ? "stroke-muted-foreground/60" : "stroke-border"} />
            <text x={LEFT - 6} y={y(tick) + 3} textAnchor="end" className="fill-muted-foreground text-[10px]">
              {label(tick)}
            </text>
          </g>
        ))}

        {points.map((point, k) => {
          const cx = LEFT + band * k + band / 2;
          const x = cx - barWidth / 2;
          const { up, down } = series[k];
          const isSelected = selectedMonth === point.month;
          const inside = inPeriod.has(point.month);
          const clickable = !!onMonthClick && inside;
          const tip = envelope ? (
            <div className="space-y-0.5">
              <div className="font-semibold">{monthParts(point.month).name} {monthParts(point.month).year}</div>
              <TipRow label="Available" value={format.money(point.envelope?.available ?? 0)} />
              <TipRow label="In deficit" value={format.money(point.envelope?.deficit ?? 0)} />
              <TipRow label={v.budget} value={format.money(point.budget)} />
              <TipRow label={v.actual} value={format.money(point.actual)} />
            </div>
          ) : (
            <div className="space-y-0.5">
              <div className="font-semibold">{monthParts(point.month).name} {monthParts(point.month).year}</div>
              <TipRow label={v.budget} value={format.money(point.budget)} />
              <TipRow label={v.actual} value={format.money(point.actual)} />
              <TipRow
                label="Variance"
                value={
                  <span className={point.variance > 0 ? UNFAVOURABLE_TEXT : point.variance < 0 ? FAVOURABLE_TEXT : undefined}>
                    {format.money(point.variance)} {point.variance > 0 ? v.unfavourableLower : point.variance < 0 ? v.favourableLower : "on plan"}
                  </span>
                }
              />
              {showCumulative && <TipRow label="Running total" value={format.signed(point.cumulative)} />}
            </div>
          );
          return (
            <g
              key={point.month}
              role={clickable ? "button" : undefined}
              tabIndex={clickable ? 0 : undefined}
              aria-pressed={clickable ? isSelected : undefined}
              aria-label={`${monthParts(point.month).name} ${monthParts(point.month).year}`}
              className={cn(clickable && "cursor-pointer outline-none", !inside && "opacity-40")}
              onClick={clickable ? () => onMonthClick(point.month) : undefined}
              onKeyDown={
                clickable
                  ? (e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onMonthClick(point.month);
                      }
                    }
                  : undefined
              }
              onPointerMove={(e) => showTip(e.clientX, e.clientY, tip)}
              onPointerLeave={hideTip}
              onFocus={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                showTip(r.right, r.top, tip);
              }}
              onBlur={hideTip}
            >
              <rect
                x={LEFT + band * k}
                y={TOP - 6}
                width={band}
                height={plotHeight + 12}
                className={isSelected ? "fill-primary/10" : "fill-transparent"}
              />
              {up > 0 && (
                <>
                  <rect
                    x={x}
                    y={y(Math.max(up, minUnits))}
                    width={barWidth}
                    height={Math.max(MIN_BAR_PX, up * perUnit)}
                    rx={2}
                    className={envelope ? "fill-muted-foreground/60" : "fill-destructive"}
                  />
                  <text x={cx} y={y(Math.max(up, minUnits)) - 4} textAnchor="middle" className={cn("text-[11px] font-semibold", envelope ? "fill-foreground" : "fill-destructive")}>
                    {envelope ? format.compact(up) : format.compactSigned(up)}
                  </text>
                </>
              )}
              {down > 0 && (
                <>
                  <rect
                    x={x}
                    y={zeroY}
                    width={barWidth}
                    height={Math.max(MIN_BAR_PX, down * perUnit)}
                    rx={2}
                    className={envelope ? "fill-destructive" : "fill-emerald-500"}
                  />
                  <text
                    x={cx}
                    y={zeroY + Math.max(MIN_BAR_PX, down * perUnit) + 12}
                    textAnchor="middle"
                    className={cn("text-[11px] font-semibold", envelope ? "fill-destructive" : "fill-emerald-600 dark:fill-emerald-400")}
                  >
                    −{format.compact(down)}
                  </text>
                </>
              )}
              <text x={cx} y={HEIGHT - BOTTOM + 16} textAnchor="middle" className="fill-muted-foreground text-[10px]">
                {monthParts(point.month).name}
              </text>
              <text x={cx} y={HEIGHT - BOTTOM + 28} textAnchor="middle" className="fill-muted-foreground text-[10px]">
                {monthParts(point.month).year}
              </text>
            </g>
          );
        })}

        {/* The running total is drawn over the columns, so it must never take their clicks. */}
        {cumulative.length > 1 && (
          <g className="pointer-events-none">
            <polyline
              fill="none"
              strokeWidth={2}
              className="stroke-foreground"
              points={cumulative.map((c, k) => `${LEFT + band * k + band / 2},${y(c)}`).join(" ")}
            />
            {cumulative.map((c, k) => (
              <circle
                key={points[k].month}
                cx={LEFT + band * k + band / 2}
                cy={y(c)}
                r={k === last ? 4.5 : 3}
                strokeWidth={2}
                className="fill-foreground stroke-background"
              />
            ))}
          </g>
        )}
        {cumulative.length > 0 && (
          <g className="pointer-events-none">
            <text
              x={LEFT + band * last + band / 2 + barWidth / 2 + 8}
              y={y(finalCumulative) - 2}
              className={cn("text-[13px] font-semibold", finalCumulative > 0 ? "fill-destructive" : "fill-emerald-600 dark:fill-emerald-400")}
            >
              {format.axis(finalCumulative)}
            </text>
            <text x={LEFT + band * last + band / 2 + barWidth / 2 + 8} y={y(finalCumulative) + 11} className="fill-muted-foreground text-[10px]">
              {finalCumulative > 0 ? v.netUnfavourable : finalCumulative < 0 ? v.netFavourable : "on plan"}
            </text>
          </g>
        )}
      </svg>
      <ChartTip tip={tip} width={width} />
    </div>
  );
}

/**
 * Envelope: what each deficit did to funding. A deficit in a category that
 * does not carry over comes out of the next month's To Budget; one that
 * carries over stays in the envelope as a negative balance.
 */
export function DeficitImpact({
  points,
  periodMonths,
  format,
}: {
  points: MonthPoint[];
  periodMonths: readonly string[];
  format: VarianceFormat;
}) {
  const inPeriod = new Set(periodMonths);
  const rows = points.filter((p) => inPeriod.has(p.month) && (p.envelope?.deficit ?? 0) > 0).slice(-4);
  if (rows.length === 0) {
    return <p className="mt-2 text-[11.5px] text-muted-foreground">No envelope went below zero in these months.</p>;
  }
  return (
    <div className="mt-2 text-[11.5px] text-muted-foreground">
      <div className="font-semibold text-foreground">Funding impact of deficits</div>
      <ul className="mt-0.5 space-y-0.5">
        {rows.map((p) => {
          const env = p.envelope!;
          const next = monthParts(nextMonth(p.month)).name;
          return (
            <li key={p.month} className="tabular-nums">
              <span className="font-medium text-foreground">{monthParts(p.month).name}</span>: {format.money(env.deficit)} below zero
              {env.clearedFromToBudget > 0 && <> · {format.money(env.clearedFromToBudget)} reduces {next} To Budget</>}
              {env.rolledOver > 0 && <> · {format.money(env.rolledOver)} carried into {next}</>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
