"use client";

import { useRef } from "react";
import { compactAxis, money } from "@/features/financial-insights/format";
import { scaleY } from "@/features/financial-insights/components/charts/BarChart";
import { useTip, useWidth } from "@/features/financial-insights/components/charts/Tip";
import { cn } from "@/lib/utils";
import type { Computed } from "@/lib/cashflow-planning/engine";
import { monthLabel, yearOf } from "@/lib/cashflow-planning/months";
import { LABEL_WIDTH } from "../lib/view";
import type { Month, PlanDocument } from "@/lib/cashflow-planning/types";

function Stat({ label, value, detail, tone, onClick, first }: { first?: boolean; label: string; value: string; detail?: string; tone?: "bad" | "good"; /** Shows the month the figure is about in the grid. */ onClick?: () => void }) {
  const content = (
    <>
      <p className="truncate text-[11px] text-muted-foreground">{label}</p>
      <p className={cn("truncate text-base font-semibold leading-tight tabular-nums", tone === "bad" && "text-destructive", tone === "good" && "text-emerald-700 dark:text-emerald-400")}>{value}</p>
      <p className="truncate text-[11px] text-muted-foreground">{detail ?? "\u00a0"}</p>
    </>
  );
  const box = cn(first ? "shrink-0" : "flex-1", "min-w-0 border-r border-border px-4 py-2 text-left last:border-r-0");
  return onClick
    ? <button type="button" onClick={onClick} title="Show this month in the grid" style={first ? { width: LABEL_WIDTH } : undefined} className={cn(box, "outline-none hover:bg-accent/60 focus-visible:bg-accent")}>{content}</button>
    : <div className={box} style={first ? { width: LABEL_WIDTH } : undefined}>{content}</div>;
}

/** The answers the plan exists for, in one row: where cash stands, how low it gets, and when. */
export function SummaryStrip({ doc, computed, onGo }: { doc: PlanDocument; computed: Computed; onGo: (month: Month) => void }) {
  const { kpis } = computed;
  const minimum = doc.minimumCash;
  const lowest = kpis.lowest12;
  // Every month of a plan that has ended is a past month: there is no next year to look at.
  const ended = computed.kinds.length > 0 && computed.kinds.every((k) => k === "actual");
  const average = kpis.next12.months ? Math.round(kpis.next12.net / kpis.next12.months) : 0;
  return (
    <div className="flex shrink-0 border-b border-border bg-background" role="group" aria-label="Key figures">
      <Stat first label={doc.useActuals ? "Cash today" : "Opening cash"} value={money(kpis.cashNow)} detail={doc.useActuals ? "In the plan's cash accounts" : "Typed in Plan settings"} />
      <Stat label="Lowest point, next 12 months" value={lowest ? money(lowest.amount) : "-"} detail={lowest ? `End of ${monthLabel(lowest.month)}` : ended ? "This plan has ended" : undefined} tone={lowest && lowest.amount < (minimum ?? 0) ? "bad" : undefined} onClick={lowest ? () => onGo(lowest.month) : undefined} />
      {minimum === null
        ? <Stat label="Minimum cash" value="Not set" detail="Set one in Plan settings" />
        : ended
          ? <Stat label={`Minimum cash (${money(minimum)})`} value="-" detail="This plan has ended" />
          : kpis.firstBelow
          ? <Stat label={`Below the minimum (${money(minimum)})`} value={monthLabel(kpis.firstBelow)} detail="First month it happens" tone="bad" onClick={() => onGo(kpis.firstBelow!)} />
          : <Stat label={`Minimum cash (${money(minimum)})`} value="Never below" detail="Through the whole plan" tone="good" />}
      {kpis.endOfYear && <Stat label={`End of ${kpis.endOfYear.month.slice(0, 4)}`} value={money(kpis.endOfYear.amount)} detail="Forecast closing balance" onClick={() => onGo(kpis.endOfYear!.month)} />}
      {ended
        ? <Stat label="Next 12 months, net" value="-" detail="This plan has ended" />
        : <Stat label="Next 12 months, net" value={money(kpis.next12.net)} detail={`${money(average)} a month on average`} tone={kpis.next12.net < 0 ? "bad" : undefined} />}
      <Stat label={`End of plan (${monthLabel(kpis.endOfPlan.month)})`} value={money(kpis.endOfPlan.amount)} detail={computed.savings ? `With savings ${money(kpis.endOfPlan.amount + computed.savings[computed.savings.length - 1])}` : undefined} />
    </div>
  );
}

