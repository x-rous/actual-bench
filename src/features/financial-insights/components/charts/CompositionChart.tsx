"use client";

import { useRef } from "react";
import { ASSET_CLASSES, CLASS_LABEL, LIABILITY_CLASSES, type ClassKey } from "@/lib/financial-insights/breakdowns";
import { compactAxis, compactMoney as compactLabel, labelMoney, money, signedMoney } from "../../format";
import { scaleY } from "./BarChart";
import { LABEL_HALO, tickLabel } from "./labels";
import { TipNote, TipRow, TipTitle, useTip, useWidth } from "./Tip";

/** The narrowest a month's slot may be for its net worth to be written beside the marker. */
const NET_WORTH_LABEL_MIN_SLOT = 44;

export const CLASS_COLOUR: Record<ClassKey, string> = {
  cash: "var(--fi-cash)", fixed: "var(--fi-fixed)", invest: "var(--fi-invest)", property: "var(--fi-property)", vehicle: "var(--fi-vehicle)", other: "var(--fi-other-asset)",
  loans: "var(--fi-loan)", cards: "var(--fi-card)", otherLiability: "var(--fi-other-liability)",
};

/**
 * What you own and owe at each month end: assets stacked above zero, liabilities below, net worth as a line. The classes
 * drawn are the ones the viewer has left switched on in the legend; net worth is always the true figure, whatever is hidden.
 * The only figure written on the chart is net worth, beside each marker (outlined, so it reads over a stack); months too narrow
 * for that keep only the first and last. What each class holds is in the tooltip and the table, not drawn as totals.
 */
