"use client";

import { cn } from "@/lib/utils";
import type { Computed, GoalResult } from "@/lib/cashflow-planning/engine";
import { monthLabel } from "@/lib/cashflow-planning/months";
import { money } from "@/features/financial-insights/format";

const W = 320, H = 76, PAD = { l: 6, r: 6, t: 8, b: 16 };

/**
 * One goal at a glance: whether the forecast gets there, how close the balance is today, and the balance on its way to the goal's
 * month against the target. The line is the plan's closing cash (or cash and savings, for a goal measured on both).
 */
export function GoalCard({ result, computed }: { result: GoalResult; computed: Computed }) {
  const { goal, projected, shortfall, perMonth } = result;
  const end = computed.months.indexOf(goal.month);
  const from = Math.max(0, computed.currentIndex);
  const balance = (i: number) => computed.closing[i] + (goal.basis === "total" ? computed.savings?.[i] ?? 0 : 0);
  const outside = projected === null || end < 0;
  const reached = !outside && !shortfall;
  // Today's cash, not this month's closing forecast; the savings estimate of the month before stands for today's savings.
  const today = computed.kpis.cashNow + (goal.basis === "total" ? computed.savings?.[Math.max(0, from - 1)] ?? 0 : 0);
  const share = goal.amount > 0 ? Math.max(0, Math.min(1, today / goal.amount)) : 1;
  const tone = outside ? "text-muted-foreground" : reached ? "text-emerald-700 dark:text-emerald-400" : "text-destructive";

  // Chart: the balance from today to the goal's month, the target as a line.
  const last = outside ? from : Math.max(end, from);
  const series = Array.from({ length: last - from + 1 }, (_, k) => balance(from + k));
  const values = [...series, goal.amount];
  const hi = Math.max(...values), lo = Math.min(...values, 0);
  const span = hi - lo || 1;
  const x = (k: number) => PAD.l + (series.length <= 1 ? 0.5 : k / (series.length - 1)) * (W - PAD.l - PAD.r);
  const y = (v: number) => PAD.t + (1 - (v - lo) / span) * (H - PAD.t - PAD.b);
  const line = series.map((v, k) => `${x(k).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const area = `${x(0).toFixed(1)},${y(lo)} ${line} ${x(series.length - 1).toFixed(1)},${y(lo)}`;
  const stroke = reached ? "stroke-emerald-600" : outside ? "stroke-muted-foreground" : "stroke-destructive";
  const fill = reached ? "fill-emerald-600/10" : outside ? "fill-muted-foreground/10" : "fill-destructive/10";

  return (
    <li className="space-y-2 rounded-lg border border-border p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-medium" title={goal.name}>{goal.name}</p>
          <p className="text-muted-foreground">{money(goal.amount)} by {monthLabel(goal.month)} · {goal.basis === "total" ? "cash and savings" : "cash"}</p>
        </div>
        <span className={cn("shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium", reached ? "border-emerald-600/30 bg-emerald-600/10" : outside ? "border-border bg-muted" : "border-destructive/30 bg-destructive/10", tone)}>
          {outside ? "Outside the plan" : reached ? "On track" : "Short"}
        </span>
      </div>

      {!outside && (
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`${goal.name}: forecast balance from ${monthLabel(computed.months[from])} to ${monthLabel(goal.month)} against a target of ${money(goal.amount)}`}>
          <polygon points={area} className={fill} />
          <line x1={PAD.l} x2={W - PAD.r} y1={y(goal.amount)} y2={y(goal.amount)} className="stroke-foreground/50" strokeDasharray="4 3" strokeWidth={1} />
          <polyline points={line} fill="none" className={stroke} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          <circle cx={x(0)} cy={y(series[0])} r={3} className={cn("fill-background", stroke)} strokeWidth={1.5} />
          <circle cx={x(series.length - 1)} cy={y(series[series.length - 1])} r={3.5} className={cn(reached ? "fill-emerald-600" : "fill-destructive")} />
          <text x={W - PAD.r} y={Math.max(PAD.t + 2, y(goal.amount) - 3)} textAnchor="end" className="fill-muted-foreground text-[9px]">Goal</text>
          <text x={PAD.l} y={H - 3} className="fill-muted-foreground text-[9px]">{monthLabel(computed.months[from])}</text>
          <text x={W - PAD.r} y={H - 3} textAnchor="end" className="fill-muted-foreground text-[9px]">{monthLabel(goal.month)}</text>
        </svg>
      )}

      <div className="space-y-1">
        <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(share * 100)} aria-label={`${goal.name}: ${Math.round(share * 100)}% of the goal today`}>
          <div className={cn("h-full rounded-full", reached || share >= 1 ? "bg-emerald-600" : "bg-primary")} style={{ width: `${share * 100}%` }} />
        </div>
        <p className="text-muted-foreground">{money(today)} today, {Math.round(share * 100)}% of the goal</p>
      </div>

      {outside ? <p className="text-muted-foreground">This goal&apos;s month is outside the plan&apos;s months.</p> : (
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1">
          <dt className="text-muted-foreground">Forecast by {monthLabel(goal.month)}</dt><dd className="text-right font-medium tabular-nums">{money(projected)}</dd>
          <dt className="text-muted-foreground">{reached ? "To spare" : "Short by"}</dt><dd className={cn("text-right font-medium tabular-nums", tone)}>{money(reached ? projected - goal.amount : shortfall ?? 0)}</dd>
          {!reached && perMonth ? <><dt className="text-muted-foreground">More a month needed</dt><dd className="text-right font-medium tabular-nums">{money(perMonth)}</dd></> : null}
        </dl>
      )}
    </li>
  );
}
