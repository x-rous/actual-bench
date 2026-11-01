"use client";

import { AlertTriangle } from "lucide-react";
import type { Status } from "@/lib/financial-insights/measures";
import type { ReviewEntry } from "@/lib/financial-insights/assetReview";
import { monthLabel } from "@/lib/financial-insights/period";
import type { FinancialInsightsView } from "../hooks/useFinancialInsights";
import { money, percent, signedMoney } from "../format";
import { ChartCard } from "./ChartCard";
import { cn } from "@/lib/utils";

type Ready = Extract<FinancialInsightsView["data"], { state: "ready" }>;

const CHART_COLORS = ["var(--chart-1)", "var(--chart-2)"];
const WARNING = "text-amber-700 dark:text-amber-400";

/** A figure that may be unavailable or need review: the number when ready, never a silent zero. */
function statusText<T>(status: Status<T>, format: (value: T) => string): { text: string; detail?: string; tone?: "warning" } {
  if (status.state === "ready") return { text: format(status.value) };
  return { text: status.state === "needsReview" ? "Needs review" : "Unavailable", detail: status.reason, tone: "warning" };
}

function Tile({ label, value, detail, tone, hint }: { label: string; value: string; detail?: string; tone?: "warning"; hint?: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-border bg-card px-4 py-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("mt-0.5 text-xl font-semibold tabular-nums", tone === "warning" && WARNING)} title={hint}>{value}</p>
      {detail && <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground" title={hint ?? detail}>{detail}</p>}
    </div>
  );
}

