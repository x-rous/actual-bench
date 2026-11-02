"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { downloadCsv } from "@/lib/csv";
import type { DrillTarget } from "@/lib/financial-insights/drill";
import { addMonths, monthLabel } from "@/lib/financial-insights/period";
import { holdings, homeEquity, isFixedAssetAccount, otherOf, portfolioBridge, portfolioMonthly, portfolioSeries, type AccountBridge, type AssetValueRow } from "@/lib/financial-insights/wealth";
import type { FinancialInsightsView } from "../hooks/useFinancialInsights";
import { useWealth } from "../hooks/useWealth";
import { MISSING, money, percent, signedMoney, formatDay } from "../format";
import { PillGroup } from "@/components/ui/pill-group";
import { ASSET_CLASSES, CLASS_LABEL, LIABILITY_CLASSES, classBalances } from "@/lib/financial-insights/breakdowns";
import { CategoryHeatmap, type HeatGroupItem } from "./CategoryHeatmap";
import { ChartFrame } from "./ChartFrame";
import { DrillLink } from "./DrillLink";
import { CardTitle } from "./InfoTip";
import { Tile } from "./Tile";
import { BarChart } from "./charts/BarChart";
import { LineChart } from "./charts/LineChart";
import { CLASS_COLOUR } from "./charts/CompositionChart";
import { monthTip } from "./charts/monthTip";
import { Waterfall, type WaterfallStep } from "./charts/Waterfall";

type Ready = Extract<FinancialInsightsView["data"], { state: "ready" }>;
const WARNING = "text-amber-700 dark:text-amber-400";
const TH = "py-1.5 pr-2 text-right font-medium whitespace-nowrap";
const TD = "py-1.5 pr-2 text-right tabular-nums whitespace-nowrap";
/** "Non-current investment" as "Non-current": the column is headed Treatment, and the full label is in the tooltip. */
const shortTreatment = (label: string) => label.replace(/ (investment|asset|liability)$/i, "");
/** One colour per line, the same in the bridge and in the monthly chart. */
const LINE_COLOUR = { funding: "var(--fi-up)", withdrawals: "var(--fi-gap)", activity: "var(--fi-invest)", opened: "var(--fi-g8)", other: "var(--fi-g10)" } as const;
type Totals = ReturnType<typeof portfolioBridge>["total"];
/** The lines a month's change is made of, as drawn in the Changes view. */
const CHANGE_LINES: { key: string; /** Drawn even when it is zero everywhere; the others only when they have something to show. */ always?: boolean; label: string; colour: string; of: (t: Totals) => number; drill?: "contributed" | "withdrawn" | "investmentResults" }[] = [
  { key: "funding", always: true, label: "Funding", colour: LINE_COLOUR.funding, of: (t) => t.funding, drill: "contributed" },
  { key: "withdrawals", always: true, label: "Withdrawals", colour: LINE_COLOUR.withdrawals, of: (t) => t.withdrawals, drill: "withdrawn" },
  { key: "activity", always: true, label: "Investment activity", colour: LINE_COLOUR.activity, of: (t) => t.activity, drill: "investmentResults" },
  { key: "other", label: "Other", colour: LINE_COLOUR.other, of: (t) => otherOf(t) + t.openingBalances },
];
/** Series colours for the accounts of the portfolio, in the page's group palette. */
const ACCOUNT_COLOURS = ["var(--fi-invest)", "var(--fi-g1)", "var(--fi-g2)", "var(--fi-g0)", "var(--fi-g4)", "var(--fi-g6)", "var(--fi-g9)", "var(--fi-g3)", "var(--fi-g7)", "var(--fi-g5)"];

/** A card around a table: title, hint and (i) beside the title, a CSV of the exact figures, and a note under it. */
function TableCard({ id, title, hint, info, head, rows, csvScope, note, children }: {
  id: string; title: string; hint?: ReactNode; info: ReactNode; head: string[]; rows: (string | number | null)[][]; csvScope: [string, string][]; note?: ReactNode; children: ReactNode;
}) {
  const exportCsv = () => downloadCsv(`financial-insights-${id}.csv`, [["Financial Insights", title], ...csvScope, [], head, ...rows.map((r) => r.map((c) => (c === null ? "unavailable" : typeof c === "number" ? (c / 100).toFixed(2) : c)))]);
  return (
    <section className="flex h-full min-w-0 flex-col rounded-lg border border-border bg-card" aria-label={title}>
      <header className="flex items-start justify-between gap-2 px-4 pt-3">
        <CardTitle title={title} hint={hint} info={info} infoLabel={title} />
        <Button size="xs" variant="ghost" className="text-muted-foreground" onClick={exportCsv} aria-label={`Export ${title} as CSV`}><Download className="size-3.5" aria-hidden />CSV</Button>
      </header>
      <div className="flex-1 overflow-x-auto px-4 py-2">{children}</div>
      {note && <div className="border-t border-border/50 px-4 py-2 text-xs text-muted-foreground">{note}</div>}
    </section>
  );
}

/** A titled group of cards. */
function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <section className="space-y-3" aria-label={title}>
      <div><h2 className="text-sm font-semibold">{title}</h2>{subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}</div>
      {children}
    </section>
  );
}

