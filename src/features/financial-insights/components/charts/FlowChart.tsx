"use client";

import { useRef, type ReactNode } from "react";
import { compactMoney } from "../../format";
import { scaleY } from "./BarChart";
import { tickLabel } from "./labels";
import { useTip, useWidth } from "./Tip";

/**
 * Money in and money out, month by month, in one picture: what was received rises above the zero line, what was spent hangs
 * below it, and what was kept (received less spent) is a dashed line with a marker per month, above zero when something was saved and below it when
 * more went out than came in. Received and spent are opposite directions, so nothing is stacked or added up twice. The partial
 * month is lighter with a dashed outline and a hollow marker.
 */
export function FlowChart({ labels, partialIndex, received, spent, kept, height = 260, tip, onSelect }: {
  labels: string[];
  partialIndex: number | readonly number[] | null;
  received: (number | null)[];
  spent: (number | null)[];
  /** Null while Money kept needs review: the marker is left out, not shown as zero. */
  kept: (number | null)[];
  height?: number;
  tip: (index: number) => ReactNode;
  onSelect: (index: number, series: "received" | "spent") => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const width = useWidth(host);
  const { show, hide } = useTip();
  const M = { l: 50, r: 10, t: 14, b: 24 };
  const hi = Math.max(1, ...received.map((v) => v ?? 0), ...kept.map((v) => v ?? 0)) * 1.08;
  const lo = Math.min(-1, ...spent.map((v) => -(v ?? 0)), ...kept.map((v) => v ?? 0)) * 1.08;
  const { y, marks } = scaleY(lo, hi, height, M.t, M.b, 5);
  const slot = (width - M.l - M.r) / Math.max(1, labels.length);
  const bar = Math.min(26, Math.max(6, slot * 0.34));
  return (
    <div ref={host} className="w-full">
      <svg width={width} height={height} role="group" aria-label="Money received above the line, money spent below it, and money kept as a dashed line with a marker for each month">
        {marks.map((v) => (
          <g key={v}>
            <line x1={M.l} x2={width - M.r} y1={y(v)} y2={y(v)} stroke="var(--border)" strokeOpacity={v === 0 ? 0 : 0.55} />
            <text x={M.l - 8} y={y(v) + 3.5} textAnchor="end" className="fill-muted-foreground text-[10.5px]">{compactMoney(v)}</text>
          </g>
        ))}
        <line x1={M.l} x2={width - M.r} y1={y(0)} y2={y(0)} stroke="var(--muted-foreground)" strokeWidth={1.25} />
        {labels.map((label, i) => {
          const cx = M.l + (i + 0.5) * slot;
          const partial = Array.isArray(partialIndex) ? partialIndex.includes(i) : i === partialIndex;
          const r = received[i], s = spent[i];
          const style = (colour: string) => ({ fill: colour, fillOpacity: partial ? 0.35 : 1, stroke: partial ? colour : "none", strokeDasharray: partial ? "3 2" : undefined, strokeWidth: 1.2 });
          const select = (series: "received" | "spent") => ({
            onClick: () => onSelect(i, series), onMouseMove: (e: React.MouseEvent) => show(tip(i), e), onMouseLeave: hide, className: "cursor-pointer", role: "button" as const, tabIndex: 0,
            "aria-label": `${series === "received" ? "Received" : "Spent"}, ${label}`, onKeyDown: (e: React.KeyboardEvent) => { if (e.key === "Enter") onSelect(i, series); },
          });
          return (
            <g key={label + i}>
              <rect x={cx - slot / 2} y={M.t} width={slot} height={height - M.t - M.b} fill="transparent" onMouseMove={(e) => show(tip(i), e)} onMouseLeave={hide} />
              {r != null && r > 0 && <rect x={cx - bar / 2} y={y(r)} width={bar} height={Math.max(1, y(0) - y(r))} rx={3} {...style("var(--fi-income)")} {...select("received")} />}
              {s != null && s > 0 && <rect x={cx - bar / 2} y={y(0)} width={bar} height={Math.max(1, y(-s) - y(0))} rx={3} {...style("var(--fi-spend)")} {...select("spent")} />}
              <text x={cx} y={height - 7} textAnchor="middle" className="fill-muted-foreground text-[10.5px]">{tickLabel(label, i, slot)}{partial ? "*" : ""}</text>
            </g>
          );
        })}
        {labels.slice(1).map((_, j) => {
          const i = j + 1, a = kept[i - 1], b = kept[i];
          if (a == null || b == null) return null;
          return <line key={`k${i}`} x1={M.l + (i - 0.5) * slot} x2={M.l + (i + 0.5) * slot} y1={y(a)} y2={y(b)} stroke="var(--fi-kept)" strokeWidth={1.75} strokeDasharray="5 4" strokeOpacity={i === partialIndex ? 0.5 : 1} pointerEvents="none" />;
        })}
        {labels.map((label, i) => (kept[i] == null ? null : <circle key={`m${i}`} cx={M.l + (i + 0.5) * slot} cy={y(kept[i] as number)} r={4.5} fill="var(--card)" stroke="var(--fi-kept)" strokeWidth={2} strokeDasharray={i === partialIndex ? "2 1.5" : undefined} pointerEvents="none" />))}
      </svg>
    </div>
  );
}