export function CompositionChart({ labels, partialIndex, months, netWorth, hasData, hidden, showNetWorth, height = 250, unitName = "month", partialText = "balance today" }: {
  labels: string[];
  partialIndex: number | null;
  months: Record<ClassKey, number>[];
  netWorth: number[];
  /** False for a month before the budget has data: nothing is drawn for it. */
  hasData?: readonly boolean[];
  hidden: ReadonlySet<ClassKey>;
  showNetWorth: boolean;
  height?: number;
  /** What each bar stands for: a month, a quarter or a year, as in the tooltip. */
  unitName?: string;
  /** What the last bar is when it is not an end of its unit. */
  partialText?: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const width = useWidth(host);
  const { show, hide } = useTip();
  const M = { l: 48, r: 8, t: 10, b: 22 };
  // A negative balance (an overdrawn account) hangs below zero with the liabilities, so nothing is drawn upside down.
  const classes = [...ASSET_CLASSES, ...LIABILITY_CLASSES].filter((k) => !hidden.has(k));
  const stackUp = (m: Record<ClassKey, number>) => classes.reduce((a, k) => a + Math.max(0, m[k]), 0);
  const stackDown = (m: Record<ClassKey, number>) => classes.reduce((a, k) => a + Math.min(0, m[k]), 0);
  const hi = Math.max(1, ...months.map(stackUp), ...(showNetWorth ? netWorth : [])) * 1.05;
  const lo = Math.min(0, ...months.map(stackDown), ...(showNetWorth ? netWorth : [])) * 1.1;
  const { y, marks } = scaleY(lo, hi, height, M.t, M.b);
  const slot = (width - M.l - M.r) / Math.max(1, months.length);
  // On a long period the slots are only a few pixels: the gaps shrink with them so a bar keeps a width.
  const pad = Math.min(Math.max(3, slot * 0.14), slot * 0.25);
  const known = (i: number) => (hasData ? hasData[i] : true);
  const axis = compactAxis(marks);
  // A label that would fall outside the drawing stays inside it.
  const inside = (labelY: number) => Math.min(height - M.b - 2, Math.max(M.t + 2, labelY));
  return (
    <div ref={host} className="w-full">
      <svg width={width} height={height} role="group" aria-label={`What you own and owe at each ${unitName} end`}>
        {marks.map((v, k) => <g key={v}><line x1={M.l} x2={width - M.r} y1={y(v)} y2={y(v)} stroke="var(--border)" strokeOpacity={0.6} /><text x={M.l - 6} y={y(v) + 3.5} textAnchor="end" className="fill-muted-foreground text-[10.5px]">{axis[k]}</text></g>)}
        <line x1={M.l} x2={width - M.r} y1={y(0)} y2={y(0)} stroke="var(--muted-foreground)" strokeWidth={1.2} />
        {months.map((m, i) => {
          const x0 = M.l + i * slot;
          let up = 0, down = 0;
          const bars = classes.map((k) => {
            const v = m[k];
            if (!v || !known(i)) return null;
            const from = v > 0 ? up : down, to = from + v;
            if (v > 0) up = to; else down = to;
            return <rect key={k} x={x0 + pad} y={Math.min(y(from), y(to))} width={Math.min(slot, Math.max(1, slot - pad * 2))} height={Math.max(1, Math.abs(y(from) - y(to)) - 1.5)} rx={2} fill={CLASS_COLOUR[k]} fillOpacity={i === partialIndex && v > 0 ? 0.85 : 1} />;
          });
          const owns = ASSET_CLASSES.reduce((a, k) => a + m[k], 0), owes = LIABILITY_CLASSES.reduce((a, k) => a + m[k], 0);
          return (
            <g key={labels[i]}>
              {bars}
              <text x={x0 + slot / 2} y={height - 6} textAnchor="middle" className="fill-muted-foreground text-[10.5px]">{tickLabel(labels[i], i, slot)}</text>
              <rect x={x0} y={M.t} width={slot} height={height - M.t - M.b} fill="transparent" onMouseLeave={hide} onMouseMove={(e) => show(
                !known(i) ? <><TipTitle>{labels[i]}</TipTitle><TipNote>No data yet: the budget has no transactions up to this {unitName}.</TipNote></> : <>
                  <TipTitle>{labels[i]} · {i === partialIndex ? partialText : `${unitName} end`}</TipTitle>
                  {ASSET_CLASSES.filter((k) => m[k] !== 0).map((k) => <TipRow key={k} colour={CLASS_COLOUR[k]} name={CLASS_LABEL[k]} value={money(m[k])} />)}
                  {LIABILITY_CLASSES.filter((k) => m[k] !== 0).map((k) => <TipRow key={k} colour={CLASS_COLOUR[k]} name={CLASS_LABEL[k]} value={money(m[k])} />)}
                  <TipNote>
                    <TipRow name="Net worth" value={money(netWorth[i])} strong />
                    {i > 0 && known(i - 1) && <TipRow name={`vs previous ${unitName}`} value={`${signedMoney(netWorth[i] - netWorth[i - 1])}${netWorth[i - 1] ? ` (${(((netWorth[i] - netWorth[i - 1]) / Math.abs(netWorth[i - 1])) * 100).toFixed(1)}%)` : ""}`} />}
                    <TipRow name="Owns / owes" value={`${compactLabel(owns)} / ${compactLabel(-owes)}`} />
                  </TipNote>
                </>, e)} />
            </g>
          );
        })}
        {showNetWorth && (
          <>
            <polyline fill="none" stroke="var(--fi-networth)" strokeWidth={2} points={netWorth.flatMap((v, i) => (known(i) ? [`${M.l + (i + 0.5) * slot},${y(v)}`] : [])).join(" ")} />
            {netWorth.map((v, i) => !known(i) ? null : <circle key={i} cx={M.l + (i + 0.5) * slot} cy={y(v)} r={3.5} fill="var(--card)" stroke="var(--fi-networth)" strokeWidth={2} />)}
          </>
        )}
        {showNetWorth && (() => {
          const shown = netWorth.flatMap((_, i) => (known(i) ? [i] : []));
          // Every month when each has room for its figure, otherwise only where the line starts and where it ends.
          const written = slot >= NET_WORTH_LABEL_MIN_SLOT ? shown : shown.length === 0 ? [] : [...new Set([shown[0], shown[shown.length - 1]])];
          return written.map((i) => (
            <text key={`nw${i}`} x={M.l + (i + 0.5) * slot} y={inside(netWorth[i] >= 0 ? y(netWorth[i]) - 10 : y(netWorth[i]) + 19)} textAnchor="middle" className="text-[10.5px] font-semibold"
              style={{ fill: "var(--fi-networth)", ...LABEL_HALO }} aria-hidden pointerEvents="none">{labelMoney(netWorth[i])}</text>
          ));
        })()}
      </svg>
    </div>
  );
}