/** " (+4.6%)" for a change against where it started; nothing when there was nothing to compare with. */
const pctText = (change: number, base: number): string => (base === 0 ? "" : ` (${change > 0 ? "+" : ""}${percent((change / Math.abs(base)) * 100)})`);

/** Wealth & investments: what has been built up, without an invented return. */
export function WealthTab({ data, onDrill }: { data: Ready; onDrill: (target: DrillTarget) => void }) {
  const { ledger, period, summary } = data;
  const scope: [string, string][] = [["Period", `${period.label}: ${formatDay(period.startDate)} to ${formatDay(period.endDate)}`], ["As of", formatDay(period.endDate)]];
  const bridge = useMemo(() => portfolioBridge(ledger, period), [ledger, period]);
  const series = useMemo(() => portfolioSeries(ledger, period), [ledger, period]);
  const own = useMemo(() => holdings(ledger, period), [ledger, period]);
  const wealth = useWealth(data);
  const monthly = useMemo(() => portfolioMonthly(ledger, period), [ledger, period]);
  // The value the period opened with, as its own point before the first month: the first month's end value can differ a lot from it.
  const hasOpening = ledger.firstMonth !== null && ledger.firstMonth <= addMonths(period.startMonth, -1);
  const openingValue = bridge.total.opening;
  const lines = useMemo(() => CHANGE_LINES.filter((l) => l.always || monthly.some((m) => l.of(m) !== 0)), [monthly]);
  const assetRows = wealth.state === "ready" ? wealth.rows : null;
  const hasPortfolio = bridge.accounts.length > 0;
  const hasAssets = [...ledger.account.values()].some(isFixedAssetAccount);
  const t = bridge.total;
  const equity = assetRows ? homeEquity(assetRows) : null;
  const labels = series.months.map((m) => monthLabel(m));
  const partial = period.partial ? labels.length - 1 : null;
  const partialNote = `Partial month: it runs to ${formatDay(period.endDate)}.`;
  const portfolioDrill = (kind: "contributed" | "withdrawn" | "investmentResults"): DrillTarget => ({ kind, portfolio: true });

  // ── The bridge ──
  const steps: WaterfallStep[] = [
    { key: "start", label: "Value at start", kind: "total", amountMinor: t.opening },
    { key: "contributed", label: "Funding", kind: "delta", colour: LINE_COLOUR.funding, amountMinor: t.funding, note: `Money moved in from accounts outside your investments${t.fundingFromExcluded !== 0 ? `, including ${money(t.fundingFromExcluded)} from an excluded account (it is money from outside)` : ""}.` },
    { key: "withdrawn", label: "Withdrawals", kind: "delta", colour: LINE_COLOUR.withdrawals, amountMinor: t.withdrawals, note: "Money moved out to accounts outside your investments." },
    { key: "investmentResults", label: "Investment activity", kind: "delta", colour: LINE_COLOUR.activity, amountMinor: t.activity, note: "Entries with no category in your investment accounts: price changes, dividends, interest and fees as they were recorded. Not a return." },
    ...(t.openingBalances !== 0 ? [{ key: "opened", label: "Accounts opened", kind: "delta" as const, colour: LINE_COLOUR.opened, amountMinor: t.openingBalances, note: "Starting balances of accounts opened in the period." }] : []),
    ...(otherOf(t) !== 0 ? [{ key: "other", label: "Other", kind: "delta" as const, colour: LINE_COLOUR.other, amountMinor: otherOf(t), note: "Transfers between your investment accounts that fall in different months, asset sales, and anything the lines do not explain, such as an entry with a category. Never forced to zero." }] : []),
    { key: "end", label: "Value at end", kind: "total", amountMinor: t.closing },
  ];
  const stepDrill = (key: string): DrillTarget | null => (key === "contributed" || key === "withdrawn" || key === "investmentResults" ? portfolioDrill(key) : null);
  const bridgeRows: (string | number)[][] = steps.map((s) => [s.label, s.amountMinor]);

  // ── The investment accounts ──
  const some = (pick: (a: AccountBridge) => number) => bridge.accounts.some((a) => pick(a) !== 0);
  const showOpened = some((a) => a.openingBalances), showOther = some((a) => otherOf(a));
  const accountHead = ["Account", "Treatment", "Start", "Funding", "Withdrawals", "Investment activity", ...(showOpened ? ["Opened"] : []), ...(showOther ? ["Other"] : []), "End"];
  const accountCsv = [...bridge.accounts.map((a) => [a.name, a.treatment, a.opening, a.funding, a.withdrawals, a.activity, ...(showOpened ? [a.openingBalances] : []), ...(showOther ? [otherOf(a)] : []), a.closing]),
    ["Total", "", t.opening, t.funding, t.withdrawals, t.activity, ...(showOpened ? [t.openingBalances] : []), ...(showOther ? [otherOf(t)] : []), t.closing]];
  const cell = (amount: number, target: DrillTarget | null, label: string, signed = true) => (amount !== 0 && target ? <DrillLink label={`${label} ${signedMoney(amount)}`} onClick={() => onDrill(target)}>{signed ? signedMoney(amount) : money(amount)}</DrillLink> : amount === 0 ? money(0) : signed ? signedMoney(amount) : money(amount));
  const accountRow = (a: AccountBridge) => {
    return (
      <tr key={a.accountId} className="border-b border-border/40">
        <th scope="row" className="max-w-56 py-1.5 pr-2 text-left font-normal whitespace-nowrap"><span className="block truncate" title={a.name}>{a.name}</span></th>
        <td className="pr-2 text-left whitespace-nowrap text-muted-foreground" title={a.treatment}>{shortTreatment(a.treatment)}</td>
        <td className={TD}>{money(a.opening)}</td>
        <td className={TD}>{cell(a.funding, { kind: "contributed", accountId: a.accountId }, `${a.name} funding`)}</td>
        <td className={TD}>{cell(a.withdrawals, { kind: "withdrawn", accountId: a.accountId }, `${a.name} withdrawals`)}</td>
        <td className={TD}>{cell(a.activity, a.offBudget ? { kind: "investmentResults", accountId: a.accountId } : null, `${a.name} investment activity`)}</td>
        {showOpened && <td className={TD}>{signedMoney(a.openingBalances)}</td>}
        {showOther && <td className={`${TD} ${a.unexplained !== 0 ? WARNING : ""}`}>{signedMoney(otherOf(a))}</td>}
        <td className={`${TD} font-medium`}>{money(a.closing)}</td>
      </tr>
    );
  };

  // ── Portfolio value by month ──
  const colourOf = (i: number) => ACCOUNT_COLOURS[i % ACCOUNT_COLOURS.length];

  return (
    <div className="space-y-6 p-4">
      <Section title="Your wealth" subtitle="What you own, what you owe and what is left">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-[repeat(auto-fit,minmax(11rem,1fr))]">
          <Tile label="Net worth" detail={<>{signedMoney(summary.netWorth.change)}{pctText(summary.netWorth.change, summary.netWorth.opening)} during the period<span className="block">Everything you own less everything you owe</span></>}>{money(summary.netWorth.closing)}</Tile>
          <Tile label="Total assets" detail="Everything you own">{money(summary.assets)}</Tile>
          <Tile label="Total liabilities" detail="Everything you owe">{money(summary.liabilities)}</Tile>
          {hasPortfolio && <Tile label="Investments" detail="Value at the end of the period">{money(t.closing)}</Tile>}
          {hasAssets && (
            <Tile label="Property equity" tone={equity?.state === "unavailable" ? "warning" : undefined}
              detail={!equity ? "Reading asset accounts…" : equity.state === "notLinked" ? "No loan is linked to an asset in Assets" : equity.state === "unavailable" ? equity.reason
                : <>Property value less linked loans<span className="block">{equity.ltvPercent !== null ? `Loan-to-value ${percent(equity.ltvPercent)}` : "Loan-to-value unavailable"}</span></>}>
              {!equity ? MISSING : equity.state === "notLinked" ? "Not linked" : equity.state === "unavailable" ? "Unavailable" : money(equity.endMinor)}
            </Tile>
          )}
        </div>
        <WealthOverview data={data} scope={scope} />
      </Section>

      <WealthExplained data={data} onDrill={onDrill} />

      {hasPortfolio && (
        <Section title="Investments" subtitle="What went into and came out of your investment accounts, and what was recorded inside them. Investment activity is not a return.">
        <div className="grid items-stretch gap-4 xl:grid-cols-[minmax(0,11fr)_minmax(0,9fr)]">
          <ChartFrame
            id="portfolio-bridge" title="What changed your investments" hint="Start to end of the period"
            subtitle={<><p>The value of your investment and retirement accounts at the start of the period, one line at a time, to the value at the end.</p><p>Funding and withdrawals are money moved between these accounts and anything outside them. Investment activity and value changes are what was recorded inside. If the lines do not reach the end value, the difference is shown as Unexplained rather than hidden. This is not a return.</p><p>Select a step to see its transactions.</p></>}
            legend={[...steps.filter((x) => x.kind === "delta").map((x) => ({ label: x.label, colour: x.colour ?? "var(--fi-balance)" })), { label: "Value", colour: "var(--fi-balance)" }]}
            table={{ head: ["Step", "Amount"], rows: bridgeRows }} csvScope={scope}
            footnote={t.unexplained === 0 ? "Nothing is left unexplained: the lines add up to the value at the end." : <span className={WARNING}>{money(Math.abs(t.unexplained))} of the change is not explained by the lines. Please review your accounts.</span>}
          >
            <Waterfall steps={steps} height={290} ariaLabel="What changed the value of your investments" canSelect={(s) => stepDrill(s.key) !== null} onSelect={(s) => { const target = stepDrill(s.key); if (target) onDrill(target); }} />
          </ChartFrame>
          <ChartFrame
            id="portfolio-value" title="Portfolio value and changes by month" hint="One scale: the value of the portfolio"
            subtitle={<><p>The line is the value of the portfolio, starting from the opening balance (the value before the period began) and then at each month end. Each month&apos;s bar starts at the value the month opened with: increases (funding, investment activity, value changes) stack above it and decreases (withdrawals) hang below it, so you see which change moved the line, and when. The axis does not start at zero.</p><p>Select a segment to see its transactions.</p></>}
            legend={[...lines.map((l) => ({ label: l.label, colour: l.colour })), { label: "Value at month end", colour: "var(--fi-networth)", line: true }]}
            table={{ head: ["Month", ...lines.map((l) => l.label), "Change", ...series.accounts.map((a) => `${a.name} at end`), "Value at end"], rows: [
              ...(hasOpening ? [["Opening balance", ...lines.map(() => null), null, ...bridge.accounts.filter((a) => series.accounts.some((x) => x.accountId === a.accountId)).map((a) => a.opening), openingValue] as (string | number | null)[]] : []),
              ...series.months.map((m, i) => [labels[i] + (partial === i ? " (partial)" : ""), ...lines.map((l) => l.of(monthly[i])), monthly[i].closing - monthly[i].opening, ...series.accounts.map((a) => a.values[i]), series.totals[i]] as (string | number | null)[]),
            ] }} csvScope={scope}
            footnote={[hasOpening ? `The first point is the opening balance: the value at the end of ${monthLabel(addMonths(period.startMonth, -1))}, before ${formatDay(period.startDate)}.` : "", partial !== null ? `* ${labels[partial]} is partial: it runs to ${formatDay(period.endDate)} and is drawn lighter with a dashed outline.` : ""].filter(Boolean).join(" ") || undefined}
          >
            <BarChart labels={hasOpening ? ["Opening", ...labels] : labels} partialIndex={partial === null ? null : partial + (hasOpening ? 1 : 0)} stacked height={290} ariaLabel="What changed the value of the portfolio in each month, with its value at the opening and at each month end"
              series={lines.map((l) => ({ key: l.key, label: l.label, colour: l.colour, values: [...(hasOpening ? [null] : []), ...monthly.map((m, i) => (series.totals[i] === null ? null : l.of(m)))] }))}
              base={[...(hasOpening ? [null] : []), ...monthly.map((m, i) => (series.totals[i] === null ? null : m.opening))]}
              overlay={{ label: "Value at month end", colour: "var(--fi-networth)", values: [...(hasOpening ? [openingValue] : []), ...series.totals] }}
              tip={(at) => {
                if (hasOpening && at === 0) {
                  return monthTip({
                    title: "Opening balance", partial: false, partialNote: "",
                    rows: [...(bridge.accounts.length > 1 ? bridge.accounts.filter((a) => a.opening !== 0).map((a) => ({ name: a.name, value: money(a.opening) })) : []), { name: <span className="font-semibold">Value at the start</span>, value: <span className="font-semibold">{money(openingValue)}</span> }],
                  });
                }
                const i = at - (hasOpening ? 1 : 0);
                return monthTip({
                  title: labels[i], partial: i === partial, partialNote,
                  rows: [...lines.map((l) => ({ colour: l.colour, name: l.label, value: signedMoney(l.of(monthly[i])) })), { name: <span className="font-semibold">Change in the month</span>, value: <span className="font-semibold">{signedMoney(monthly[i].closing - monthly[i].opening)}</span> }, ...(series.accounts.length > 1 ? series.accounts.map((a, k) => ({ colour: colourOf(k), name: `${a.name} at the end`, value: money(a.values[i]) })) : []), { name: <span className="font-semibold">Value at the end</span>, value: <span className="font-semibold">{money(monthly[i].closing)}</span> }],
                });
              }}
              onSelect={(at, k) => { const i = at - (hasOpening ? 1 : 0); const line = lines[k]; if (i >= 0 && line?.drill) onDrill({ kind: line.drill, portfolio: true, month: series.months[i] }); }} />
          </ChartFrame>
        </div>
        <TableCard id="investment-accounts" title="Investment accounts" hint="Account by account, same lines as the bridge" csvScope={scope}
          info={<><p>Each investment and retirement account from its value at the start of the period to its value at the end. Funding and withdrawals are transfers with accounts outside your investments; investment activity is what was recorded inside without a category.</p><p>Moves between two of your investment accounts have their own column and cancel in the total. Select a figure to see its transactions.</p></>}
          head={accountHead} rows={accountCsv} note="The totals row equals the bridge.">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-border text-muted-foreground">
                <th scope="col" className="py-1.5 pr-2 text-left font-medium">Account</th><th scope="col" className="pr-2 text-left font-medium">Treatment</th>
                {accountHead.slice(2).map((h) => <th key={h} scope="col" className={TH}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {bridge.accounts.map(accountRow)}
              <tr className="font-semibold">
                <th scope="row" className="py-1.5 pr-2 text-left">Total</th><td />
                <td className={TD}>{money(t.opening)}</td>
                <td className={TD}>{cell(t.funding, portfolioDrill("contributed"), "Total funding")}</td>
                <td className={TD}>{cell(t.withdrawals, portfolioDrill("withdrawn"), "Total withdrawals")}</td>
                <td className={TD}>{cell(t.activity, portfolioDrill("investmentResults"), "Total investment activity")}</td>
                {showOpened && <td className={TD}>{signedMoney(t.openingBalances)}</td>}
                {showOther && <td className={`${TD} ${t.unexplained !== 0 ? WARNING : ""}`}>{signedMoney(otherOf(t))}</td>}
                <td className={TD}>{money(t.closing)}</td>
              </tr>
            </tbody>
          </table>
        </TableCard>
        </Section>
      )}

      <Section title="Property, other assets and account details" subtitle="Valuations, capital added, equity and every account">
        {hasAssets && <AssetValues rows={assetRows} wealth={wealth} scope={scope} />}
              <WhatYouOwnAndOwe own={own} />
      </Section>
    </div>
  );
}

const assetHead = ["Asset", "Start", "Capital added", "Revaluation", "Depreciation", "Disposal", "Other", "End", "Equity", "Loan-to-value"];

/** Property, vehicles and other assets: the Asset Registry's value bridge, with equity and loan-to-value where loans are linked. */
function AssetValues({ rows, wealth, scope }: { rows: AssetValueRow[] | null; wealth: ReturnType<typeof useWealth>; scope: [string, string][] }) {
  const csv = (rows ?? []).map((r) => (r.kind === "registered" && r.state === "ready"
    ? [r.name, r.bridge.openingMinor, r.bridge.capitalMinor, r.bridge.revaluationMinor, r.bridge.depreciationMinor, r.bridge.disposalMinor, r.bridge.otherMinor, r.bridge.closingMinor, r.equity.end.equityMinor, r.equity.end.ltvPercent === null ? null : `${r.equity.end.ltvPercent}%`]
    : [r.name, r.kind === "unregistered" ? r.openingMinor : r.openingMinor, null, null, null, null, null, r.closingMinor, null, null]));
  const missing = (rows ?? []).filter((r) => r.kind === "unregistered" || r.state === "unavailable");
  return (
    <TableCard id="asset-values" title="Property and asset values" hint="Property, vehicles and other assets" csvScope={scope} head={assetHead} rows={csv}
      info={<><p>How each asset registered in Assets moved from its value at the start of the period to its value at the end, from the Asset Registry&apos;s own classified entries: the same figures as the Assets page for the same dates.</p><p>Equity is the recorded value less the linked loan balance in Actual on that date; loan-to-value is that debt as a share of the value. Either is Unavailable, never zero, when an input is missing. Assets with no linked loan say Not linked.</p></>}
      note={missing.length > 0 ? <p className={WARNING}>{missing.length} {missing.length === 1 ? "account needs" : "accounts need"} review: their closing value is shown, but what depends on the Asset Registry is not. <Link href="/assets" className="underline underline-offset-2">Open Assets</Link></p> : "Registered assets only. Linked loans come from Assets; the loan balances are Actual's."}>
      {wealth.state === "loading" ? <p className="py-3 text-xs text-muted-foreground" role="status">Reading asset accounts…</p>
        : wealth.state === "error" ? <div className="py-3 text-xs"><p className={WARNING}>The loans linked to your assets could not be read.</p><Button size="xs" variant="outline" className="mt-2" onClick={wealth.retry}>Retry</Button></div>
        : (
          <table className="w-full border-collapse text-xs">
            <thead><tr className="border-b border-border text-muted-foreground"><th scope="col" className="py-1.5 pr-2 text-left font-medium">Asset</th>{assetHead.slice(1).map((h) => <th key={h} scope="col" className={TH}>{h}</th>)}</tr></thead>
            <tbody>
              {(rows ?? []).map((r) => {
                const name = <th scope="row" className="max-w-56 py-1.5 pr-2 text-left font-normal whitespace-nowrap"><span className="block truncate" title={r.name}>{r.name}</span></th>;
                if (r.kind === "unregistered") {
                  return <tr key={r.accountId} className="border-b border-border/40">{name}<td className={TD}>{money(r.openingMinor)}</td><td colSpan={6} className={`pr-2 text-left ${WARNING}`}>Not in the Asset Registry · Needs review</td><td className={`${TD} font-medium`}>{money(r.closingMinor)}</td><td className="pr-2 text-right text-muted-foreground">{MISSING}</td><td className="pr-2 text-right text-muted-foreground">{MISSING}</td></tr>;
                }
                if (r.state === "unavailable") {
                  return <tr key={r.assetId} className="border-b border-border/40">{name}<td className={TD}>{money(r.openingMinor)}</td><td colSpan={6} className={`pr-2 text-left ${WARNING}`} title={r.reason}>Needs review · {r.reason}</td><td className={`${TD} font-medium`}>{money(r.closingMinor)}</td><td className="pr-2 text-right text-muted-foreground">{MISSING}</td><td className="pr-2 text-right text-muted-foreground">{MISSING}</td></tr>;
                }
                const b = r.bridge, e = r.equity.end;
                const equityCell = !r.linked ? <span className="text-muted-foreground">Not linked</span> : e.equityMinor === null ? <span className={WARNING} title={e.gaps.join(". ")}>Unavailable</span>
                  : <span title={r.equity.start.equityMinor !== null ? `Equity at the start: ${money(r.equity.start.equityMinor)}` : undefined}>{money(e.equityMinor)}</span>;
                const ltvCell = !r.linked ? <span className="text-muted-foreground">{MISSING}</span> : e.ltvPercent === null ? <span className={WARNING}>Unavailable</span> : <>{percent(e.ltvPercent)}</>;
                const signed = (v: number) => (v === 0 ? money(0) : signedMoney(v));
                return (
                  <tr key={r.assetId} className="border-b border-border/40">
                    {name}<td className={TD}>{money(b.openingMinor)}</td><td className={TD}>{signed(b.capitalMinor)}</td><td className={TD}>{signed(b.revaluationMinor)}</td><td className={TD}>{signed(b.depreciationMinor)}</td><td className={TD}>{signed(b.disposalMinor)}</td><td className={TD}>{signed(b.otherMinor)}</td>
                    <td className={`${TD} font-medium`}>{money(b.closingMinor)}</td><td className={TD}>{equityCell}</td><td className={TD}>{ltvCell}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
    </TableCard>
  );
}

type OwnData = { treatment: string; startMinor: number; changeMinor: number };

/** Every counted account grouped by class, at the start and end of the period. The grouped-row grid is the Spending heatmap's. */
function WhatYouOwnAndOwe({ own }: { own: ReturnType<typeof holdings> }) {
  const groups: HeatGroupItem<OwnData>[] = own.groups.map((g, gi) => ({
    key: g.key, name: g.label, totalMinor: g.closingMinor, order: gi, colour: CLASS_COLOUR[g.key],
    data: { treatment: "", startMinor: g.openingMinor, changeMinor: g.changeMinor },
    rows: g.rows.map((r, ri) => ({ key: r.accountId, name: r.name, totalMinor: r.closingMinor, order: ri, data: { treatment: r.treatment, startMinor: r.openingMinor, changeMinor: r.changeMinor } })),
  }));
  const months = [{ key: "treatment", label: "Treatment", partial: false }, { key: "start", label: "Start", partial: false }, { key: "change", label: "Change", partial: false }];
  return (
    <CategoryHeatmap<OwnData>
      id="own-and-owe" title="All accounts" hint="Everything you own and owe, by class, start and end of the period" infoLabel="all accounts"
      info={<><p>Every account Financial Insights counts, grouped by class, with its balance at the start and the end of the period. What you owe is shown once, as a negative.</p><p>The end balances add up to your net worth on the Summary tab.</p></>}
      legend={<span>Select a class to see its accounts.</span>} months={months} groups={groups} totalLabel="End" firstColumnLabel="Class and account" sortLabel="Balance" orderLabel="Class order" formatTotal={money} initiallyOpen
      renderCell={(item, i) => {
        const d = item.data as OwnData;
        if (i === 0) return <td className="px-2 py-0.5 text-left whitespace-nowrap text-muted-foreground">{d.treatment}</td>;
        if (i === 1) return <td className="px-2 py-0.5 text-right tabular-nums whitespace-nowrap">{money(d.startMinor)}</td>;
        return <td className="px-2 py-0.5 text-right tabular-nums whitespace-nowrap">{signedMoney(d.changeMinor)}</td>;
      }}
      footer={`Net worth ${money(own.netWorth.closingMinor)} at the end (${money(own.netWorth.openingMinor)} at the start): the same figure as the Summary tab.`}
    />
  );
}

type Look = "line" | "bars" | "table";

/** Your wealth over time, and where it is held: the Summary's own series and classes, drawn for this tab. */
function WealthOverview({ data, scope }: { data: Ready; scope: [string, string][] }) {
  const { composition, summary, period } = data;
  const [look, setLook] = useState<Look>("line");
  const labels = composition.months.map((m) => monthLabel(m.month));
  const partial = period.partial ? labels.length - 1 : null;
  // Today's balance is a valid balance, only not a month-end one, so it is labelled as today and drawn like any other.
  const [, endMonthNo, endDay] = period.endDate.split("-");
  const todayLabel = `Today (${Number(endDay)} ${monthLabel(`${period.endDate.slice(0, 4)}-${endMonthNo}`).slice(0, 3)})`;
  const shown = labels.map((l, i) => (i === partial ? todayLabel : l));
  // Months in which money was borrowed: assets and debts rise together, which is not an increase in wealth.
  const borrowed = data.monthly.flatMap((m, i) => (m.borrowed > 0 ? [{ index: i, amount: m.borrowed }] : []));
  const owned = composition.months.map((m) => ASSET_CLASSES.reduce((a, k) => a + m[k], 0));
  // What is owed is drawn as a positive amount, as on the Summary tiles.
  const owed = composition.months.map((m) => 0 - LIABILITY_CLASSES.reduce((a, k) => a + m[k], 0));
  const series = [
    { key: "net", label: "Net worth", colour: "var(--fi-networth)", values: composition.netWorth as (number | null)[], primary: true },
    { key: "owned", label: "Everything owned", colour: "var(--fi-invest)", values: owned as (number | null)[] },
    { key: "owed", label: "Debts", colour: "var(--fi-loan)", values: owed as (number | null)[] },
  ];
  const tip = (i: number) => monthTip({
    title: shown[i], partial: false, partialNote: "",
    rows: [...series.map((s) => ({ colour: s.colour, name: s.label, value: money(s.values[i]) })), ...(data.monthly[i]?.borrowed ? [{ name: "◆ Borrowed that month", value: money(data.monthly[i].borrowed) }] : [])],
    compare: { values: composition.netWorth, index: i, label: "net worth" },
  });
  const table = { head: ["Month", "Net worth", "Everything owned", "Debts"], rows: shown.map((l, i) => [l, composition.netWorth[i], owned[i], owed[i]]) };

  const end = classBalances(summary.closing);
  const classes = ASSET_CLASSES.filter((k) => end[k] !== 0);
  const assets = summary.assets;
  const share = (v: number) => (assets > 0 ? (v / assets) * 100 : null);

  return (
    <div className="grid items-stretch gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(20rem,2fr)]">
      <ChartFrame
        id="wealth-over-time" title="Your wealth over time" hint="The total, the assets behind it and the debts deducted"
        subtitle={<><p>Net worth is everything you own less everything you owe, measured at each month end, as on the Summary tab. Debts are drawn as a positive amount.</p></>}
        legend={look === "table" ? undefined : series.map((s) => ({ label: s.label, colour: s.colour, dot: look === "line" }))}
        table={table} tableShown={look === "table"} csvScope={scope}
        actions={<PillGroup options={[{ value: "line", label: "Line" }, { value: "bars", label: "Bars" }, { value: "table", label: "Table" }]} value={look} onChange={(v) => setLook(v as Look)} />}
        footnote={[partial !== null ? `${todayLabel} is the balance today: a valid balance, only not a month-end one.` : "", ...borrowed.map((b) => `◆ ${labels[b.index]}: ${money(b.amount)} borrowed from loans. Assets and debts rise together, so this is not an increase in wealth.`)].filter(Boolean).join(" ") || undefined}
      >
        {look === "line" ? <LineChart labels={shown} partialIndex={null} annotations={borrowed.map((b) => ({ index: b.index, text: `Borrowed ${money(b.amount)}: assets and debts rise together` }))} series={series} height={290} ariaLabel="Net worth, everything owned and debts at each month end" tip={tip} />
          : look === "bars" ? <BarChart labels={shown} partialIndex={null} height={290} ariaLabel="Net worth, everything owned and debts at each month end" series={series} tip={(i) => tip(i)} />
          : (
            <div className="max-h-[22rem] overflow-auto">
              <table className="w-full border-collapse text-xs">
                <thead><tr className="border-b border-border text-muted-foreground">{table.head.map((h, i) => <th key={h} scope="col" className={i === 0 ? "py-1 text-left font-medium" : "py-1 text-right font-medium"}>{h}</th>)}</tr></thead>
                <tbody>{table.rows.map((r, ri) => <tr key={ri} className="border-b border-border/40"><th scope="row" className="py-1 text-left font-normal">{r[0]}</th>{r.slice(1).map((c, ci) => <td key={ci} className="text-right tabular-nums">{money(c as number)}</td>)}</tr>)}</tbody>
              </table>
            </div>
          )}
      </ChartFrame>

      <section className="flex h-full min-w-0 flex-col rounded-lg border border-border bg-card p-4" aria-label="Where your assets are held">
        <CardTitle title="Where your assets are held" hint="By account class, at the end of the period" infoLabel="where your assets are held"
          info={<><p>What you own at the end of the period, by the classes set on the Accounts page, with each class as a share of everything owned. Debts are deducted once, in total.</p></>} />
        <ul className="mt-3 space-y-3">
          {classes.map((k) => {
            const pct = share(end[k]);
            return (
              <li key={k}>
                <div className="flex items-baseline justify-between gap-3 text-xs"><span>{CLASS_LABEL[k]}</span><span className="font-semibold tabular-nums">{money(end[k])} <span className="font-normal text-muted-foreground">{pct === null ? MISSING : percent(pct)}</span></span></div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted" role="img" aria-label={`${CLASS_LABEL[k]} ${pct === null ? "" : percent(pct)} of everything owned`}><div className="h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, pct ?? 0))}%`, background: CLASS_COLOUR[k] }} /></div>
              </li>
            );
          })}
        </ul>
        <dl className="mt-4 space-y-2 border-t border-border pt-3 text-xs">
          <div className="flex items-baseline justify-between gap-3"><dt className="font-semibold">All assets</dt><dd className="font-semibold tabular-nums">{money(assets)}</dd></div>
          <div className="flex items-baseline justify-between gap-3"><dt className="font-semibold">Less: all debt</dt><dd className="font-semibold tabular-nums">{money(0 - summary.liabilities)}</dd></div>
          <div className="flex items-baseline justify-between gap-3"><dt className="font-semibold">Net worth</dt><dd className="text-sm font-semibold tabular-nums">{money(summary.netWorth.closing)}</dd></div>
        </dl>
      </section>
    </div>
  );
}

const STEP_LABEL: Record<string, string> = { kept: "Money kept", investmentResults: "Investment activity", valueChange: "Changes in value" };

/** Where the change in net worth came from, split into what added value and what only moved money around. The Summary's own steps and cash bridge. */
function WealthExplained({ data, onDrill }: { data: Ready; onDrill: (target: DrillTarget) => void }) {
  const { summary, netWorthChange: change } = data;
  const step = (key: string) => change.steps.find((x) => x.key === key)?.amountMinor ?? 0;
  const valueChanges = step("investmentResults") + step("valueChange") + step("assetSale");
  const bridge = summary.cashBridge;
  const link = (amount: number, target: DrillTarget | null, label: string, signed: boolean) => {
    const text = signed ? signedMoney(amount) : money(amount);
    return target && amount !== 0 ? <DrillLink label={`${label} ${text}`} onClick={() => onDrill(target)}>{text}</DrillLink> : text;
  };
  const added = change.steps.filter((x) => ["kept", "investmentResults", "valueChange", "assetSale", "unidentified", "opening"].includes(x.key));
  const moved: { key: string; label: string; note: string; amount: number; target: DrillTarget | null }[] = [
    { key: "contributed", label: "Put into investments", note: "Transfer, not spending", amount: 0 - bridge.investmentOut, target: { kind: "contributed" } },
    { key: "withdrawn", label: "Withdrawn from investments", note: "Transfer, not income", amount: bridge.investmentIn, target: { kind: "withdrawn" } },
    { key: "repaid", label: "Loan principal paid", note: "Cash and debt both fall", amount: 0 - bridge.loanOut, target: { kind: "repaid" } },
    ...(bridge.loanIn !== 0 ? [{ key: "borrowed", label: "Borrowed from loans", note: "Cash and debt both rise", amount: bridge.loanIn, target: { kind: "borrowed" } as DrillTarget }] : []),
    ...[["excluded", "Transfers with excluded accounts", "excludedTransfer"], ["inTransit", "In transit", "inTransit"]].flatMap(([key, label, kind]) => (step(key) !== 0 ? [{ key, label, note: key === "excluded" ? "Change net worth, not income or spending" : "One side not recorded in the period", amount: step(key), target: (kind === "inTransit" ? { kind: "inTransit", cashOnly: false } : { kind }) as DrillTarget }] : [])),
  ];
  const tiles: { label: string; value: string; detail: string }[] = [
    { label: "Starting net worth", value: money(change.openingMinor), detail: `Before ${formatDay(summary.period.startDate)}` },
    { label: "Money kept", value: signedMoney(step("kept")), detail: "Income minus spending" },
    { label: "Value changes", value: signedMoney(valueChanges), detail: "Investment activity + changes in value" },
    { label: "Ending net worth", value: money(change.closingMinor), detail: `On ${formatDay(summary.period.endDate)}` },
  ];
  return (
    <section className="space-y-3" aria-label="What changed your net worth">
      <div><h2 className="text-sm font-semibold">What changed your net worth</h2><p className="text-xs text-muted-foreground">Every component ties back to the change in net worth</p></div>
      <div className="rounded-lg border border-border bg-card">
        <div className="px-4 pt-3"><CardTitle title="Your wealth, explained" hint="No double-counting of principal payments or transfers" infoLabel="your wealth, explained" info={<p>The same components as What changed your net worth on the Summary tab, split into what added value and what only moved money between your accounts. Moving money is never counted as income, spending or a change in value.</p>} /></div>
        <div className="grid gap-3 px-4 pt-3 sm:grid-cols-2 xl:grid-cols-4">
          {tiles.map((t) => <Tile key={t.label} label={t.label} detail={t.detail}>{t.value}</Tile>)}
        </div>
        <div className="grid gap-4 p-4 xl:grid-cols-2">
          <div className="rounded-md border border-border bg-muted/30 p-4">
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">What changed your wealth</h3>
            <dl className="mt-2 divide-y divide-border/50 text-xs">
              {added.map((x) => (
                <div key={x.key} className="flex items-baseline justify-between gap-4 py-2"><dt><span className="font-medium">{STEP_LABEL[x.key] ?? x.label}</span><span className="block text-muted-foreground">{x.note}</span></dt><dd className="text-sm font-semibold tabular-nums">{link(x.amountMinor, x.drill && x.drill !== "inTransit" ? { kind: x.drill } : null, x.label, true)}</dd></div>
              ))}
            </dl>
          </div>
          <div className="rounded-md border border-border bg-muted/30 p-4">
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">What moved money around</h3>
            <dl className="mt-2 divide-y divide-border/50 text-xs">
              {moved.map((x) => (
                <div key={x.key} className="flex items-baseline justify-between gap-4 py-2"><dt><span className="font-medium">{x.label}</span><span className="block text-muted-foreground">{x.note}</span></dt><dd className="text-sm font-semibold tabular-nums">{link(x.amount, x.target, x.label, false)}</dd></div>
              ))}
              {change.unexplainedMinor !== 0 && <div className={`flex items-baseline justify-between gap-4 py-2 ${WARNING}`}><dt><span className="font-medium">Unexplained difference</span><span className="block text-muted-foreground">Not explained by the components; never forced to zero</span></dt><dd className="text-sm font-semibold tabular-nums">{money(change.unexplainedMinor)}</dd></div>}
            </dl>
          </div>
        </div>
        <p className="border-t border-border/50 px-4 py-2 text-xs text-muted-foreground">Investment activity is what was recorded in your investment accounts without a category; it is not a return, and an unexplained difference is never labelled as one.</p>
      </div>
    </section>
  );
}
