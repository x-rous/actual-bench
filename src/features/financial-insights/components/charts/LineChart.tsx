"use client";

import { useRef, type ReactNode } from "react";
import { compactAxis, labelMoney } from "../../format";
import { scaleY } from "./BarChart";
import { spreadLabels, tickLabel } from "./labels";
import { useTip, useWidth } from "./Tip";

export type LineSeries = { key: string; label: string; colour: string; values: (number | null)[]; /** The thicker, leading line. */ primary?: boolean };

const MARGIN = { l: 48, r: 12, t: 10, b: 22 };
/** Room to the right of the last month for a line's closing value. */
const END_LABEL_ROOM = 46;

/**
 * Lines by month with a marker at each month end. A missing value breaks the line, never drops to zero. The last marker is
 * hollow and dashed when that month is partial. Hovering a month shows its tooltip.
 */
export function LineChart({ labels, partialIndex, series, height = 250, tip, ariaLabel, annotations, endLabels = false }: {
  labels: string[];
  partialIndex: number | null;
  series: LineSeries[];
  height?: number;
  tip: (index: number) => ReactNode;
  ariaLabel: string;
  /** Events worth explaining, marked with a diamond at the top of their month. */
  annotations?: { index: number; text: string }[];
  /** Each line's last value, beside its last point: where the lines end up. */
  endLabels?: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const width = useWidth(host);
  const { show, hide } = useTip();
  const all = series.flatMap((s) => s.values.filter((v): v is number => v !== null));
  const span = (Math.max(0, ...all) - Math.min(0, ...all)) || 1;
  const hi = Math.max(0, ...all) + span * 0.06, lo = Math.min(0, ...all) < 0 ? Math.min(0, ...all) - span * 0.06 : 0;
  const { y, marks } = scaleY(lo, hi, height, MARGIN.t, MARGIN.b);
  const right = endLabels ? END_LABEL_ROOM : MARGIN.r;
  const slot = (width - MARGIN.l - right) / Math.max(1, labels.length);
  const axis = compactAxis(marks);
  const x = (i: number) => MARGIN.l + (i + 0.5) * slot;
  // Each line's closing value, nudged apart where lines finish close together.
  const ends = endLabels ? series.flatMap((s) => { const index = s.values.findLastIndex((v) => v !== null); return index < 0 ? [] : [{ key: s.key, label: s.label, index, value: s.values[index] as number }]; }) : [];
  const placed = spreadLabels(ends.map((e) => y(e.value)), 13, MARGIN.t + 4, height - MARGIN.b - 4);
  return (
    <div ref={host} className="w-full">
      <svg width={width} height={height} role="group" aria-label={ariaLabel}>
        {marks.map((v, k) => <g key={v}><line x1={MARGIN.l} x2={width - right} y1={y(v)} y2={y(v)} stroke="var(--border)" strokeOpacity={0.6} /><text x={MARGIN.l - 6} y={y(v) + 3.5} textAnchor="end" className="fill-muted-foreground text-[10.5px]">{axis[k]}</text></g>)}
        {lo < 0 && <line x1={MARGIN.l} x2={width - right} y1={y(0)} y2={y(0)} stroke="var(--muted-foreground)" strokeWidth={1.2} />}
        {series.map((s) => {
          // One polyline per run of months that have a value.
          const runs: string[][] = [];
          s.values.forEach((v, i) => { if (v === null) { runs.push([]); return; } if (!runs.length) runs.push([]); runs[runs.length - 1].push(`${x(i)},${y(v)}`); });
          return (
            <g key={s.key}>
              {runs.filter((r) => r.length > 1).map((r, k) => <polyline key={k} fill="none" stroke={s.colour} strokeWidth={s.primary ? 3 : 1.5} strokeOpacity={s.primary ? 1 : 0.8} strokeLinejoin="round" points={r.join(" ")} />)}
              {s.values.map((v, i) => v === null ? null : <circle key={i} cx={x(i)} cy={y(v)} r={s.primary ? 4 : 2.5} fill="var(--card)" stroke={s.colour} strokeWidth={2} strokeDasharray={i === partialIndex ? "2 1.5" : undefined} />)}
            </g>
          );
        })}
        {annotations?.map((a) => (
          <g key={`note-${a.index}`}>
            <line x1={x(a.index)} x2={x(a.index)} y1={MARGIN.t + 8} y2={height - MARGIN.b} stroke="var(--muted-foreground)" strokeOpacity={0.35} strokeDasharray="3 3" />
            <text x={x(a.index)} y={MARGIN.t + 8} textAnchor="middle" className="fill-foreground text-[11px]"><title>{a.text}</title>◆</text>
          </g>
        ))}
        {labels.map((label, i) => (
          <g key={label + i}>
            <text x={x(i)} y={height - 6} textAnchor="middle" className="fill-muted-foreground text-[10.5px]">{tickLabel(label, i, slot)}{i === partialIndex ? "*" : ""}</text>
            <rect x={MARGIN.l + i * slot} y={MARGIN.t} width={slot} height={height - MARGIN.t - MARGIN.b} fill="transparent" onMouseMove={(e) => show(tip(i), e)} onMouseLeave={hide} />
          </g>
        ))}
        {/* After the month rectangles, so the pointer reaches the label and its tooltip. */}
        {ends.map((e, k) => <text key={e.key} x={x(e.index) + 8} y={placed[k] + 3.5} className="fill-foreground text-[10.5px] font-semibold"><title>{e.label}</title>{labelMoney(e.value)}</text>)}
      </svg>
    </div>
  );
}
