"use client";

import { useRef } from "react";
import { ASSET_CLASSES, CLASS_LABEL, LIABILITY_CLASSES, type ClassKey } from "@/lib/financial-insights/breakdowns";
import { money, signedMoney } from "../../format";
import { scaleY } from "./BarChart";
import { tickLabel } from "./labels";
import { TipNote, TipRow, TipTitle, useTip, useWidth } from "./Tip";

export const CLASS_COLOUR: Record<ClassKey, string> = {
  cash: "var(--fi-cash)", fixed: "var(--fi-fixed)", invest: "var(--fi-invest)", property: "var(--fi-property)", vehicle: "var(--fi-vehicle)", other: "var(--fi-other-asset)",
  loans: "var(--fi-loan)", cards: "var(--fi-card)", otherLiability: "var(--fi-other-liability)",
};

/**
 * What you own and owe at each month end: assets stacked above zero, liabilities below, net worth as a line. The classes
 * drawn are the ones the viewer has left switched on in the legend; net worth is always the true figure, whatever is hidden.
 */
export function CompositionChart({ labels, partialIndex, months, netWorth, hidden, showNetWorth, height = 250 }: {
  labels: string[];
  partialIndex: number | null;
  months: Record<ClassKey, number>[];
  netWorth: number[];
  hidden: ReadonlySet<ClassKey>;
  showNetWorth: boolean;
  height?: number;
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
  const pad = Math.max(3, slot * 0.14);
  return (
    <div ref={host} className="w-full">
      <svg width={width} height={height} role="img" aria-label="What you own and owe at each month end">
        {marks.map((v) => <g key={v}><line x1={M.l} x2={width - M.r} y1={y(v)} y2={y(v)} stroke="var(--border)" strokeOpacity={0.6} /><text x={M.l - 6} y={y(v) + 3.5} textAnchor="end" className="fill-muted-foreground text-[10.5px]">{compactLabel(v)}</text></g>)}
        <line x1={M.l} x2={width - M.r} y1={y(0)} y2={y(0)} stroke="var(--muted-foreground)" strokeWidth={1.2} />
        {months.map((m, i) => {
          const x0 = M.l + i * slot;
          let up = 0, down = 0;
          const bars = classes.map((k) => {
            const v = m[k];
            if (!v) return null;
            const from = v > 0 ? up : down, to = from + v;
            if (v > 0) up = to; else down = to;
            return <rect key={k} x={x0 + pad} y={Math.min(y(from), y(to))} width={slot - pad * 2} height={Math.max(1, Math.abs(y(from) - y(to)) - 1.5)} rx={2} fill={CLASS_COLOUR[k]} fillOpacity={i === partialIndex && v > 0 ? 0.85 : 1} />;
          });
          const owns = ASSET_CLASSES.reduce((a, k) => a + m[k], 0), owes = LIABILITY_CLASSES.reduce((a, k) => a + m[k], 0);
          return (
            <g key={labels[i]}>
              {bars}
              <text x={x0 + slot / 2} y={height - 6} textAnchor="middle" className="fill-muted-foreground text-[10.5px]">{tickLabel(labels[i], i, slot)}</text>
              <rect x={x0} y={M.t} width={slot} height={height - M.t - M.b} fill="transparent" onMouseLeave={hide} onMouseMove={(e) => show(
                <>
                  <TipTitle>{labels[i]} · {i === partialIndex ? "balance today" : "month end"}</TipTitle>
                  {ASSET_CLASSES.filter((k) => m[k] !== 0).map((k) => <TipRow key={k} colour={CLASS_COLOUR[k]} name={CLASS_LABEL[k]} value={money(m[k])} />)}
                  {LIABILITY_CLASSES.filter((k) => m[k] !== 0).map((k) => <TipRow key={k} colour={CLASS_COLOUR[k]} name={CLASS_LABEL[k]} value={money(m[k])} />)}
                  <TipNote>
                    <TipRow name="Net worth" value={money(netWorth[i])} />
                    {i > 0 && <TipRow name="vs previous month" value={`${signedMoney(netWorth[i] - netWorth[i - 1])}${netWorth[i - 1] ? ` (${(((netWorth[i] - netWorth[i - 1]) / Math.abs(netWorth[i - 1])) * 100).toFixed(1)}%)` : ""}`} />}
                    <TipRow name="Owns / owes" value={`${compactLabel(owns)} / ${compactLabel(-owes)}`} />
                  </TipNote>
                </>, e)} />
            </g>
          );
        })}
        {showNetWorth && (
          <>
            <polyline fill="none" stroke="var(--fi-networth)" strokeWidth={2} points={netWorth.map((v, i) => `${M.l + (i + 0.5) * slot},${y(v)}`).join(" ")} />
            {netWorth.map((v, i) => <circle key={i} cx={M.l + (i + 0.5) * slot} cy={y(v)} r={3.5} fill="var(--card)" stroke="var(--fi-networth)" strokeWidth={2} />)}
          </>
        )}
      </svg>
    </div>
  );
}

function compactLabel(minor: number): string {
  const major = Math.abs(minor) / 100;
  const sign = minor < 0 ? "-" : "";
  if (major >= 1_000_000) return `${sign}${(major / 1_000_000).toFixed(major >= 10_000_000 ? 0 : 1)}m`;
  if (major >= 1_000) return `${sign}${(major / 1_000).toFixed(major >= 10_000 ? 0 : 1)}k`;
  return `${sign}${Math.round(major)}`;
}
