"use client";

import { useMemo, type KeyboardEvent, type MouseEvent } from "react";
import { InfoHint } from "@/components/ui/info-hint";
import { cn } from "@/lib/utils";
import { MIN_BAR_PX, waterfallAxis, wrapLabel } from "../../../lib/varianceInvestigation/varianceChartScale";
import type { VarianceFormat } from "../../../lib/varianceInvestigation/varianceFormat";
import {
  buildWaterfall,
  type VarianceModel,
  type WaterfallSegment,
} from "../../../lib/varianceInvestigation";
import { ChartTip, FAVOURABLE_TEXT, TipRow, UNFAVOURABLE_TEXT, useChartFrame } from "./useChartFrame";

const HEIGHT = 262;
const TOP = 24;
const LEFT = 54;
const RIGHT = 6;

type Props = {
  model: VarianceModel;
  format: VarianceFormat;
  selectedIds: readonly string[];
  /** Driver ids the clicked bar stands for, and whether Ctrl/Cmd was held. */
  onSelect: (ids: string[], additive: boolean) => void;
};

function segmentTip(model: VarianceModel, format: VarianceFormat, segment: WaterfallSegment) {
  const v = model.vocab;
  const members = model.drivers.filter((d) => segment.driverIds.includes(d.id));
  const variance = segment.variance;
  const pct = segment.budget > 0 ? Math.abs(variance) / segment.budget : null;
  const shareWord = variance > 0 ? v.shareUnfavourable : v.shareFavourable;
  const envelope = model.mode === "envelope";
  const closing = members.reduce((t, d) => t + (d.aggregate.envelope?.closing ?? 0), 0);
  const deficit = members.reduce((t, d) => t + (d.aggregate.envelope?.deficit ?? 0), 0);
  return (
    <div className="space-y-0.5">
      <div className="font-semibold">{segment.name}</div>
      <TipRow label={v.budget} value={format.money(segment.budget)} />
      <TipRow label={v.actual} value={format.money(segment.actual)} />
      <TipRow
        label="Variance"
        value={
          <span className={variance > 0 ? UNFAVOURABLE_TEXT : variance < 0 ? FAVOURABLE_TEXT : undefined}>
            {format.money(variance)} {variance > 0 ? v.unfavourableLower : variance < 0 ? v.favourableLower : "on plan"}
          </span>
        }
      />
      <TipRow
        label={variance > 0 ? v.unfavourable : v.favourable}
        value={segment.share == null ? "–" : `${Math.round(segment.share * 100)}% ${shareWord}`}
      />
      <TipRow label="% of budget" value={pct == null ? "– (unbudgeted)" : `${(pct * 100).toFixed(1)}%`} />
      {envelope && (
        <TipRow
          label="Closing balance"
          value={`${closing < 0 ? "−" : ""}${format.money(closing)}${deficit > 0 ? ` · ${format.money(deficit)} deficit` : ""}`}
        />
      )}
    </div>
  );
}

/**
 * How budget became actual: Budget, the largest drivers, offsets, Actual.
 *
 * Clicking a bar selects the drivers it stands for, so an "Other" bar selects
 * every driver it holds. The axis is cut when the drivers would otherwise be a
 * few pixels tall, and says so.
 */
