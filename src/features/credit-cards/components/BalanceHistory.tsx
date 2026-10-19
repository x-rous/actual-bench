"use client";

import { lazyChart } from "./charts/lazyChart";
import { useMemo, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { ActivitySnapshot } from "../lib/activity";
import type { Card, Workspace } from "../lib/models";
import { dailyBalanceHistory, type BalanceRange } from "../lib/balanceHistory";
import { limitOn } from "../lib/derive/limits";
import { formatCardDate } from "../lib/displayDates";
import { MISSING, money, plural } from "./primitives/format";

const plot = lazyChart(() => import("./charts/CreditCardBalanceHistory"));
const Plot = plot.Chart;
/** Warms the balance chart module, so the first Overview draws without waiting for it. */
export const preloadBalanceChart = plot.preload;
const PLOT_LOADING = <div className="h-[294px] animate-pulse rounded bg-muted/30" aria-label="Loading daily balance chart" />;

type Props = {
  card: Card;
  workspace: Workspace;
  snapshot: ActivitySnapshot;
  signedBalanceMinor?: number;
  today: string;
  onStatement?: (id: string) => void;
  onPayment?: (id: string) => void;
};

const RANGES: [BalanceRange, string][] = [[6, "6 months"], [12, "12 months"]];

function Swatch({ children, label }: { children: ReactNode; label: string }) {
  return <span className="inline-flex items-center gap-1.5"><svg width="16" height="10" aria-hidden>{children}</svg>{label}</span>;
}

/**
 * Total owed per day (§9.6) over statement cycles, with each bill's outcome and the interest it
 * charged in a lane underneath; 6 (default) or 12 months back.
 */
export function BalanceHistory({ card, workspace, snapshot, signedBalanceMinor, today, onStatement, onPayment }: Props) {
  const [range, setRange] = useState<BalanceRange>(6);
  const history = useMemo(
    () => dailyBalanceHistory(card, workspace, snapshot, signedBalanceMinor, today, range),
    [card, workspace, snapshot, signedBalanceMinor, today, range],
  );
  const hasPlanAccount = workspace.plans.some((plan) => plan.cardId === card.id && plan.recordedAs === "plan-account");
  const stat = (label: string, value: string, detail?: string) => <div>
    <dt className="text-muted-foreground">{label}</dt>
    <dd className="mt-0.5 text-sm font-semibold tabular-nums">{value}</dd>
    {detail && <dd className="text-[11px] text-muted-foreground">{detail}</dd>}
  </div>;
  return <figure aria-label="Balance over time" className="min-w-0 rounded-lg border bg-background">
    <figcaption className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-2.5">
      <div className="min-w-0">
        <h2 className="text-sm font-semibold">Balance over time</h2>
        <p className="text-[11px] text-muted-foreground">
          {formatCardDate(history.from)} – {formatCardDate(today)}
          {history.pendingCount > 0 && ` · ${plural(history.pendingCount, "pending entry", "pending entries")} included`}
          {history.knownDays < history.totalDays && ` · ${history.knownDays} of ${history.totalDays} days known`}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
        <Swatch label="Total owed"><path d="M0 7h6V3h10" fill="none" stroke="currentColor" strokeWidth="1.5" /></Swatch>
        {history.projection && <Swatch label="If you pay Left to pay by the due date">
          <path d="M0 3h8v4h8" fill="none" stroke="var(--chart-1)" strokeWidth="1.5" strokeDasharray="3 2" />
        </Swatch>}
        <Swatch label="Interest-free"><rect width="16" height="10" fill="var(--chart-1)" opacity="0.15" /></Swatch>
        <Swatch label="Interest charged"><rect width="16" height="10" fill="var(--chart-rate-change)" opacity="0.25" /></Swatch>
        <Swatch label="Due: paid in full · minimum or late · overdue">
          <path d="M3 2l3 3-3 3-3-3z" className="fill-green-600" /><path d="M8 2l3 3-3 3-3-3z" className="fill-amber-500" />
          <path d="M13 2l3 3-3 3-3-3z" className="fill-red-600" />
        </Swatch>
        <Swatch label="Upcoming"><path d="M8 1l4 4-4 4-4-4z" fill="none" stroke="currentColor" strokeWidth="1.3" /></Swatch>
        <div role="group" aria-label="Chart range" className="inline-flex overflow-hidden rounded-md border text-xs">
          {RANGES.map(([value, label]) => <button
            key={String(value)}
            type="button"
            aria-pressed={range === value}
            onClick={() => setRange(value)}
            className={cn("h-7 px-2.5 font-medium", range === value ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground")}
          >{label}</button>)}
        </div>
      </div>
    </figcaption>
    <div className="p-4">
      {history.knownDays ? <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_180px]">
        <div className="min-w-0 overflow-x-auto">
          <Plot fallback={PLOT_LOADING} history={history} limitAt={(date) => limitOn(card, workspace, date)} onStatement={onStatement} onPayment={onPayment} />
        </div>
        <dl className="grid grid-cols-3 gap-3 text-xs xl:grid-cols-1 xl:gap-4 xl:pt-2">
          {stat("Average daily balance", money(history.averageMinor))}
          {stat("Highest daily balance", money(history.highest?.valueMinor), history.highest ? `on ${formatCardDate(history.highest.date)}` : undefined)}
          {stat("Interest & fees", money(history.costsMinor), "in this range")}
          {stat("Statements without interest", history.interestFreeStatements.total
            ? `${history.interestFreeStatements.free} of ${history.interestFreeStatements.total}` : MISSING, "reviewed, in this range")}
          {stat("Bills paid in full", history.billsPaidInFull.total ? `${history.billsPaidInFull.paid} of ${history.billsPaidInFull.total}` : MISSING,
            "on time, in this range")}
        </dl>
      </div> : <p className="py-8 text-sm text-muted-foreground">
        Load a current card balance{hasPlanAccount && " and its plan-account history"} to draw daily balances. Missing days are not shown as zero.
      </p>}
    </div>
  </figure>;
}
