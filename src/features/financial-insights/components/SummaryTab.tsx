"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { withSmallDecimals } from "@/features/credit-cards/components/primitives/Figure";
import { PillGroup } from "@/components/ui/pill-group";
import type { Status } from "@/lib/financial-insights/measures";
import { ASSET_CLASSES, CLASS_LABEL, LIABILITY_CLASSES, type ClassKey } from "@/lib/financial-insights/breakdowns";
import type { DrillTarget } from "@/lib/financial-insights/drill";
import type { ReviewEntry } from "@/lib/financial-insights/assetReview";
import { monthLabel } from "@/lib/financial-insights/period";
import type { FinancialInsightsView } from "../hooks/useFinancialInsights";
import { money, percent, signedMoney, formatDay } from "../format";
import { ChartFrame } from "./ChartFrame";
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
  const [view, setView] = useState<"all" | "adjusted">("all");
  return (
    <section className="flex h-full min-w-0 flex-col rounded-lg border border-border bg-card p-4" aria-label="Your cash buffer">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <CardTitle title="Your cash buffer" hint={`As of ${formatDay(today)}, whatever period is selected`} infoLabel="your cash buffer"
          info={<><p>How many months your cash &amp; bank balance would cover at your usual spending, plus every loan repayment.</p><p>The all-in figure counts every recorded expense. Investments and fixed / restricted deposits are not counted as cash; card payments and loan interest are not counted twice. The 0–12 month scale is not a recommended target.</p></>} />
        {buffer.state === "ready" && <PillGroup options={[{ value: "all", label: "All-in" }, { value: "adjusted", label: "Adjusted" }]} value={view} onChange={(v) => setView(v as typeof view)} />}
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
          {view === "adjusted" && (
            <div className="mt-3 space-y-2 rounded-md border border-dashed border-border bg-muted/30 p-3 text-xs" aria-label="Adjusted cash buffer">
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-md border border-border bg-card p-2"><p className="text-muted-foreground">All-in</p><p className="text-base font-semibold tabular-nums">{buffer.value.months.toFixed(1)} months</p><p className="text-muted-foreground">{money(buffer.value.spendingMinor)} spending per month</p></div>
                <div className="rounded-md border border-border bg-card p-2"><p className="text-muted-foreground">Adjusted (0 excluded)</p><p className="text-base font-semibold tabular-nums">{buffer.value.months.toFixed(1)} months</p><p className="text-muted-foreground">{money(buffer.value.spendingMinor)} spending per month</p></div>
              </div>
              <p className="font-medium">One-off expenses left out of the average</p>
              <p className="text-muted-foreground">None chosen. You will pick specific expenses from the shared transaction list; each one is listed here with its amount and what it does to spending per month and to the months of cover. Nothing in Actual is changed.</p>
              <p className="text-muted-foreground">Use it for costs that will not come back, such as a legal fee or a one-time repair. Annual insurance, school fees or a yearly levy do come back, so leaving them in is the safer estimate.</p>
              <button type="button" disabled className="rounded-md border border-border px-3 py-1.5 text-muted-foreground opacity-60" title="Choosing and saving exclusions arrives in the next phase">Choose one-off expenses…</button>
              <p className="text-muted-foreground">Preview: choosing and saving exclusions arrives in the next phase. Until then both estimates are the same.</p>
            </div>
          )}
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
  const { composition, summary } = data;
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
  const table = { head: ["Class", "Start of period", "End", "Change"], rows: classes.map((k) => [CLASS_LABEL[k], classRow(start, k), classRow(end, k), classRow(end, k) - classRow(start, k)]) };
  return (
    <ChartFrame
      id="own-and-owe" title="What you own and owe, start and end" hint="Balances before the period and at its end"
      subtitle={<><p>Start is the balance before {formatDay(summary.period.startDate)}; end is {formatDay(summary.period.endDate)}.</p><p>The classes are the ones on the Accounts page.</p></>}
      legend={classes.map((k) => ({ label: CLASS_LABEL[k], colour: CLASS_COLOUR[k] }))} table={table} tableShown
      csvScope={[["Period", `${summary.period.label}: ${formatDay(summary.period.startDate)} to ${formatDay(summary.period.endDate)}`]]}
    >
      {bar(start, "Start of period")}
      {bar(end, "End")}
      <table className="w-full border-collapse text-xs">
        <thead><tr className="border-b border-border text-muted-foreground"><th className="py-1 text-left font-medium">Class</th><th className="text-right font-medium">Start</th><th className="text-right font-medium">End</th><th className="text-right font-medium">Change</th></tr></thead>
        <tbody>{classes.map((k, i) => <tr key={k} className="border-b border-border/40"><th scope="row" className="py-1 text-left font-normal"><span className="inline-flex items-center gap-1.5"><span className="size-2.5 shrink-0 rounded-sm" style={{ background: CLASS_COLOUR[k] }} aria-hidden />{table.rows[i][0]}</span></th><td className="text-right tabular-nums">{money(table.rows[i][1] as number)}</td><td className="text-right tabular-nums">{money(table.rows[i][2] as number)}</td><td className="text-right tabular-nums">{signedMoney(table.rows[i][3] as number)}</td></tr>)}</tbody>
      </table>
    </ChartFrame>
  );
}