export function WaterfallChart({ model, format, selectedIds, onSelect }: Props) {
  const { attach, width: frameWidth, tip, showTip, hideTip } = useChartFrame();
  const width = Math.max(280, frameWidth);
  const plotWidth = width - LEFT - RIGHT;
  const waterfall = useMemo(
    () => buildWaterfall(model, { maxUnfavourable: plotWidth < 500 ? 4 : 5 }),
    [model, plotWidth]
  );
  const { segments } = waterfall;
  const axis = useMemo(() => waterfallAxis(segments), [segments]);
  const band = plotWidth / segments.length;
  const compact = band < 64;
  const bottom = compact ? 74 : 46;
  const plotHeight = HEIGHT - TOP - bottom;
  const barWidth = Math.min(band * 0.62, 66);
  const y = (value: number) => TOP + plotHeight - ((value - axis.min) / (axis.max - axis.min)) * plotHeight;
  const selected = new Set(selectedIds);
  const labelChars = Math.max(6, Math.floor(band / 5.6));

  function activate(segment: WaterfallSegment, event: MouseEvent | KeyboardEvent) {
    onSelect(segment.driverIds, event.ctrlKey || event.metaKey);
  }

  return (
    <div ref={attach} className="relative min-w-0">
      <svg
        width={width}
        height={HEIGHT}
        viewBox={`0 0 ${width} ${HEIGHT}`}
        role="group"
        aria-label={`${model.vocab.budget} to ${model.vocab.actual}, by ${model.level === "group" ? "group" : "category"}`}
        className="block max-w-full overflow-visible"
      >
        {axis.ticks.map((tick) => (
          <g key={tick}>
            <line x1={LEFT} x2={width - RIGHT} y1={y(tick)} y2={y(tick)} className="stroke-border" />
            <text x={LEFT - 6} y={y(tick) + 3} textAnchor="end" className="fill-muted-foreground text-[10px]">
              {format.axis(tick)}
            </text>
          </g>
        ))}

        {segments.map((segment, i) => {
          const x = LEFT + band * i + (band - barWidth) / 2;
          const isTotal = segment.kind === "total";
          const isSelected = !isTotal && segment.driverIds.some((id) => selected.has(id));
          // A driver's bar spans its step on the running total, never thinner than
          // the minimum, so a tiny variance stays visible. The tooltip has the truth.
          const span = Math.abs(y(segment.from) - y(segment.to));
          const height = isTotal ? y(axis.min) - y(segment.to) : Math.max(MIN_BAR_PX, span);
          const barTop = isTotal ? y(segment.to) : Math.min(y(segment.from), y(segment.to));
          const fill = isTotal ? "fill-muted-foreground" : segment.favourable ? "fill-emerald-500" : "fill-destructive";
          const label = isTotal
            ? compact ? format.compact(segment.to) : format.money(segment.to)
            : compact ? format.compactSigned(segment.delta) : format.signed(segment.delta);
          const labelTone = isTotal ? "fill-foreground" : segment.favourable ? "fill-emerald-600 dark:fill-emerald-400" : "fill-destructive";
          const next = segments[i + 1];
          const lines = wrapLabel(segment.label, labelChars);
          const tipNode = isTotal ? (
            <div className="space-y-0.5">
              <div className="font-semibold">{segment.name}</div>
              <TipRow label="Total" value={format.money(segment.to)} />
            </div>
          ) : (
            segmentTip(model, format, segment)
          );
          const interactive = !isTotal;
          return (
            <g key={segment.key}>
              {next && (
                <line
                  x1={x + barWidth}
                  x2={LEFT + band * (i + 1) + (band - barWidth) / 2}
                  y1={y(segment.to)}
                  y2={y(segment.to)}
                  strokeDasharray="3 3"
                  className="stroke-muted-foreground/60"
                />
              )}
              <g
                role={interactive ? "button" : undefined}
                tabIndex={interactive ? 0 : undefined}
                aria-pressed={interactive ? isSelected : undefined}
                aria-label={`${segment.name}: ${label}`}
                className={cn(interactive && "cursor-pointer outline-none focus-visible:[&_rect.bar]:stroke-ring focus-visible:[&_rect.bar]:stroke-2", interactive && selected.size > 0 && !isSelected && "opacity-60")}
                onClick={interactive ? (e) => activate(segment, e) : undefined}
                onKeyDown={
                  interactive
                    ? (e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          activate(segment, e);
                        }
                      }
                    : undefined
                }
                onPointerMove={(e) => showTip(e.clientX, e.clientY, tipNode)}
                onPointerLeave={hideTip}
                onFocus={(e) => {
                  const r = e.currentTarget.getBoundingClientRect();
                  showTip(r.right, r.top, tipNode);
                }}
                onBlur={hideTip}
              >
                <rect x={LEFT + band * i} y={TOP} width={band} height={plotHeight + bottom - 6} fill="transparent" />
                <rect
                  className={cn("bar", fill)}
                  x={x}
                  y={barTop}
                  width={barWidth}
                  height={Math.max(height, 0)}
                  rx={2}
                  strokeWidth={isSelected ? 2 : 0}
                  stroke={isSelected ? "currentColor" : "none"}
                />
                <text x={x + barWidth / 2} y={barTop - 5} textAnchor="middle" className={cn("text-[11px] font-semibold", labelTone)}>
                  {label}
                </text>
                {compact ? (
                  <text
                    transform={`translate(${x + barWidth / 2 + 4},${HEIGHT - bottom + 12}) rotate(-35)`}
                    textAnchor="end"
                    className="fill-muted-foreground text-[10px]"
                  >
                    {segment.label.length > 20 ? `${segment.label.slice(0, 19)}…` : segment.label}
                  </text>
                ) : (
                  lines.map((line, j) => (
                    <text key={j} x={x + barWidth / 2} y={HEIGHT - bottom + 16 + j * 12} textAnchor="middle" className="fill-muted-foreground text-[10px]">
                      {line}
                    </text>
                  ))
                )}
              </g>
            </g>
          );
        })}

        {axis.truncated && (
          <polygon
            points={`${LEFT},${y(axis.min) - 9} ${width - RIGHT},${y(axis.min) - 15} ${width - RIGHT},${y(axis.min) - 10} ${LEFT},${y(axis.min) - 4}`}
            className="fill-background"
          />
        )}
      </svg>
      {axis.truncated && (
        <span className="absolute right-0 top-0">
          <InfoHint label="the cut axis">
            The axis starts at {format.axis(axis.min)} so the drivers are visible. The {model.vocab.budget.toLowerCase()} and {model.vocab.actual.toLowerCase()} bars are cut at the break; the numbers on every bar are exact.
          </InfoHint>
        </span>
      )}
      <ChartTip tip={tip} width={width} />
    </div>
  );
}
