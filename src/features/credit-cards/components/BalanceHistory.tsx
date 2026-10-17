"use client";

import dynamic from "next/dynamic";
import { useMemo } from "react";
import { formatAmount } from "@/features/assets-debt/lib/money";
import type { ActivitySnapshot } from "../lib/activity";
import type { Card, Workspace } from "../lib/models";
import { dailyBalanceHistory } from "../lib/balanceHistory";
import { formatCardDate } from "../lib/displayDates";
import { FieldInfo } from "./FieldInfo";

const Plot = dynamic(() => import("@/features/assets-debt/components/chart/CreditCardBalanceHistory"), { ssr: false, loading: () => <div className="h-[284px] animate-pulse rounded bg-muted/30" aria-label="Loading daily balance chart" /> });
const money = (minor: number | null | undefined) => minor == null ? "-" : formatAmount(minor, 2);

export function BalanceHistory({ card, workspace, snapshot, signedBalanceMinor, today, onStatement, onPayment }: {
  card: Card; workspace: Workspace; snapshot: ActivitySnapshot; signedBalanceMinor?: number; today: string;
  onStatement?: (id: string) => void; onPayment?: (id: string) => void;
}) {
  const history = useMemo(() => dailyBalanceHistory(card, workspace, snapshot, signedBalanceMinor, today), [card, workspace, snapshot, signedBalanceMinor, today]);
  const hasTracking = workspace.plans?.some((plan) => plan.cardId === card.id && plan.tracking);
  return <figure aria-label="Balance over time" className="min-w-0 rounded-lg border bg-background p-4">
    <figcaption className="mb-3 flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="text-sm font-semibold">Balance over time</h2><p className="mt-0.5 text-xs text-muted-foreground">What did I owe each day, and was any of it costing interest?</p></div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground" aria-label="Balance chart legend">
        <span className="inline-flex items-center gap-1"><i aria-hidden className="h-2 w-4 border-t-2 border-muted-foreground bg-muted" />Total owed</span><span>● Statement closes</span>
        <span className="inline-flex items-center gap-1"><i aria-hidden className="h-2 w-4 border border-chart-1/20 bg-chart-1/5" />Interest-free window</span>
        <span className="inline-flex items-center gap-1"><i aria-hidden className="h-2 w-4 " style={{ backgroundColor: "color-mix(in srgb,var(--chart-rate-change) 8%,transparent)", backgroundImage: "repeating-linear-gradient(135deg,transparent,transparent 2px,color-mix(in srgb,var(--chart-rate-change) 35%,transparent) 2px,color-mix(in srgb,var(--chart-rate-change) 35%,transparent) 4px)" }} />Interest period</span>
        <FieldInfo label="Balance chart interest shading">Blue windows follow confirmed bills paid in full by their deadline, without identified interest or borrowing in that cycle. Yellow hatching marks statement periods containing posted interest. These are visual indicators, not the bank’s daily interest calculation. Other periods stay unshaded. An unpaid 0% plan alone never creates yellow shading; interest-bearing plan terms prevent an inferred interest-free window.</FieldInfo>
      </div>
    </figcaption>
    {history.knownDays ? <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_170px]">
      <div className="min-w-0 overflow-x-auto"><Plot history={history} creditLimitMinor={card.creditLimitMinor} onStatement={onStatement} onPayment={onPayment} /></div>
      <dl className="grid grid-cols-3 gap-3 text-xs xl:grid-cols-1 xl:gap-5 xl:pt-5">
        <div><dt className="text-muted-foreground">Average daily balance</dt><dd className="mt-0.5 text-sm font-semibold tabular-nums">{money(history.averageMinor)}</dd><dd className="mt-0.5 text-[11px] text-muted-foreground">End-of-day balances</dd></div>
        <div><dt className="text-muted-foreground">Highest daily balance</dt><dd className="mt-0.5 text-sm font-semibold tabular-nums">{money(history.highest?.valueMinor)}</dd><dd className="mt-0.5 text-[11px] text-muted-foreground">{history.highest && `on ${formatCardDate(history.highest.date)}`}</dd></div>
        <div><dt className="text-muted-foreground">Interest &amp; fees</dt><dd className="mt-0.5 text-sm font-semibold tabular-nums">{money(history.costsMinor)}</dd><dd className="mt-0.5 text-[11px] text-muted-foreground">Cleared charges, net of refunds</dd></div>
      </dl>
    </div> : <p className="py-8 text-xs text-muted-foreground">Load a current card balance{hasTracking && " and its plan-account history"} to draw daily debt. Missing balances are not shown as zero.</p>}
    <p className="mt-2 text-[11px] text-muted-foreground">{formatCardDate(history.from)} – {formatCardDate(today)}{history.pendingCount > 0 && ` · ${history.pendingCount} pending ${history.pendingCount === 1 ? "entry" : "entries"} included provisionally`}{history.knownDays < history.totalDays && ` · ${history.knownDays} of ${history.totalDays} daily balances available; gaps excluded from the average`}<FieldInfo label="Daily balance calculation">Daily balances include the card and assigned off-budget plan principal once. Pending entries are provisional. The average uses available end-of-day balances only; missing dates are excluded.</FieldInfo></p>
  </figure>;
}
