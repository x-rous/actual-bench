"use client";

import { useRef, type ReactNode } from "react";
import { money, signedMoney } from "../../format";
import { scaleY } from "./BarChart";
import { useTip, useWidth } from "./Tip";

export type WaterfallStep = {
  key: string;
  label: string;
  /** A change (`delta`), or a balance the running total is set to (`total`). A `gap` is an unexplained difference. */
  kind: "total" | "delta" | "gap";
  amountMinor: number;
  note?: string;
  /** Overrides the up/down colour of a `delta`, so a step keeps one colour across charts. */
  colour?: string;
};

/**
 * A waterfall: balances as dark bars, increases and decreases as blue and red steps joined by a dotted line, and an unexplained
 * difference as a dashed amber step. A step that can show its transactions is underlined and selectable.
 */
export function Waterfall({ steps, height = 240, startAtZero = true, floorMinor, onSelect, canSelect, ariaLabel }: {
  steps: WaterfallStep[];
  height?: number;
  startAtZero?: boolean;
  /** Where balance bars start instead of zero, so steps that are small beside the balances stay readable; the chart says it is not from zero. */
  floorMinor?: number;
  onSelect?: (step: WaterfallStep) => void;
  canSelect?: (step: WaterfallStep) => boolean;
  ariaLabel: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const width = useWidth(host);
  const { show, hide } = useTip();
  const M = { l: 8, r: 8, t: 22, b: 48 };
  const spans = steps.reduce<(readonly [number, number])[]>((acc, s) => {
    const before = acc.length ? acc[acc.length - 1][1] : 0;
    acc.push(s.kind === "total" ? [floorMinor ?? 0, s.amountMinor] : [before, before + s.amountMinor]);
    return acc;
  }, []);
  const all = spans.flatMap((p) => [...p]);
  let hi = Math.max(startAtZero && floorMinor === undefined ? 0 : -Infinity, ...all), lo = Math.min(startAtZero && floorMinor === undefined ? 0 : Infinity, ...all);
  const room = (hi - lo) * 0.08 || 1; hi += room; if (lo < 0) lo -= room;
  const { y } = scaleY(lo, hi, height, M.t, M.b);
  const slot = (width - M.l - M.r) / Math.max(1, steps.length);
  const pad = Math.max(5, slot * 0.18);
  const wrap = (text: string): string[] => {
    const limit = Math.max(9, Math.floor(slot / 6.2));
    const lines: string[] = []; let cur = "";
    for (const word of text.split(" ")) { if ((cur + " " + word).trim().length > limit) { lines.push(cur); cur = word; } else cur = (cur + " " + word).trim(); }
    lines.push(cur);
    return lines.slice(0, 3);
  };
  return (
    <div ref={host} className="w-full">
      <svg width={width} height={height} role="group" aria-label={ariaLabel}>
        <line x1={M.l} x2={width - M.r} y1={y(0)} y2={y(0)} stroke="var(--border)" />
        {steps.map((s, i) => {
          const [a, b] = spans[i];
          const x0 = M.l + i * slot;
          const colour = s.kind === "total" ? "var(--fi-balance)" : s.kind === "gap" ? "var(--fi-gap)" : s.colour ?? (s.amountMinor >= 0 ? "var(--fi-up)" : "var(--fi-down)");
          const top = Math.min(y(a), y(b)), h = Math.max(2, Math.abs(y(a) - y(b)));
          const selectable = !!onSelect && (canSelect ? canSelect(s) : false);
          const content: ReactNode = (
            <>
              <p className="mb-1 font-semibold">{s.label}</p>
              <div className="flex justify-between gap-4 py-0.5"><span className="text-muted-foreground">{s.kind === "total" ? "Balance" : "Amount"}</span><span className="font-medium tabular-nums">{s.kind === "total" ? money(s.amountMinor) : signedMoney(s.amountMinor)}</span></div>
              {s.kind !== "total" && <div className="flex justify-between gap-4 py-0.5"><span className="text-muted-foreground">Running total</span><span className="tabular-nums">{money(b)}</span></div>}
              {s.note && <p className="mt-1 border-t border-border pt-1 text-muted-foreground">{s.note}</p>}
              {selectable && <p className="mt-1 text-muted-foreground">Select to see the transactions</p>}
            </>
          );
          const label = s.kind === "total" ? money(s.amountMinor) : signedMoney(s.amountMinor);
          const up = s.kind === "total" || s.amountMinor >= 0;
          return (
            <g key={s.key}>
              <rect x={x0 + pad} y={top} width={Math.max(1, slot - pad * 2)} height={h} rx={3} fill={colour} fillOpacity={s.kind === "total" ? 0.88 : s.kind === "gap" ? 0.5 : 1} stroke={s.kind === "gap" ? colour : "none"} strokeDasharray={s.kind === "gap" ? "4 3" : undefined} strokeWidth={1.5} />
              {i < steps.length - 1 && <line x1={x0 + slot - pad} x2={x0 + slot + pad} y1={y(b)} y2={y(b)} stroke="var(--muted-foreground)" strokeDasharray="2 2" />}
              <text x={x0 + slot / 2} y={up ? top - 5 : top + h + 12} textAnchor="middle" className="fill-foreground text-[10.5px] font-semibold">{label}</text>
              {wrap(s.label).map((t, k) => <text key={k} x={x0 + slot / 2} y={height - M.b + 15 + k * 11.5} textAnchor="middle" className={`fill-muted-foreground text-[10.5px] ${selectable ? "underline" : ""}`}>{t}</text>)}
              <rect x={x0} y={M.t} width={slot} height={height - M.t} fill="transparent" className={selectable ? "cursor-pointer" : undefined}
                onMouseMove={(e) => show(content, e)} onMouseLeave={hide} onClick={selectable ? () => onSelect!(s) : undefined}
                role={selectable ? "button" : undefined} tabIndex={selectable ? 0 : undefined} aria-label={selectable ? `${s.label}: ${label}. Show the transactions` : undefined}
                onKeyDown={selectable ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect!(s); } } : undefined} />
            </g>
          );
        })}
      </svg>
    </div>
  );
}