const MARGIN = { l: 52, r: 14, t: 10, b: 20 };

/**
 * The closing balance over the whole plan: a solid line for what happened, a dashed one for the forecast, the minimum as a
 * level, goals as diamonds. The years on screen in the grid are shaded; selecting a year moves the grid there.
 */
export function BalanceChart({ doc, computed, window, onPickYear, height = 150 }: { doc: PlanDocument; computed: Computed; window: { fromYear: number; span: number } | null; onPickYear: (year: number) => void; height?: number }) {
  const host = useRef<HTMLDivElement>(null);
  const width = useWidth(host);
  const { show, hide } = useTip();
  const { months, closing, kinds, savings } = computed;
  const total = savings ? closing.map((v, i) => v + savings[i]) : null;
  const all = [...closing, ...(total ?? []), ...(doc.minimumCash !== null ? [doc.minimumCash] : []), ...computed.goals.map((g) => g.goal.amount), 0];
  const hi = Math.max(...all), lo = Math.min(...all);
  const pad = (hi - lo || 1) * 0.06;
  const { y, marks } = scaleY(lo < 0 ? lo - pad : 0, hi + pad, height, MARGIN.t, MARGIN.b);
  const axis = compactAxis(marks);
  const inner = Math.max(1, width - MARGIN.l - MARGIN.r);
  const slot = inner / months.length;
  const x = (i: number) => MARGIN.l + (i + 0.5) * slot;
  // The forecast starts at the last recorded point, so the two lines meet.
  const lastActual = kinds.findLastIndex((k) => k === "actual");
  const path = (values: readonly number[], from: number, to: number) => values.slice(from, to + 1).map((v, k) => `${x(from + k)},${y(v)}`).join(" ");
  const years = [...new Set(months.map(yearOf))];
  const yearStart = (year: number) => months.findIndex((m) => yearOf(m) === year);
  const yearEnd = (year: number) => months.findLastIndex((m) => yearOf(m) === year);
  const labelEvery = Math.max(1, Math.ceil(years.length / Math.max(1, Math.floor(inner / 44))));
  const currentIndex = computed.currentIndex;

  return (
    <div ref={host} className="w-full shrink-0 border-b border-border bg-background px-2 pt-1">
      <svg width={width} height={height} role="group" aria-label="Closing cash balance over the plan">
        {window && years.filter((yr) => yr >= window.fromYear && yr < window.fromYear + window.span).map((yr) => (
          <rect key={`w${yr}`} x={MARGIN.l + yearStart(yr) * slot} y={MARGIN.t} width={(yearEnd(yr) - yearStart(yr) + 1) * slot} height={height - MARGIN.t - MARGIN.b} fill="var(--muted)" opacity={0.7} />
        ))}
        {marks.map((v, k) => <g key={v}><line x1={MARGIN.l} x2={width - MARGIN.r} y1={y(v)} y2={y(v)} stroke="var(--border)" strokeOpacity={0.6} /><text x={MARGIN.l - 6} y={y(v) + 3.5} textAnchor="end" className="fill-muted-foreground text-[10.5px]">{axis[k]}</text></g>)}
        {lo < 0 && <line x1={MARGIN.l} x2={width - MARGIN.r} y1={y(0)} y2={y(0)} stroke="var(--muted-foreground)" strokeWidth={1.2} />}
        {doc.minimumCash !== null && (
          <g>
            <line x1={MARGIN.l} x2={width - MARGIN.r} y1={y(doc.minimumCash)} y2={y(doc.minimumCash)} stroke="var(--destructive)" strokeWidth={1} strokeDasharray="2 3" />
            <text x={width - MARGIN.r - 2} y={y(doc.minimumCash) - 3} textAnchor="end" className="fill-destructive text-[10px]">Minimum</text>
          </g>
        )}
        {years.map((yr, k) => (
          <g key={yr}>
            {k > 0 && <line x1={MARGIN.l + yearStart(yr) * slot} x2={MARGIN.l + yearStart(yr) * slot} y1={MARGIN.t} y2={height - MARGIN.b} stroke="var(--border)" strokeOpacity={0.5} />}
            {k % labelEvery === 0 && <text x={MARGIN.l + (yearStart(yr) + (yearEnd(yr) - yearStart(yr) + 1) / 2) * slot} y={height - 5} textAnchor="middle" className="fill-muted-foreground text-[10.5px]">{yr}</text>}
          </g>
        ))}
        {total && <polyline fill="none" stroke="var(--chart-2)" strokeWidth={1.25} strokeOpacity={0.8} points={path(total, 0, months.length - 1)} />}
        {lastActual >= 1 && <polyline fill="none" stroke="var(--chart-1)" strokeWidth={2.25} strokeLinejoin="round" points={path(closing, 0, lastActual)} />}
        <polyline fill="none" stroke="var(--chart-1)" strokeWidth={2.25} strokeLinejoin="round" strokeDasharray={doc.useActuals ? "5 3" : undefined} points={path(closing, Math.max(0, lastActual), months.length - 1)} />
        {currentIndex >= 0 && (
          <g>
            <line x1={x(currentIndex)} x2={x(currentIndex)} y1={MARGIN.t} y2={height - MARGIN.b} stroke="var(--foreground)" strokeOpacity={0.45} strokeDasharray="3 3" />
            <text x={x(currentIndex) + 4} y={MARGIN.t + 9} className="fill-foreground text-[10px]">Today</text>
          </g>
        )}
        {computed.goals.filter((g) => g.projected !== null).map((g) => {
          const i = months.indexOf(g.goal.month);
          return <text key={g.goal.id} x={x(i)} y={y(g.goal.amount) + 4} textAnchor="middle" className={cn("text-[12px]", g.shortfall ? "fill-destructive" : "fill-emerald-600")}><title>{`${g.goal.name}: ${money(g.goal.amount)} by ${monthLabel(g.goal.month)}`}</title>◆</text>;
        })}
        {months.map((month, i) => (
          <rect
            key={month} x={MARGIN.l + i * slot} y={MARGIN.t} width={slot} height={height - MARGIN.t - MARGIN.b} fill="transparent" className="cursor-pointer"
            onClick={() => onPickYear(yearOf(month))}
            onMouseMove={(e) => show(
              <div className="space-y-0.5 text-xs">
                <p className="font-medium">{monthLabel(month)}{doc.useActuals ? ` · ${kinds[i] === "actual" ? "actual" : kinds[i] === "current" ? "this month" : "forecast"}` : ""}</p>
                <p className="tabular-nums">Closing balance {money(closing[i])}</p>
                <p className="tabular-nums text-muted-foreground">Net cashflow {money(computed.net[i])}</p>
                {total && <p className="tabular-nums text-muted-foreground">With savings {money(total[i])}</p>}
              </div>, e)}
            onMouseLeave={hide}
          />
        ))}
      </svg>
      <p className="flex flex-wrap items-center gap-x-4 px-2 pb-1 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1.5"><svg width="22" height="6" aria-hidden><line x1="0" x2="22" y1="3" y2="3" stroke="var(--chart-1)" strokeWidth="2.25" /></svg>Closing balance{doc.useActuals ? " (actual)" : ""}</span>
        {doc.useActuals && <span className="flex items-center gap-1.5"><svg width="22" height="6" aria-hidden><line x1="0" x2="22" y1="3" y2="3" stroke="var(--chart-1)" strokeWidth="2.25" strokeDasharray="5 3" /></svg>Forecast</span>}
        {total && <span className="flex items-center gap-1.5"><svg width="22" height="6" aria-hidden><line x1="0" x2="22" y1="3" y2="3" stroke="var(--chart-2)" strokeWidth="1.25" /></svg>Cash + savings</span>}
        {computed.goals.length > 0 && <span>◆ Goal</span>}
        <span className="ml-auto">Select a year to show it in the grid</span>
      </p>
    </div>
  );
}