export function SummaryTab({ data, today, accountNames, onDrill }: { data: Ready; today: string; accountNames: ReadonlyMap<string, string>; onDrill: (target: DrillTarget) => void }) {
  const { summary, buffer, bufferSpending, review, composition, netWorthChange } = data;
  const [hidden, setHidden] = useState<ReadonlySet<ClassKey>>(new Set());
  const [hideLine, setHideLine] = useState(false);
  const kept = statusText(summary.moneyKept, money);
  const rate = statusText(summary.savingsRate, percent);
  const months = summary.period.months.length;
  const period = `${summary.period.label}: ${formatDay(summary.period.startDate)} to ${formatDay(summary.period.endDate)}`;
  const labels = composition.months.map((m) => monthLabel(m.month));
  const partialIndex = summary.period.partial ? composition.months.length - 1 : null;
  const toggle = (k: ClassKey) => setHidden((h) => { const n = new Set(h); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const anyHidden = hidden.size > 0 || hideLine;
  const growth = summary.netWorth.opening !== 0 ? (summary.netWorth.change / Math.abs(summary.netWorth.opening)) * 100 : null;
  const steps: WaterfallStep[] = [
    ...netWorthChange.steps.map((s) => ({ key: s.key, label: s.label, kind: "delta" as const, amountMinor: s.amountMinor, note: s.note })),
    ...(netWorthChange.unexplainedMinor !== 0 ? [{ key: "unexplained", label: "Unexplained", kind: "gap" as const, amountMinor: netWorthChange.unexplainedMinor, note: "What the components above do not explain. It is shown, never forced to zero." }] : []),
    { key: "total", label: "Total change", kind: "total", amountMinor: netWorthChange.changeMinor, note: "Net worth at the end less net worth before the period" },
  ];
  const stepTarget = (key: string): DrillTarget | null => {
    const step = netWorthChange.steps.find((s) => s.key === key);
    return step?.drill ? (step.drill === "inTransit" ? { kind: "inTransit", cashOnly: false } : { kind: step.drill }) : null;
  };
  const compTable = { head: ["Month", ...ASSET_CLASSES.map((k) => CLASS_LABEL[k]), ...LIABILITY_CLASSES.map((k) => CLASS_LABEL[k]), "Net worth"], rows: composition.months.map((m, i) => [monthLabel(m.month) + (i === partialIndex ? " (today)" : ""), ...ASSET_CLASSES.map((k) => (composition.hasData[i] ? m[k] : null)), ...LIABILITY_CLASSES.map((k) => (composition.hasData[i] ? m[k] : null)), composition.hasData[i] ? composition.netWorth[i] : null]) };
  const legend = [
    ...[...ASSET_CLASSES, ...LIABILITY_CLASSES].map((k) => ({ label: CLASS_LABEL[k], colour: CLASS_COLOUR[k], onToggle: () => toggle(k), off: hidden.has(k) })),
    { label: "Net worth (line)", colour: "var(--fi-networth)", dot: true, onToggle: () => setHideLine((v) => !v), off: hideLine },
  ];
  return (
    <div className="space-y-4 p-4">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Tile label="Net worth" detail={<>Owns {money(summary.assets)} · owes {money(summary.liabilities)}</>}>{money(summary.netWorth.closing)}</Tile>
        <Tile label="Change in net worth" detail={<>Over {months} {months === 1 ? "month" : "months"}{growth !== null ? ` · ${growth > 0 ? "+" : ""}${percent(growth)}` : ""} · everything owned less owed</>}>{signedMoney(summary.netWorth.change)}</Tile>
        <Tile label="Money kept" tone={kept.tone}
          detail={kept.detail ?? (
            <>
              <DrillLink label={`Money received ${money(summary.received)}`} onClick={() => onDrill({ kind: "received" })}>{money(summary.received)}</DrillLink> received − <DrillLink label={`Money spent ${money(summary.spent)}`} onClick={() => onDrill({ kind: "spent" })}>{money(summary.spent)}</DrillLink> spent · savings rate {rate.text}
            </>)}>{kept.text}</Tile>
        <Tile label="Change in cash" detail="Cash & bank, end less start">{signedMoney(summary.eligibleCash.change)}</Tile>
        <Tile label="Savings rate" tone={summary.savingsRate.state === "ready" ? undefined : "warning"} detail={summary.savingsRate.state === "ready" ? "Money kept ÷ money received" : summary.savingsRate.reason}>{summary.savingsRate.state === "ready" ? percent(summary.savingsRate.value) : "Needs review"}</Tile>
      </div>
      <div className="grid items-stretch gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(20rem,2fr)]">
        <ChartFrame
          id="composition" title="What you own and owe, month by month" hint="Select a class in the legend to add or remove it"
          subtitle={<><p>Assets are stacked above zero, liabilities below it, and net worth is the line. Balances are measured at each month end.</p><p>Select a class in the legend to include it in or remove it from the chart. Net worth is always the true total, whatever is hidden.</p></>}
          legend={legend}
          table={compTable} csvScope={[["Period", period], ["As of", formatDay(summary.period.endDate)]]}
          actions={anyHidden ? <Button size="xs" variant="ghost" onClick={() => { setHidden(new Set()); setHideLine(false); }}>Show all</Button> : undefined}
          footnote={[partialIndex !== null ? "The last bar is the balance today (a valid current balance, not a partial total)." : "", hidden.size > 0 ? "Hidden classes are left out of the bars only; the net worth line still includes them." : ""].filter(Boolean).join(" ") || undefined}
        >
          <CompositionChart labels={labels} partialIndex={partialIndex} months={composition.months} netWorth={composition.netWorth} hasData={composition.hasData} hidden={hidden} showNetWorth={!hideLine} />
        </ChartFrame>
        <CashBuffer buffer={buffer} groups={bufferSpending} today={today} />
      </div>
      <div className="grid items-stretch gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(20rem,2fr)]">
        <ChartFrame
          id="net-worth-change"
          title={<span className="flex flex-wrap items-center gap-2">What changed your net worth {netWorthChange.unexplainedMinor === 0 ? <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11px] font-normal text-muted-foreground"><CheckCircle2 className="size-3" aria-hidden />Reconciled</span> : <span className={`inline-flex items-center gap-1 rounded-full border border-amber-500/60 px-2 py-0.5 text-[11px] font-normal ${WARNING}`}><AlertTriangle className="size-3" aria-hidden />{money(Math.abs(netWorthChange.unexplainedMinor))} unexplained</span>}</span>}
          hint={`${money(netWorthChange.openingMinor)} before ${formatDay(summary.period.startDate)} → ${money(netWorthChange.closingMinor)} on ${formatDay(summary.period.endDate)}`}
          subtitle={<><p>Net worth before {formatDay(summary.period.startDate)} was {money(netWorthChange.openingMinor)}; on {formatDay(summary.period.endDate)} it is {money(netWorthChange.closingMinor)}. Only components Bench can identify are shown.</p><p>Select a step with an underlined label to see its transactions.</p></>}
          legend={[{ label: "Raises net worth", colour: "var(--fi-up)" }, { label: "Lowers net worth", colour: "var(--fi-down)" }, { label: "Net change", colour: "var(--fi-balance)" }]}
          table={{ head: ["Step", "Amount"], rows: [["Net worth before the period", netWorthChange.openingMinor], ...steps.filter((s) => s.kind !== "total").map((s) => [s.label, s.amountMinor] as (string | number)[]), ["Net worth at the end", netWorthChange.closingMinor]] }}
          csvScope={[["Period", period]]}
          footnote={netWorthChange.unexplainedMinor === 0 ? "The bars start at zero, showing the change rather than net worth itself. Reconciled: the components add up exactly to the change." : "The bars start at zero, showing the change rather than net worth itself. The dashed bar is what the components do not explain."}
        >
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
