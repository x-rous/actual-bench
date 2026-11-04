"use client";

import { Fragment, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { withSmallDecimals } from "@/features/credit-cards/components/primitives/Figure";
import type { Status } from "@/lib/financial-insights/measures";
import { ASSET_CLASSES, CLASS_LABEL, LIABILITY_CLASSES, type ClassKey } from "@/lib/financial-insights/breakdowns";
import type { DrillTarget } from "@/lib/financial-insights/drill";
import type { ReviewEntry } from "@/lib/financial-insights/assetReview";
import { addMonths, monthLabel } from "@/lib/financial-insights/period";
import { holdings } from "@/lib/financial-insights/wealth";
import { GRANULARITY_NAME, balanceBuckets, endsEarly, lastIndex } from "@/lib/financial-insights/buckets";
import { useGranularity } from "../hooks/useGranularity";
import { UnitPills } from "./UnitPills";
import type { FinancialInsightsView } from "../hooks/useFinancialInsights";
import { MISSING, money, percent, signedMoney, formatDay } from "../format";
import { ChartFrame } from "./ChartFrame";
import { Delta } from "./Delta";
import { DrillLink } from "./DrillLink";
import { CardTitle } from "./InfoTip";
import { Tile } from "./Tile";
import { CLASS_COLOUR, CompositionChart } from "./charts/CompositionChart";
import { Waterfall, type WaterfallStep } from "./charts/Waterfall";

type Ready = Extract<FinancialInsightsView["data"], { state: "ready" }>;

const WARNING = "text-amber-700 dark:text-amber-400";

/** A figure that may be unavailable or need review: the number when ready, never a silent zero. */
function statusText<T>(status: Status<T>, format: (value: T) => string): { text: string; detail?: string; tone?: "warning" } {
  if (status.state === "ready") return { text: format(status.value) };
  return { text: status.state === "needsReview" ? "Needs review" : "Unavailable", detail: status.reason, tone: "warning" };
}

/** The average monthly spending, with the average of each category group behind it on hover or focus. */
function SpendingBreakdownTip({ groups, spendingMinor, months }: { groups: Ready["bufferSpending"]; spendingMinor: number; months: number }) {
  if (!groups || groups.groups.length === 0) return <>{money(spendingMinor)}</>;
  // Each average is rounded to a cent, so the groups can differ from the total by a cent or so each: that is rounding, not a cost.
  const rest = spendingMinor - groups.groups.reduce((a, g) => a + g.avgMinor, 0);
  return (
    <Popover>
      <PopoverTrigger openOnHover delay={150} render={<button type="button" aria-label={`Spending per month ${money(spendingMinor)}: see the average of each group`} className="cursor-help tabular-nums underline decoration-dotted underline-offset-4 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">{money(spendingMinor)}</button>} />
      <PopoverContent align="end" className="w-80 p-3 text-xs">
        <p className="mb-1.5 font-medium">Average per month, by group</p>
        <p className="mb-2 text-muted-foreground">Over the last {months} complete {months === 1 ? "month" : "months"}.</p>
        <table className="w-full border-collapse">
          <tbody>
            {groups.groups.map((g) => <tr key={g.name} className="border-b border-border/40"><th scope="row" className="max-w-52 py-1 text-left font-normal"><span className="block truncate" title={g.name}>{g.name}</span></th><td className="text-right tabular-nums">{money(g.avgMinor)}</td></tr>)}
            {rest !== 0 && <tr className="border-b border-border/40 text-muted-foreground"><th scope="row" className="py-1 text-left font-normal">{Math.abs(rest) <= groups.groups.length ? "Rounding" : "Loan interest and fees (counted in each loan\u2019s repayment)"}</th><td className="text-right tabular-nums">{money(rest)}</td></tr>}
            <tr className="font-semibold"><th scope="row" className="py-1.5 text-left">Spending per month</th><td className="text-right tabular-nums">{money(spendingMinor)}</td></tr>
          </tbody>
        </table>
      </PopoverContent>
    </Popover>
  );
}

function CashBuffer({ buffer, groups, today }: { buffer: Ready["buffer"]; groups: Ready["bufferSpending"]; today: string }) {
  return (
    <section className="flex h-full min-w-0 flex-col rounded-lg border border-border bg-card p-4" aria-label="Your cash buffer">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <CardTitle title="Your cash buffer" hint={`As of ${formatDay(today)}, whatever period is selected`} infoLabel="your cash buffer"
          info={<><p>How many months your cash &amp; bank balance would cover at your usual spending, plus every loan repayment.</p><p>The all-in figure counts every recorded expense. Investments and fixed / restricted deposits are not counted as cash; card payments and loan interest are not counted twice. The 0–12 month scale is not a recommended target.</p></>} />
              </div>
      {buffer.state === "ready" ? (
        <>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <p className="text-4xl font-semibold leading-none tracking-tight tabular-nums">{buffer.value.months.toFixed(1)} <span className="text-base font-normal text-muted-foreground">months</span></p>
              <p className="text-xs text-muted-foreground">of cover: cash &amp; bank ÷ needed per month</p>
            </div>
            <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-right">
              <p className="text-xs text-muted-foreground">Cash &amp; bank today</p>
              <p className="text-xl font-semibold leading-tight tabular-nums">{withSmallDecimals(money(buffer.value.cashMinor))}</p>
            </div>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted" role="img" aria-label={`${buffer.value.months.toFixed(1)} months on a scale of 0 to 12`}>
            <div className="h-full rounded-full bg-[var(--fi-cash)]" style={{ width: `${Math.min(100, (buffer.value.months / 12) * 100)}%` }} />
          </div>
          <div className="mt-1 flex justify-between text-[11px] text-muted-foreground"><span>0</span><span>12 months</span></div>
          <p className="mt-3 text-xs font-medium">What you need each month</p>
          <dl className="mt-1 text-xs">
            <div className="grid grid-cols-[1rem_minmax(0,1fr)_auto] items-baseline gap-x-2 py-1">
              <dd className="text-muted-foreground" aria-hidden />
              <dt>Spending per month<span className="block text-muted-foreground">average of the last {buffer.value.spendingMonths} complete {buffer.value.spendingMonths === 1 ? "month" : "months"}, without loan interest</span></dt>
              <dd className="tabular-nums"><SpendingBreakdownTip groups={groups} spendingMinor={buffer.value.spendingMinor} months={buffer.value.spendingMonths} /></dd>
            </div>
            {buffer.value.loans.map((loan) => (
              <div key={loan.accountId} className="grid grid-cols-[1rem_minmax(0,1fr)_auto] items-baseline gap-x-2 border-t border-border/40 py-1">
                <dd className="text-muted-foreground" aria-hidden>+</dd>
                <dt className="min-w-0"><span className="block truncate" title={loan.name}>{loan.name}</span><span className="block text-muted-foreground">{loan.source === "schedule" ? "scheduled repayment, principal + interest" : "recorded repayments, principal only"}</span></dt>
                <dd className="tabular-nums">{money(loan.monthlyMinor)}</dd>
              </div>
            ))}
            <div className="grid grid-cols-[1rem_minmax(0,1fr)_auto] items-baseline gap-x-2 border-t-2 border-foreground/70 py-1.5 text-sm font-semibold">
              <dd aria-hidden>=</dd><dt>Needed per month</dt><dd className="tabular-nums">{money(buffer.value.monthlyNeedMinor)}</dd>
            </div>
          </dl>
        </>
      ) : (
        <>
          <p className="mt-3 text-xl font-semibold">Unavailable</p>
          <p className="mt-1 text-xs text-muted-foreground">{buffer.state === "unavailable" ? buffer.reason : "Needs review"}</p>
        </>
      )}
    </section>
  );
}

function ReviewList({ rows, names }: { rows: ReviewEntry[]; names: ReadonlyMap<string, string> }) {
  if (rows.length === 0) return null;
  return (
    <details className="rounded-lg border border-border bg-card px-4 py-2 text-xs">
      <summary className="cursor-pointer font-medium">Asset entries to review ({rows.length})</summary>
      <p className="mt-2 text-muted-foreground">Assets classifies these as money put into an asset, but no transfer is recorded behind them, so they may also be counted as spending. Record the purchase as a transfer in Actual, or change the classification in Assets. Until then, Money kept and the savings rate are not shown.</p>
      <div className="mt-2 max-h-64 overflow-auto">
        <table className="w-full border-collapse">
          <thead className="sticky top-0 bg-card"><tr className="border-b border-border text-left text-muted-foreground"><th className="py-1 pr-3 font-medium">Date</th><th className="pr-3 font-medium">Account</th><th className="pr-3 text-right font-medium">Amount</th><th className="font-medium">Why</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-border/40"><td className="py-1 pr-3 tabular-nums">{formatDay(r.date)}</td><td className="pr-3">{names.get(r.accountId) ?? r.accountId}</td><td className="pr-3 text-right tabular-nums">{money(r.amountMinor)}</td><td className="text-muted-foreground">{r.reason}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}


const classRow = (c: Record<ClassKey, number>, k: ClassKey) => c[k];

/** Two stacked bars, what you owned and owed before the period started and at its end, with the change per class. */
function OwnAndOwe({ data }: { data: Ready }) {
  const { composition, summary, ledger, period } = data;
  const groups = useMemo(() => new Map(holdings(ledger, period).groups.map((g) => [g.key, g])), [ledger, period]);
  const [open, setOpen] = useState<ReadonlySet<ClassKey>>(new Set());
  const toggle = (k: ClassKey) => setOpen((prev) => { const next = new Set(prev); if (!next.delete(k)) next.add(k); return next; });
  const start = composition.opening, end = composition.months.length ? composition.months[composition.months.length - 1] : composition.opening;
  const bar = (c: Record<ClassKey, number>, title: string) => {
    const own = ASSET_CLASSES.reduce((a, k) => a + c[k], 0), owe = -LIABILITY_CLASSES.reduce((a, k) => a + c[k], 0);
    // Both bars share one scale and never pass the card: only the positive balances are drawn (a negative cash balance has no
    // length), and whichever of owned and owed is larger fills the width.
    const drawnOwn = ASSET_CLASSES.reduce((a, k) => a + Math.max(0, c[k]), 0);
    const drawnOwe = LIABILITY_CLASSES.reduce((a, k) => a + Math.max(0, -c[k]), 0);
    const scale = Math.max(1, drawnOwn, drawnOwe);
    const pct = (v: number) => Math.min(100, (v / scale) * 100);
    return (
      <div className="mb-3">
        <p className="mb-1 text-xs text-muted-foreground"><span className="font-medium text-foreground">{title}</span> · owns {money(own)} · owes {money(owe)} · net worth {money(own - owe)}</p>
        <div className="flex h-5 overflow-hidden rounded" style={{ width: `${pct(drawnOwn)}%` }}>{ASSET_CLASSES.map((k) => c[k] > 0 && <div key={k} title={`${CLASS_LABEL[k]}: ${money(c[k])}`} style={{ width: `${(c[k] / Math.max(1, drawnOwn)) * 100}%`, background: CLASS_COLOUR[k] }} className="border-r-2 border-card" />)}</div>
        <div className="mt-1 flex h-3 overflow-hidden rounded" style={{ width: `${drawnOwe > 0 ? Math.max(2, pct(drawnOwe)) : 0}%` }}>{LIABILITY_CLASSES.map((k) => c[k] < 0 && <div key={k} title={`${CLASS_LABEL[k]}: ${money(-c[k])}`} style={{ width: `${(-c[k] / Math.max(1, drawnOwe)) * 100}%`, background: CLASS_COLOUR[k] }} className="border-r-2 border-card" />)}</div>
      </div>
    );
  };
  const classes = [...ASSET_CLASSES, ...LIABILITY_CLASSES];
  // A period that begins or ends before the budget has any data has no balance there to show: it is unavailable, not zero.
  const startKnown = data.ledger.firstMonth !== null && data.ledger.firstMonth <= addMonths(data.period.startMonth, -1), endKnown = composition.hasData[composition.hasData.length - 1] ?? true;
  // The totals the two bars state in words: what is owned, what is owed (positive) and what is left.
  const owns = (c: Record<ClassKey, number>) => ASSET_CLASSES.reduce((a, k) => a + c[k], 0);
  const owes = (c: Record<ClassKey, number>) => -LIABILITY_CLASSES.reduce((a, k) => a + c[k], 0);
  const totals: [string, number | null, number | null][] = [["Total owned", startKnown ? owns(start) : null, endKnown ? owns(end) : null], ["Total owed", startKnown ? owes(start) : null, endKnown ? owes(end) : null], ["Net worth", startKnown ? owns(start) - owes(start) : null, endKnown ? owns(end) - owes(end) : null]];
  const classTotals = new Map(classes.map((k) => [k, [CLASS_LABEL[k], startKnown ? classRow(start, k) : null, endKnown ? classRow(end, k) : null, startKnown && endKnown ? classRow(end, k) - classRow(start, k) : null] as const]));
  // The CSV lists every account under its class, so what the card hides (accounts with no balance) is still in the file.
  const table = { head: ["Class or account", "Start of period", "End", "Change"], rows: [...classes.flatMap((k) => [[...classTotals.get(k)!] as (string | number | null)[], ...(groups.get(k)?.rows ?? []).map((r) => [`${CLASS_LABEL[k]} · ${r.name}`, startKnown ? r.openingMinor : null, endKnown ? r.closingMinor : null, startKnown && endKnown ? r.changeMinor : null] as (string | number | null)[])]), ...totals.map(([name, a, b]) => [name, a, b, a === null || b === null ? null : b - a])] };
  return (
    <ChartFrame
      id="own-and-owe" title="What you own and owe, start and end" hint="Balances before the period and at its end"
      subtitle={<><p>Start is the balance before {formatDay(summary.period.startDate)}; end is {formatDay(summary.period.endDate)}.</p><p>The classes are the ones on the Accounts page.</p></>}
      legend={classes.map((k) => ({ label: CLASS_LABEL[k], colour: CLASS_COLOUR[k] }))} table={table} tableShown
      csvScope={[["Period", `${summary.period.label}: ${formatDay(summary.period.startDate)} to ${formatDay(summary.period.endDate)}`]]}
    >
      {startKnown ? bar(start, "Start of period") : <p className="mb-3 text-xs text-muted-foreground"><span className="font-medium text-foreground">Start of period</span> · no data yet: the budget has no transactions before this period</p>}
      {endKnown ? bar(end, "End") : <p className="mb-3 text-xs text-muted-foreground"><span className="font-medium text-foreground">End</span> · no data yet: the budget has no transactions up to the end of this period</p>}
      <div className="max-h-[26rem] overflow-auto">
        <table className="w-full border-collapse text-xs">
          <thead className="sticky top-0 z-10 bg-card"><tr className="border-b border-border text-muted-foreground"><th className="py-1 text-left font-medium">Class</th><th className="text-right font-medium">Start</th><th className="text-right font-medium">End</th><th className="text-right font-medium">Change</th></tr></thead>
          <tbody>
            {classes.map((k) => {
              const group = groups.get(k);
              const shown = group?.rows.filter((r) => r.openingMinor !== 0 || r.closingMinor !== 0).sort((x, y) => Math.abs(y.closingMinor) - Math.abs(x.closingMinor) || Math.abs(y.openingMinor) - Math.abs(x.openingMinor)) ?? [];
              const hidden = (group?.rows.length ?? 0) - shown.length;
              const isOpen = open.has(k) && shown.length > 0;
              const [, a, b, c] = classTotals.get(k)!;
              return (
                <Fragment key={k}>
                  <tr className="border-b border-border/40">
                    <th scope="row" className="py-1 text-left font-normal">
                      <span className="inline-flex items-center gap-1.5">
                        {shown.length > 0
                          ? <button type="button" className="-ml-1 inline-flex size-4 items-center justify-center rounded text-muted-foreground hover:text-foreground" aria-expanded={isOpen} aria-label={`${CLASS_LABEL[k]}: ${isOpen ? "hide" : "show"} accounts`} onClick={() => toggle(k)}>{isOpen ? <ChevronDown className="size-3.5" aria-hidden /> : <ChevronRight className="size-3.5" aria-hidden />}</button>
                          : <span className="inline-block w-3" aria-hidden />}
                        <span className="size-2.5 shrink-0 rounded-sm" style={{ background: CLASS_COLOUR[k] }} aria-hidden />{CLASS_LABEL[k]}
                      </span>
                    </th>
                    <td className="text-right tabular-nums">{money(a)}</td><td className="text-right tabular-nums">{money(b)}</td><td className="text-right tabular-nums">{c === null ? MISSING : signedMoney(c)}</td>
                  </tr>
                  {isOpen && shown.map((r) => (
                    <tr key={r.accountId} className="border-b border-border/40 bg-muted/30">
                      <th scope="row" className="max-w-0 py-1 pl-9 pr-2 text-left font-normal"><span className="block truncate" title={r.name}>{r.name}</span>{r.treatment && <span className="block truncate text-[11px] text-muted-foreground">{r.treatment}</span>}</th>
                      <td className="text-right tabular-nums">{startKnown ? money(r.openingMinor) : MISSING}</td><td className="text-right tabular-nums">{endKnown ? money(r.closingMinor) : MISSING}</td><td className="text-right tabular-nums">{startKnown && endKnown ? signedMoney(r.changeMinor) : MISSING}</td>
                    </tr>
                  ))}
                  {isOpen && hidden > 0 && <tr className="border-b border-border/40 bg-muted/30"><td colSpan={4} className="py-1 pl-9 text-[11px] text-muted-foreground">{hidden} {hidden === 1 ? "account" : "accounts"} with no balance at the start or the end {hidden === 1 ? "is" : "are"} not listed</td></tr>}
                </Fragment>
              );
            })}
          </tbody>
          <tfoot className="sticky bottom-0 z-10 bg-card">{totals.map(([name, a, b], i) => <tr key={name} className={`${i === 0 ? "border-t-2 border-foreground/70" : "border-t border-border/40"} font-semibold`}><th scope="row" className="py-1 text-left font-semibold">{name}</th><td className="text-right tabular-nums">{money(a)}</td><td className="text-right tabular-nums">{money(b)}</td><td className="text-right tabular-nums">{a === null || b === null ? MISSING : signedMoney(b - a)}</td></tr>)}</tfoot>
        </table>
      </div>
    </ChartFrame>
  );
}

export function SummaryTab({ data, today, accountNames, onDrill }: { data: Ready; today: string; accountNames: ReadonlyMap<string, string>; onDrill: (target: DrillTarget) => void }) {
  const { summary, buffer, bufferSpending, review, composition, netWorthChange, comparison } = data;
  const [hidden, setHidden] = useState<ReadonlySet<ClassKey>>(new Set());
  const [hideLine, setHideLine] = useState(false);
  const kept = statusText(summary.moneyKept, money);
  const rate = statusText(summary.savingsRate, percent);
  const months = summary.period.months.length;
  const period = `${summary.period.label}: ${formatDay(summary.period.startDate)} to ${formatDay(summary.period.endDate)}`;
  // The unit of the chart of balances: a quarter or a year is stood for by its last month's balance.
  const [unit, setUnit] = useGranularity(summary.period.months);
  const names = GRANULARITY_NAME[unit];
  const buckets = useMemo(() => balanceBuckets(composition.months.map((m) => m.month), unit), [composition.months, unit]);
  const chartMonths = buckets.map((b) => composition.months[lastIndex(b)]);
  const chartNetWorth = buckets.map((b) => composition.netWorth[lastIndex(b)]);
  // A month before the budget has data is unavailable, never a balance of zero.
  const chartKnown = buckets.map((b) => composition.hasData[lastIndex(b)] ?? true);
  const labels = buckets.map((b) => b.label);
  const lastBucket = buckets[buckets.length - 1];
  const stopsEarly = !!lastBucket && endsEarly(lastBucket, unit);
  const partialIndex = summary.period.partial || stopsEarly ? buckets.length - 1 : null;
  const toggle = (k: ClassKey) => setHidden((h) => { const n = new Set(h); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const anyHidden = hidden.size > 0 || hideLine;
  // The budget has no data before its first month: a period that starts there has no opening balance to show, not a zero.
  const openingKnown = data.ledger.firstMonth !== null && data.ledger.firstMonth <= addMonths(data.period.startMonth, -1);
  const growth = openingKnown && summary.netWorth.opening !== 0 ? (summary.netWorth.change / Math.abs(summary.netWorth.opening)) * 100 : null;
  const steps: WaterfallStep[] = [
    ...netWorthChange.steps.map((s) => ({ key: s.key, label: s.label, kind: "delta" as const, amountMinor: s.amountMinor, note: s.note })),
    ...(netWorthChange.unexplainedMinor !== 0 ? [{ key: "unexplained", label: "Unexplained", kind: "gap" as const, amountMinor: netWorthChange.unexplainedMinor, note: "What the components above do not explain. It is shown, never forced to zero." }] : []),
    { key: "total", label: "Total change", kind: "total", amountMinor: netWorthChange.changeMinor, note: "Net worth at the end less net worth before the period" },
  ];
  const stepTarget = (key: string): DrillTarget | null => {
    const step = netWorthChange.steps.find((s) => s.key === key);
    return step?.drill ? (step.drill === "inTransit" ? { kind: "inTransit", cashOnly: false } : { kind: step.drill }) : null;
  };
  const compTable = { head: [names.one[0].toUpperCase() + names.one.slice(1), ...ASSET_CLASSES.map((k) => CLASS_LABEL[k]), ...LIABILITY_CLASSES.map((k) => CLASS_LABEL[k]), "Net worth"], rows: chartMonths.map((m, i) => [labels[i] + (i === partialIndex ? (summary.period.partial ? " (today)" : ` (to ${monthLabel(buckets[i].last)})`) : ""), ...ASSET_CLASSES.map((k) => (chartKnown[i] ? m[k] : null)), ...LIABILITY_CLASSES.map((k) => (chartKnown[i] ? m[k] : null)), chartKnown[i] ? chartNetWorth[i] : null]) };
  const legend = [
    ...[...ASSET_CLASSES, ...LIABILITY_CLASSES].map((k) => ({ label: CLASS_LABEL[k], colour: CLASS_COLOUR[k], onToggle: () => toggle(k), off: hidden.has(k) })),
    { label: "Net worth (line)", colour: "var(--fi-networth)", dot: true, onToggle: () => setHideLine((v) => !v), off: hideLine },
  ];
  return (
    <div className="space-y-4 p-4">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Tile label="Net worth" detail={<>Owns {money(summary.assets)} · owes {money(summary.liabilities)}</>}>{money(summary.netWorth.closing)}</Tile>
        <Tile label="Change in net worth" detail={<>{growth !== null ? `${growth > 0 ? "+" : ""}${percent(growth)} over ` : "Over "}{months} {months === 1 ? "month" : "months"}<span className="block">Everything owned less owed</span></>}>{openingKnown ? signedMoney(summary.netWorth.change) : MISSING}</Tile>
        <Tile label="Money kept" tone={kept.tone}
          detail={kept.detail ?? (
            <>
              <DrillLink label={`Money received ${money(summary.received)}`} onClick={() => onDrill({ kind: "received" })}>{money(summary.received)}</DrillLink> received − <DrillLink label={`Money spent ${money(summary.spent)}`} onClick={() => onDrill({ kind: "spent" })}>{money(summary.spent)}</DrillLink> spent · savings rate {rate.text}
              {comparison && summary.moneyKept.state === "ready" && <Delta now={comparison.current.kept} before={comparison.previous.kept} label={comparison.label} good="up" />}
            </>)}>{kept.text}</Tile>
        <Tile label="Change in cash" detail="Cash & bank, end less start">{signedMoney(summary.eligibleCash.change)}</Tile>
        <Tile label="Savings rate" tone={summary.savingsRate.state === "ready" ? undefined : "warning"} detail={summary.savingsRate.state === "ready" ? <>Money kept ÷ money received{comparison && comparison.current.received > 0 && comparison.previous.received > 0 && <Delta points now={(comparison.current.kept / comparison.current.received) * 100} before={(comparison.previous.kept / comparison.previous.received) * 100} label={comparison.label} good="up" />}</> : summary.savingsRate.reason}>{summary.savingsRate.state === "ready" ? percent(summary.savingsRate.value) : "Needs review"}</Tile>
      </div>
      <div className="grid items-stretch gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(20rem,2fr)]">
        <ChartFrame
          id="composition" title={`What you own and owe, ${names.one} by ${names.one}`} hint="Select a class in the legend to add or remove it"
          subtitle={<><p>Assets are stacked above zero, liabilities below it, and net worth is the line. Balances are measured at each {names.one} end.{unit !== "month" && ` A ${names.one} is a calendar ${names.one}, shown by its last month's balance.`}</p><p>Select a class in the legend to include it in or remove it from the chart. Net worth is always the true total, whatever is hidden.</p></>}
          legend={legend}
          table={compTable} csvScope={[["Period", period], ["As of", formatDay(summary.period.endDate)]]}
          actions={<div className="flex flex-wrap items-center gap-2">{anyHidden && <Button size="xs" variant="ghost" onClick={() => { setHidden(new Set()); setHideLine(false); }}>Show all</Button>}<UnitPills value={unit} onChange={setUnit} label="Show balances by" /></div>}
          footnote={[partialIndex !== null ? (summary.period.partial ? "The last bar is the balance today (a valid current balance, not a partial total)." : `* The last bar is the balance at the end of the period (${formatDay(summary.period.endDate)}), not at the end of the ${names.one}.`) : "", hidden.size > 0 ? "Hidden classes are left out of the bars only; the net worth line still includes them." : ""].filter(Boolean).join(" ") || undefined}
        >
          <CompositionChart labels={labels} partialIndex={partialIndex} months={chartMonths} netWorth={chartNetWorth} hasData={chartKnown} hidden={hidden} showNetWorth={!hideLine} unitName={names.one} partialText={summary.period.partial ? "balance today" : "balance at the end of the period"} />
        </ChartFrame>
        <CashBuffer buffer={buffer} groups={bufferSpending} today={today} />
      </div>
      <div className="grid items-stretch gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(20rem,2fr)]">
        <ChartFrame
          id="net-worth-change"
          title={<span className="flex flex-wrap items-center gap-2">What changed your net worth {netWorthChange.unexplainedMinor === 0 ? <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11px] font-normal text-muted-foreground"><CheckCircle2 className="size-3" aria-hidden />Reconciled</span> : <span className={`inline-flex items-center gap-1 rounded-full border border-amber-500/60 px-2 py-0.5 text-[11px] font-normal ${WARNING}`}><AlertTriangle className="size-3" aria-hidden />{money(Math.abs(netWorthChange.unexplainedMinor))} unexplained</span>}</span>}
          hint="Start to end of the period"
          subtitle={<><p>Net worth before {formatDay(summary.period.startDate)} {openingKnown ? <>was {money(netWorthChange.openingMinor)}</> : "is unavailable: the budget has no data that early"}; on {formatDay(summary.period.endDate)} it is {money(netWorthChange.closingMinor)}. Only components Bench can identify are shown.</p><p>Select a step with an underlined label to see its transactions.</p></>}
          legend={[{ label: "Raises net worth", colour: "var(--fi-up)" }, { label: "Lowers net worth", colour: "var(--fi-down)" }, { label: "Net change", colour: "var(--fi-balance)" }]}
          table={{ head: ["Step", "Amount"], rows: [["Net worth before the period", openingKnown ? netWorthChange.openingMinor : null], ...steps.filter((s) => s.kind !== "total").map((s) => [s.label, s.amountMinor] as (string | number)[]), ["Net worth at the end", netWorthChange.closingMinor]] }}
          csvScope={[["Period", period]]}
          footnote={netWorthChange.unexplainedMinor === 0 ? "The bars start at zero, showing the change rather than net worth itself. Reconciled: the components add up exactly to the change." : "The bars start at zero, showing the change rather than net worth itself. The dashed bar is what the components do not explain."}
        >
          <dl role="group" className="mb-3 grid grid-cols-3 gap-3 text-xs" aria-label="Net worth at the start and end of the period, and the change">
            <div><dt className="text-muted-foreground">Start · before {formatDay(summary.period.startDate)}</dt><dd className="text-lg font-semibold tabular-nums">{openingKnown ? money(netWorthChange.openingMinor) : MISSING}</dd></div>
            <div><dt className="text-muted-foreground">Change</dt><dd className="text-lg font-semibold tabular-nums">{openingKnown ? signedMoney(netWorthChange.changeMinor) : MISSING}{openingKnown && netWorthChange.openingMinor !== 0 && <span className="ml-1.5 text-xs font-normal text-muted-foreground">({netWorthChange.changeMinor > 0 ? "+" : ""}{percent((netWorthChange.changeMinor / Math.abs(netWorthChange.openingMinor)) * 100)})</span>}</dd></div>
            <div><dt className="text-muted-foreground">End · {formatDay(summary.period.endDate)}</dt><dd className="text-lg font-semibold tabular-nums">{money(netWorthChange.closingMinor)}</dd></div>
          </dl>
          <Waterfall steps={steps} ariaLabel="Components of the change in net worth" canSelect={(s) => stepTarget(s.key) !== null} onSelect={(s) => { const t = stepTarget(s.key); if (t) onDrill(t); }} />
        </ChartFrame>
        <OwnAndOwe data={data} />
      </div>
      <details className="rounded-lg border border-border bg-card px-4 py-3 text-xs">
        <summary className="cursor-pointer font-medium">How money kept, change in cash and change in net worth differ</summary>
        <dl className="mt-2 grid gap-3 md:grid-cols-3">
          <div><dt className="font-medium">Money kept <span className="font-normal text-muted-foreground">(income − spending)</span></dt><dd className="text-muted-foreground">What you earned and did not spend. Moving money into investments or paying loan principal is not spending.</dd></div>
          <div><dt className="font-medium">Change in cash <span className="font-normal text-muted-foreground">(cash &amp; bank, end − start)</span></dt><dd className="text-muted-foreground">How your cash balance moved after investments, card payments, loans and transfers. It can fall even when you kept money.</dd></div>
          <div><dt className="font-medium">Change in net worth <span className="font-normal text-muted-foreground">(everything owned − owed)</span></dt><dd className="text-muted-foreground">What you kept plus changes in the value of what you own, and anything Bench cannot place (the waterfall above shows each part).</dd></div>
        </dl>
      </details>
      <ReviewList rows={review} names={accountNames} />
    </div>
  );
}
