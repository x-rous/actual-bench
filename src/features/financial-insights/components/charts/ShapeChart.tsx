import { useId } from "react";
import type { Shape } from "@/lib/financial-insights/progress";
import { FONT_STACK, type ShapePalette } from "../../lib/progressPalette";

/** Every Progress chart is drawn in this box and scaled to fit, so the page and the exported image show the same picture. */
export const CHART_WIDTH = 720;
export const CHART_HEIGHT = 280;

const M = { r: 14, t: 18, b: 34 };
const LABEL = { fontFamily: FONT_STACK, fontSize: 12 } as const;

type Reference = { at: Shape; label: string };

/** Where a chart sits inside a larger drawing (the exported image). Without it the chart fills its container. */
export type Frame = { x: number; y: number; width: number };

type Common = { palette: ShapePalette; ariaLabel: string; /** Room on the left for end labels such as 0% and 100%. */ padLeft?: number; frame?: Frame };

/** The attributes of a chart's root element: a responsive picture on the page, a placed one inside an image (which carries no accessible name). */
function rootProps(ariaLabel: string, frame?: Frame) {
  return frame
    ? { x: frame.x, y: frame.y, width: frame.width, height: (frame.width * CHART_HEIGHT) / CHART_WIDTH }
    : { width: "100%", role: "img", "aria-label": ariaLabel };
}

/**
 * Which labels to show: every `step` months from the first, with a step wide enough that they do not touch, so the gaps are equal.
 * A step that also lands on the last month is preferred, so the axis ends on a label when it can without unequal gaps.
 */
export function pickLabels(xs: readonly number[], gap: number): number[] {
  const n = xs.length;
  if (n <= 1) return n === 1 ? [0] : [];
  const slot = (xs[n - 1] - xs[0]) / (n - 1);
  const least = Math.max(1, Math.ceil(gap / Math.max(slot, 1)));
  let step = least;
  for (let k = least; k <= least * 2; k++) if ((n - 1) % k === 0) { step = k; break; }
  const picked: number[] = [];
  for (let i = 0; i < n; i += step) picked.push(i);
  return picked;
}

function XLabels({ labels, xs, palette, left, right }: { labels: readonly string[]; xs: readonly number[]; palette: ShapePalette; left: number; right: number }) {
  return (
    <g fill={palette.muted} {...LABEL}>
      {pickLabels(xs, 70).map((i) => (
        <text key={i} x={i === 0 ? left : i === xs.length - 1 ? right : xs[i]} y={CHART_HEIGHT - 10} textAnchor={i === 0 ? "start" : i === xs.length - 1 ? "end" : "middle"}>{labels[i]}</text>
      ))}
    </g>
  );
}

/**
 * A line or bars drawn from `Shape` values: a zero line, optional reference lines, month labels and nothing else. There are
 * no ticks, no hover and no tooltip, and no value is written anywhere, because the data it receives holds no amount to write.
 * A missing month is a gap. The chart runs from zero to the furthest point (or to `window`), so the axis is never cut short.
 */
