"use client";

import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { compactAxis, labelMoney, signedLabelMoney } from "../../format";
import { scaleY } from "./BarChart";
import { tickLabel } from "./labels";
import { useTip, useWidth } from "./Tip";

const MARGIN = { l: 58, r: 8, t: 22, b: 42 };
/** The narrowest a month's slot may be for the figures written on it. */
const FIGURE_MIN_SLOT = 38;

/** The pale tint of a budget: the block behind a month's bar, and the part of a group's line that was not spent. */
export const BUDGET_TINT = "color-mix(in srgb, var(--fi-balance) 25%, transparent)";

/**
 * Spending against a budget, one month at a time. The budget is a wide, pale block, and the spending a narrower bar in front of
 * it: it stays inside the block and is green while spending is within the budget, and rises above the block and is red when it is
 * not, so a month over budget shows without comparing two bars. The figure above is what was spent. Under the month names, one
 * row gives how far each month was under (+) or over (−) its budget, so the answer can be read straight along the row. The
 * colours are never the only cue: the sign and the bar's position against the block say the same. A month with no value draws
 * nothing, never a zero. The partial month is lighter, dashed, starred and not compared. Selecting a bar reports the month.
 */
export function BudgetBars({ labels, partialIndex, spent, budget, variance, exceeded, height = 300, tip, onSelect, ariaLabel, within, over, block }: {
  labels: string[];
  partialIndex: number | readonly number[] | null;
  /** What was spent, per month; null where there is nothing to draw. */
  spent: (number | null)[];
  /** What was budgeted, per month; null where there is no budget to draw. */
  budget: (number | null)[];
  /**
   * What the row under the months says, per month: positive for how much was left, negative for how far over. By default budget
   * less spent. A budget whose overspending can be covered by earlier money (Envelope) says what was not covered instead.
   */
  variance?: (number | null)[];
  /** Whether a month counts as over its budget, which colours its bar and its figure. By default spent is above the budget. */
  exceeded?: (boolean | null)[];
  height?: number;
  tip: (index: number) => ReactNode;
  onSelect?: (index: number) => void;
  ariaLabel: string;
  /** Spending that stays within its budget. */
  within: string;
  /** Spending beyond its budget, and the figure that says by how much. */
  over: string;
  /** The budget block. */
  block: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const width = useWidth(host);
  const { show, hide } = useTip();
  const known = [...spent, ...budget].filter((v): v is number => v !== null);
  const hi = Math.max(0, ...known) * 1.08 || 1;
  const low = Math.min(0, ...known);
  const lo = low < 0 ? low * 1.08 : 0;
  const { y, marks } = scaleY(lo, hi, height, MARGIN.t, MARGIN.b, 5);
  const axis = compactAxis(marks);
  const slot = (width - MARGIN.l - MARGIN.r) / Math.max(1, labels.length);
  const blockWidth = Math.min(Math.max(slot * 0.8, 6), 64);
  const barWidth = Math.max(blockWidth * 0.56, 3);
  const isPartial = (i: number) => (Array.isArray(partialIndex) ? partialIndex.includes(i) : i === partialIndex);
  const figures = slot >= FIGURE_MIN_SLOT;
  return (
    <div ref={host} className="w-full">
      <svg width={width} height={height} role="group" aria-label={ariaLabel}>
        {marks.map((v, k) => (
          <g key={v}><line x1={MARGIN.l} x2={width - MARGIN.r} y1={y(v)} y2={y(v)} stroke="var(--border)" strokeOpacity={0.6} /><text x={MARGIN.l - 6} y={y(v) + 3.5} textAnchor="end" className="fill-muted-foreground text-[10.5px]">{axis[k]}</text></g>
        ))}
        {lo < 0 && <line x1={MARGIN.l} x2={width - MARGIN.r} y1={y(0)} y2={y(0)} stroke="var(--muted-foreground)" strokeWidth={1.2} />}
        <text x={MARGIN.l - 6} y={height - 6} textAnchor="end" className="fill-muted-foreground text-[10px]">vs budget</text>
        {labels.map((label, i) => {
          const cx = MARGIN.l + (i + 0.5) * slot;
          const partial = isPartial(i);
          const s = spent[i];
          const b = budget[i];
          // A partial month is not compared with a full budget, so its bar is neither green nor red.
          const beyond = !partial && (exceeded ? exceeded[i] === true : s !== null && b !== null && s > b);
          const colour = partial ? block : beyond ? over : within;
          const delta = variance ? variance[i] : s !== null && b !== null ? b - s : null;
          const press = onSelect && s !== null ? { className: "cursor-pointer", role: "button", tabIndex: 0, "aria-label": `Spent, ${label}`, onClick: () => onSelect(i),
            onKeyDown: (e: KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(i); } } } : {};
          const figureY = s === null ? 0 : s >= 0 ? Math.min(y(s), b !== null && b >= 0 ? y(b) : Infinity) - 6 : y(s) + 12;
          return (
            <g key={label + i}>
              <rect x={MARGIN.l + i * slot} y={MARGIN.t} width={slot} height={height - MARGIN.t - MARGIN.b} fill="transparent" onMouseMove={(e) => show(tip(i), e)} onMouseLeave={hide} />
              {b !== null && b !== 0 && <rect x={cx - blockWidth / 2} y={Math.min(y(0), y(b))} width={blockWidth} height={Math.max(1, Math.abs(y(0) - y(b)))} rx={3} fill={block} fillOpacity={partial ? 0.1 : 0.22}
                stroke={block} strokeOpacity={0.55} strokeWidth={1} strokeDasharray={partial ? "3 2" : undefined} pointerEvents="none" />}
              {s !== null && <rect x={cx - barWidth / 2} y={Math.min(y(0), y(s))} width={barWidth} height={Math.max(s === 0 ? 0 : 1, Math.abs(y(0) - y(s)))} rx={2.5}
                fill={colour} fillOpacity={partial ? 0.45 : 1} stroke={partial ? colour : "none"} strokeDasharray={partial ? "3 2" : undefined} strokeWidth={partial ? 1.2 : 0} pointerEvents="none" />}
              {/* The target to point at or touch: at least a finger wide, and a band around the zero line for a month of nothing. */}
              {s !== null && <rect x={cx - Math.max(barWidth, 20) / 2} y={Math.min(y(0), y(s)) - 6} width={Math.max(barWidth, 20)} height={Math.abs(y(0) - y(s)) + 12} fill="transparent"
                {...press} onMouseMove={(e) => show(tip(i), e)} onMouseLeave={hide} />}
              {s !== null && s !== 0 && figures && <text x={cx} y={figureY} textAnchor="middle" className="fill-foreground text-[10.5px] font-medium" aria-hidden pointerEvents="none">{labelMoney(s)}</text>}
              <text x={cx} y={height - 24} textAnchor="middle" className="fill-muted-foreground text-[10.5px]">{tickLabel(label, i, slot)}{partial ? "*" : ""}</text>
              {s !== null && b !== null && delta !== null && figures && (partial
                ? <text x={cx} y={height - 6} textAnchor="middle" className="fill-muted-foreground text-[10.5px]" aria-hidden>–</text>
                : <text x={cx} y={height - 6} textAnchor="middle" className="text-[10.5px] font-semibold" style={{ fill: beyond ? over : within }} aria-hidden>{signedLabelMoney(delta)}</text>)}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