function CashBuffer({ buffer, today }: { buffer: Ready["buffer"]; today: string }) {
  return (
    <section className="flex min-w-0 flex-col self-start rounded-lg border border-border bg-card p-4" aria-label="Your cash buffer">
      <h2 className="text-sm font-semibold">Your cash buffer</h2>
      <p className="text-xs text-muted-foreground">Current · as of {today}, whatever period is selected</p>
      {buffer.state === "ready" ? (
        <>
          <p className="mt-3 text-3xl font-semibold tabular-nums">{buffer.value.months.toFixed(1)} <span className="text-base font-normal text-muted-foreground">months</span></p>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted" role="img" aria-label={`${buffer.value.months.toFixed(1)} months on a scale of 0 to 12`}>
            <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, (buffer.value.months / 12) * 100)}%` }} />
          </div>
          <p className="mt-1 text-xs text-muted-foreground">Scale 0–12 months. This is not a recommended target.</p>
          <dl className="mt-3 space-y-1 text-xs">
            <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Cash & bank today</dt><dd className="tabular-nums">{money(buffer.value.cashMinor)}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Spending per month (last {buffer.value.spendingMonths} complete, without loan interest)</dt><dd className="tabular-nums">{money(buffer.value.spendingMinor)}</dd></div>
            {buffer.value.loans.map((loan) => (
              <div key={loan.accountId} className="flex justify-between gap-3">
                <dt className="truncate text-muted-foreground">{loan.name} ({loan.source === "schedule" ? "scheduled repayment, principal + interest" : "recorded repayments, principal only"})</dt>
                <dd className="tabular-nums">{money(loan.monthlyMinor)}</dd>
              </div>
            ))}
            <div className="flex justify-between gap-3 border-t border-border pt-1 font-medium"><dt>Needed per month</dt><dd className="tabular-nums">{money(buffer.value.monthlyNeedMinor)}</dd></div>
          </dl>
          <p className="mt-2 text-xs text-muted-foreground">Investments and fixed deposits are not counted as cash. Card payments and loan interest are not counted twice.</p>
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

function WealthSits({ summary }: { summary: Ready["summary"] }) {
  const c = summary.closing;
  const lines = [
    { label: "Cash & bank", value: c.eligibleCash },
    { label: "Fixed / restricted deposits", value: c.fixedDeposits },
    { label: "Investments & retirement", value: c.investments },
    { label: "Property", value: c.property },
    { label: "Vehicles", value: c.vehicle },
    { label: "Other assets", value: c.otherAssets },
  ].filter((l) => l.value !== 0 || l.label === "Cash & bank");
  const base = Math.max(1, summary.assets);
  return (
    <section className="min-w-0 rounded-lg border border-border bg-card p-4" aria-label="Where your wealth sits">
      <h2 className="text-sm font-semibold">Where your wealth sits</h2>
      <p className="text-xs text-muted-foreground">As of {summary.period.endDate}. Cash is not the same as investments or property.</p>
      <ul className="mt-3 space-y-2.5">
        {lines.map((l) => (
          <li key={l.label}>
            <div className="flex justify-between gap-3 text-xs"><span>{l.label}</span><span className="tabular-nums">{money(l.value)}</span></div>
            <div className="mt-1 h-2 rounded-full bg-muted" aria-hidden><div className="h-full rounded-full bg-primary/70" style={{ width: `${Math.max(0, Math.min(100, (l.value / base) * 100))}%` }} /></div>
          </li>
        ))}
      </ul>
      <dl className="mt-3 space-y-1 border-t border-border pt-2 text-xs">
        <div className="flex justify-between"><dt className="text-muted-foreground">Everything you own</dt><dd className="tabular-nums">{money(summary.assets)}</dd></div>
        <div className="flex justify-between"><dt className="text-muted-foreground">Less: loans, cards and other liabilities</dt><dd className="tabular-nums">{money(-summary.liabilities)}</dd></div>
        <div className="flex justify-between font-medium"><dt>Net worth</dt><dd className="tabular-nums">{money(summary.netWorth.closing)}</dd></div>
      </dl>
    </section>
  );
}

function ThreeNumbers({ summary }: { summary: Ready["summary"] }) {
  const kept = statusText(summary.moneyKept, money);
  const inTransit = summary.cashBridge.inTransit;
  return (
    <section className="min-w-0 rounded-lg border border-border bg-card p-4" aria-label="Three different measures">
      <h2 className="text-sm font-semibold">Three measures that are easy to confuse</h2>
      <p className="text-xs text-muted-foreground">{summary.period.label} · {summary.period.startDate} – {summary.period.endDate}</p>
      <dl className="mt-3 space-y-3 text-xs">
        <div>
          <dt className="font-medium">1 · Kept from income <span className="font-normal text-muted-foreground">(income − spending)</span></dt>
          <dd className={cn("text-lg font-semibold tabular-nums", kept.tone && WARNING)}>{kept.text}</dd>
          <dd className="text-muted-foreground">Moving money into investments or paying off a loan is not spending.</dd>
        </div>
        <div>
          <dt className="font-medium">2 · Change in cash <span className="font-normal text-muted-foreground">(cash & bank, end − start)</span></dt>
          <dd className="text-lg font-semibold tabular-nums">{signedMoney(summary.eligibleCash.change)}</dd>
          <dd className="text-muted-foreground">After investments, card payments and loan principal. It can fall even when you saved.{inTransit !== 0 && ` Includes ${money(inTransit)} in transit: a transfer with only one side recorded up to today, or whose other side falls outside this period.`}</dd>
        </div>
        <div>
          <dt className="font-medium">3 · Change in wealth <span className="font-normal text-muted-foreground">(net worth, end − start)</span></dt>
          <dd className="text-lg font-semibold tabular-nums">{signedMoney(summary.netWorth.change)}</dd>
          <dd className="text-muted-foreground">Includes what you kept plus changes in the value of investments and property.</dd>
        </div>
        {summary.flows.unidentifiedCount > 0 && (
          <div>
            <dt className="font-medium">Unidentified movements <span className="font-normal text-muted-foreground">({summary.flows.unidentifiedCount} {summary.flows.unidentifiedCount === 1 ? "entry" : "entries"})</span></dt>
            <dd className="text-lg font-semibold tabular-nums">{signedMoney(summary.flows.unidentified)}</dd>
            <dd className="text-muted-foreground">Entries with no category in off-budget accounts. They change your net worth but are not counted as income or spending.</dd>
          </div>
        )}
        {summary.flows.excludedTransfers !== 0 && (
          <div>
            <dt className="font-medium">Transfers with excluded accounts</dt>
            <dd className="text-lg font-semibold tabular-nums">{signedMoney(summary.flows.excludedTransfers)}</dd>
            <dd className="text-muted-foreground">Money moved to or from accounts you excluded. It changes your net worth but is not counted as income or spending.</dd>
          </div>
        )}
        {summary.unexplained !== 0 && (
          <div className={WARNING}><dt className="font-medium">Unexplained difference</dt><dd className="tabular-nums">{money(summary.unexplained)}. Some entries could not be placed; please review your accounts.</dd></div>
        )}
      </dl>
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
              <tr key={r.id} className="border-b border-border/40"><td className="py-1 pr-3 tabular-nums">{r.date}</td><td className="pr-3">{names.get(r.accountId) ?? r.accountId}</td><td className="pr-3 text-right tabular-nums">{money(r.amountMinor)}</td><td className="text-muted-foreground">{r.reason}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

export function SummaryTab({ data, today, accountNames }: { data: Ready; today: string; accountNames: ReadonlyMap<string, string> }) {
  const { summary, buffer, review } = data;
  const kept = statusText(summary.moneyKept, money);
  const rate = statusText(summary.savingsRate, percent);
  const months = summary.period.months.length;
  const points = summary.series.map((p) => ({ label: monthLabel(p.month), partial: p.partial, values: [p.netWorthMinor, p.cashMinor] }));
  const scope: [string, string][] = [["Period", `${summary.period.label}: ${summary.period.startDate} to ${summary.period.endDate}`], ["As of", summary.period.endDate]];

  const lead = (
    <div className="flex flex-wrap items-end justify-between gap-6 px-4 pt-4">
      <div>
        <p className="text-xs text-muted-foreground">Your net worth · as of {summary.period.endDate}</p>
        <p className="text-4xl font-semibold tabular-nums">{money(summary.netWorth.closing)}</p>
        <p className="text-sm tabular-nums"><span className="font-medium">{signedMoney(summary.netWorth.change)}</span><span className="text-muted-foreground"> over {months} {months === 1 ? "month" : "months"}</span></p>
      </div>
      <dl className="flex gap-8 text-xs">
        <div><dt className="text-muted-foreground">Everything you own</dt><dd className="text-base font-semibold tabular-nums">{money(summary.assets)}</dd></div>
        <div><dt className="text-muted-foreground">Everything you owe</dt><dd className="text-base font-semibold tabular-nums">{money(summary.liabilities)}</dd></div>
      </dl>
    </div>
  );

  return (
    <div className="space-y-4 p-4">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(20rem,1fr)]">
        <ChartCard
          id="journey" title="Your financial journey" subtitle="Net worth and cash & bank at each month end, on one scale" lead={lead}
          series={[{ label: "Net worth", color: CHART_COLORS[0] }, { label: "Cash & bank", color: CHART_COLORS[1] }]} points={points} csvScope={scope}
          footnote="Balances are measured at each month end. Cash & bank excludes investments and fixed / restricted deposits. A partial month runs to today."
        />
        <CashBuffer buffer={buffer} today={today} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Tile label="Money received" value={money(summary.received)} detail="Income in the period" />
        <Tile label="Money spent" value={money(summary.spent)} detail="Includes card purchases once and recorded interest" />
        <Tile label="Money kept" value={kept.text} tone={kept.tone} detail={kept.detail ?? `Savings rate ${rate.text}`} hint={kept.detail} />
        <Tile label="Invested money" value={money(summary.invested)} detail="Investments and retirement, at the end of the period" />
      </div>
      <ReviewList rows={review} names={accountNames} />
      <div className="grid gap-4 xl:grid-cols-2">
        <WealthSits summary={summary} />
        <ThreeNumbers summary={summary} />
      </div>
      {(summary.flows.uncategorizedIn !== 0 || summary.flows.uncategorizedOut !== 0) && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><AlertTriangle className="size-3.5" aria-hidden />
          Includes on-budget entries with no category, by sign: {money(summary.flows.uncategorizedIn)} in and {money(-summary.flows.uncategorizedOut)} out.
        </p>
      )}
    </div>
  );
}