export function ShapeChart({ mode, points, zero, partial, xLabels, palette, ariaLabel, frame, padLeft = 36, area = "none", window: fixed, references = [], zeroLabel, peak = null, edgeLabels }: Common & {
  mode: "line" | "bars";
  points: readonly (Shape | null)[];
  zero: Shape;
  partial: readonly boolean[];
  xLabels: readonly string[];
  /** Line charts: shade between the line and zero, good above and bad below, or only below the line. */
  area?: "split" | "under" | "none";
  /** A fixed vertical window instead of one fitted to the points. */
  window?: readonly [number, number];
  references?: readonly Reference[];
  zeroLabel?: string;
  /** A point marked with a ring (the peak of what was owed). */
  peak?: number | null;
  /** Words at the bottom and top of the window (0% and 100%). */
  edgeLabels?: { bottom: string; top: string };
}) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "_");
  const known = points.filter((p): p is Shape => p !== null);
  const lo = fixed ? fixed[0] : Math.min(zero, ...known), hi = fixed ? fixed[1] : Math.max(zero, ...known);
  const span = hi - lo || 1;
  const top = M.t, bottom = CHART_HEIGHT - M.b, left = padLeft, right = CHART_WIDTH - M.r;
  const y = (v: number) => bottom - ((Math.min(hi, Math.max(lo, v)) - lo) / span) * (bottom - top);
  const n = points.length;
  const slot = (right - left) / Math.max(1, n);
  const xs = points.map((_, i) => (mode === "bars" ? left + slot * (i + 0.5) : n === 1 ? (left + right) / 2 : left + ((right - left) * i) / (n - 1)));
  const yz = y(zero);
  const lastPartial = partial.length > 0 && partial[partial.length - 1];

  // Runs of consecutive known points: a gap breaks the line.
  const runs: { x: number; y: number; i: number }[][] = [];
  points.forEach((p, i) => {
    if (p === null) { runs.push([]); return; }
    if (runs.length === 0) runs.push([]);
    runs[runs.length - 1].push({ x: xs[i], y: y(p), i });
  });
  const solid = runs.filter((r) => r.length > 0);
  const path = (r: { x: number; y: number }[]) => r.map((p, k) => `${k === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const areaPath = (r: { x: number; y: number }[]) => `${path(r)} L${r[r.length - 1].x.toFixed(1)},${yz.toFixed(1)} L${r[0].x.toFixed(1)},${yz.toFixed(1)} Z`;

  return (
    <svg viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} {...rootProps(ariaLabel, frame)} style={{ display: "block" }}>
      {mode === "line" && area !== "none" && (
        <>
          <clipPath id={`${id}-above`}><rect x={0} y={0} width={CHART_WIDTH} height={Math.max(0, yz)} /></clipPath>
          <clipPath id={`${id}-below`}><rect x={0} y={yz} width={CHART_WIDTH} height={Math.max(0, CHART_HEIGHT - yz)} /></clipPath>
          {solid.filter((r) => r.length > 1).map((r, k) => (
            <g key={k}>
              <path d={areaPath(r)} fill={area === "under" ? palette.line : palette.good} fillOpacity={area === "under" ? 0.1 : 0.22} clipPath={`url(#${id}-above)`} />
              {area === "split" && <path d={areaPath(r)} fill={palette.bad} fillOpacity={0.26} clipPath={`url(#${id}-below)`} />}
            </g>
          ))}
        </>
      )}
      {references.map((ref) => (
        <g key={ref.label}>
          <line x1={left} x2={right} y1={y(ref.at)} y2={y(ref.at)} stroke={palette.muted} strokeWidth={1} strokeDasharray="5 4" />
          <text x={right} y={y(ref.at) - 5} textAnchor="end" fill={palette.muted} {...LABEL}>{ref.label}</text>
        </g>
      ))}
      <line x1={left} x2={right} y1={yz} y2={yz} stroke={palette.muted} strokeWidth={1} />
      {zeroLabel && <text x={left - 6} y={yz + 4} textAnchor="end" fill={palette.muted} {...LABEL}>{zeroLabel}</text>}
      {edgeLabels && (
        <g fill={palette.muted} {...LABEL} textAnchor="end">
          <text x={left - 6} y={y(lo) + 4}>{edgeLabels.bottom}</text>
          <text x={left - 6} y={y(hi) + 4}>{edgeLabels.top}</text>
        </g>
      )}
      {mode === "bars" ? points.map((p, i) => {
        if (p === null) return null;
        const w = Math.min(40, Math.max(2, slot * 0.62));
        const y1 = y(p);
        const partialBar = partial[i];
        return <rect key={i} x={xs[i] - w / 2} y={Math.min(y1, yz)} width={w} height={Math.max(1, Math.abs(y1 - yz))} rx={2} fill={p >= 0 ? palette.good : palette.bad} fillOpacity={partialBar ? 0.45 : 1} stroke={partialBar ? (p >= 0 ? palette.good : palette.bad) : "none"} strokeDasharray={partialBar ? "3 2" : undefined} />;
      }) : (
        <g fill="none" stroke={palette.line} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round">
          {solid.map((r, k) => {
            const tail = lastPartial && r[r.length - 1].i === n - 1 && r.length > 1;
            const body = tail ? r.slice(0, -1) : r;
            return (
              <g key={k}>
                {body.length > 1 && <path d={path(body)} />}
                {tail && <path d={path(r.slice(-2))} strokeDasharray="6 5" />}
                {r.length === 1 && <circle cx={r[0].x} cy={r[0].y} r={3} fill={palette.line} stroke="none" />}
              </g>
            );
          })}
        </g>
      )}
      {mode === "line" && (() => {
        const lastRun = solid[solid.length - 1];
        const end = lastRun?.[lastRun.length - 1];
        return end ? <circle cx={end.x} cy={end.y} r={4.5} fill={lastPartial && end.i === n - 1 ? palette.surface : palette.line} stroke={palette.line} strokeWidth={2} /> : null;
      })()}
      {mode === "line" && peak !== null && points[peak] !== null && points[peak] !== undefined && (
        <circle cx={xs[peak]} cy={y(points[peak] as number)} r={6} fill={palette.surface} stroke={palette.bad} strokeWidth={3} />
      )}
      <XLabels labels={xLabels} xs={xs} palette={palette} left={left} right={right} />
    </svg>
  );
}

/** A horizontal bar from 0 to the top of the scale, with marks, for a duration (the cash buffer). A lighter second fill shows the longer cover. */
export function ShapeGauge({ fill, reachFill, marks, palette, ariaLabel, frame, endLabels }: Common & { fill: Shape; reachFill: Shape | null; marks: readonly { at: Shape; label: string }[]; endLabels: { start: string; end: string } }) {
  const left = 14, right = CHART_WIDTH - M.r, w = right - left, barTop = 96, barH = 44;
  const x = (v: number) => left + Math.min(1, Math.max(0, v)) * w;
  return (
    <svg viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} {...rootProps(ariaLabel, frame)} style={{ display: "block" }}>
      <rect x={left} y={barTop} width={w} height={barH} rx={barH / 2} fill={palette.track} />
      {reachFill !== null && reachFill > fill && <rect x={left} y={barTop} width={Math.max(barH, x(reachFill) - left)} height={barH} rx={barH / 2} fill={palette.good} fillOpacity={0.35} />}
      {fill > 0 && <rect x={left} y={barTop} width={Math.max(barH / 2, x(fill) - left)} height={barH} rx={barH / 2} fill={palette.good} />}
      {marks.map((m) => (
        <g key={m.label}>
          <line x1={x(m.at)} x2={x(m.at)} y1={barTop - 8} y2={barTop + barH + 8} stroke={palette.ink} strokeWidth={1.5} strokeDasharray="3 3" />
          <text x={x(m.at)} y={barTop + barH + 28} textAnchor="middle" fill={palette.muted} {...LABEL}>{m.label}</text>
        </g>
      ))}
      <g fill={palette.muted} {...LABEL}>
        <text x={left} y={barTop + barH + 28} textAnchor="start">{endLabels.start}</text>
        <text x={right} y={barTop + barH + 28} textAnchor="end">{endLabels.end}</text>
      </g>
    </svg>
  );
}
