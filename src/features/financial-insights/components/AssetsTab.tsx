"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { GRANULARITY_NAME, balanceBuckets, endsEarly, lastIndex } from "@/lib/financial-insights/buckets";
import { debtAccounts } from "@/lib/financial-insights/debt";
import { addMonths, monthLabel } from "@/lib/financial-insights/period";
import { homeEquity, isFixedAssetAccount, type AssetSeries, type AssetValueRow } from "@/lib/financial-insights/wealth";
import type { FinancialInsightsView } from "../hooks/useFinancialInsights";
import { useGranularity } from "../hooks/useGranularity";
import { useWealth } from "../hooks/useWealth";
import { UnitPills } from "./UnitPills";
import { MISSING, money, percent, signedMoney, formatDay } from "../format";
import { CLASS_COLOUR } from "./charts/CompositionChart";
import { ChartFrame } from "./ChartFrame";
import { TableCard, TD, TH } from "./TableCard";
import { CardTitle } from "./InfoTip";
import { Tile } from "./Tile";
import { LineChart } from "./charts/LineChart";
import { monthTip } from "./charts/monthTip";
import { Waterfall, type WaterfallStep } from "./charts/Waterfall";

type Ready = Extract<FinancialInsightsView["data"], { state: "ready" }>;
type Registered = Extract<AssetValueRow, { kind: "registered" }>;
const WARNING = "text-amber-700 dark:text-amber-400";
const CLASS_KEY = { property: "property", vehicle: "vehicle", "other-asset": "other" } as const;
const colourOf = (row: AssetValueRow) => CLASS_COLOUR[CLASS_KEY[row.accountClass as keyof typeof CLASS_KEY] ?? "other"];
/** " (+4.6%)" for a change against where it started; nothing when there was nothing to compare with. */
const pctText = (change: number, base: number): string => (base === 0 ? "" : ` (${change > 0 ? "+" : ""}${percent((change / Math.abs(base)) * 100)})`);

const assetHead = ["Asset", "Start", "Capital added", "Revaluation", "Depreciation", "Disposal", "Other", "End", "Equity", "Loan-to-value"];

/** What an asset is worth at the end of the period, wherever it could be read. */
const closingOf = (r: AssetValueRow): number => (r.kind === "registered" && r.state === "ready" ? r.bridge.closingMinor : r.closingMinor);
const openingOf = (r: AssetValueRow): number => (r.kind === "registered" && r.state === "ready" ? r.bridge.openingMinor : r.openingMinor);

/**
 * Property & assets: what your property, vehicles and other fixed assets are worth, what is owed against them and what is
 * left (equity), from the Asset Registry's own value history and the balances of the linked loans in Actual. Display only:
 * nothing is written to Actual or to the registry.
 */
export function AssetsTab({ data, today, onOpenLoans }: { data: Ready; today: string; onOpenLoans?: () => void }) {
  const { ledger, period, debt, schedules } = data;
  const scope: [string, string][] = [["Period", `${period.label}: ${formatDay(period.startDate)} to ${formatDay(period.endDate)}`], ["As of", formatDay(period.endDate)]];
  const wealth = useWealth(data);
  const rows = wealth.state === "ready" ? wealth.rows : null;
  const equity = rows ? homeEquity(rows) : null;
  // Until the rows are read the tiles wait; if the loans could not be read they say so instead of waiting for ever.
  const reading = wealth.state === "error" ? "The loans linked to your assets could not be read" : "Reading asset accounts…";
  const waiting = wealth.state === "error" ? "Unavailable" : MISSING;

  // The value of every fixed asset account, from Actual's own balances: it does not wait for the Asset Registry.
  const before = addMonths(period.startMonth, -1);
  const { openingMinor, closingMinor } = useMemo(() => {
    const accounts = [...ledger.account.values()].filter(isFixedAssetAccount);
    return { openingMinor: accounts.reduce((sum, a) => sum + ledger.balanceAt(a.id, before), 0), closingMinor: accounts.reduce((sum, a) => sum + ledger.balanceAt(a.id, period.endMonth), 0) };
  }, [ledger, before, period.endMonth]);
  const repaid = useMemo(() => new Map(debtAccounts(ledger, period, today, debt, schedules).map((r) => [r.accountId, r.principalRepaidMinor])), [ledger, period, today, debt, schedules]);

  // What the registry recorded as the value of the assets it could read changing: revaluation and depreciation.
  const valueChange = useMemo(() => {
    const ready = (rows ?? []).filter((r): r is Extract<AssetValueRow, { kind: "registered"; state: "ready" }> => r.kind === "registered" && r.state === "ready");
    return ready.length === 0 ? null : { revaluation: ready.reduce((a, r) => a + r.bridge.revaluationMinor, 0), depreciation: ready.reduce((a, r) => a + r.bridge.depreciationMinor, 0) };
  }, [rows]);
  return (
    <div className="space-y-4 p-4">
      <section aria-label="Property and assets">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <Tile label="Asset value" detail={<>{signedMoney(closingMinor - openingMinor)}{pctText(closingMinor - openingMinor, openingMinor)} during the period<span className="block">Property, vehicles and other fixed assets</span></>}>{money(closingMinor)}</Tile>
          <Tile label="Change in value" detail={!rows ? reading : valueChange === null ? "None of your assets could be read from the Asset Registry" : <>Revaluation {signedMoney(valueChange.revaluation)} · depreciation {signedMoney(valueChange.depreciation)}</>}>
            {!rows ? waiting : valueChange === null ? "Unavailable" : signedMoney(valueChange.revaluation + valueChange.depreciation)}
          </Tile>
          <Tile label="Debt against assets" tone={equity?.state === "unavailable" ? "warning" : undefined}
            detail={!equity ? reading : equity.state === "notLinked" ? "No loan is linked to an asset in Assets" : equity.state === "unavailable" ? equity.reason : <>Linked loans, as Actual shows them<span className="block">{debtChange(rows!)}</span></>}>
            {!equity ? waiting : equity.state === "notLinked" ? "Not linked" : equity.state === "unavailable" ? "Unavailable" : money(equity.debtMinor)}
          </Tile>
          <Tile label="Equity" tone={equity?.state === "unavailable" ? "warning" : undefined}
            detail={!equity ? reading : equity.state === "notLinked" ? "No loan is linked to an asset in Assets" : equity.state === "unavailable" ? equity.reason
              : <>Value of the linked assets less their loans{equity.startMinor !== null && <span className="block">{signedMoney(equity.endMinor - equity.startMinor)}{pctText(equity.endMinor - equity.startMinor, equity.startMinor)} during the period</span>}</>}>
            {!equity ? waiting : equity.state === "notLinked" ? "Not linked" : equity.state === "unavailable" ? "Unavailable" : money(equity.endMinor)}
          </Tile>
          <Tile label="Loan-to-value" tone={equity?.state === "unavailable" ? "warning" : undefined}
            detail={!equity ? reading : equity.state === "notLinked" ? "No loan is linked to an asset in Assets" : equity.state === "unavailable" ? equity.reason : "Debt as a share of the linked assets' value"}>
            {!equity ? waiting : equity.state === "notLinked" ? "Not linked" : equity.state === "unavailable" ? "Unavailable" : equity.ltvPercent === null ? MISSING : percent(equity.ltvPercent)}
          </Tile>
        </div>
      </section>

      {wealth.state === "loading" ? <p className="rounded-lg border border-border bg-card px-4 py-6 text-center text-xs text-muted-foreground" role="status">Reading asset accounts…</p>
        : wealth.state === "error" ? (
          <div className="rounded-lg border border-border bg-card px-4 py-6 text-center text-xs">
            <p className={WARNING}>The loans linked to your assets could not be read.</p>
            <Button size="xs" variant="outline" className="mt-2" onClick={wealth.retry}>Retry</Button>
          </div>
        ) : (
          <>
            {wealth.refreshing && <p className="text-xs text-muted-foreground" role="status">Refreshing asset accounts… the values below may be from the earlier read.</p>}
            {wealth.hasFailedBooks && (
              <div role="alert" className="flex items-center justify-between gap-3 rounded-lg border border-amber-500/40 bg-amber-50 px-4 py-2 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
                <span>Some asset accounts could not be read, so their values are shown as unavailable.</span>
                <Button size="xs" variant="outline" onClick={wealth.retryBooks}>Retry</Button>
              </div>
            )}
            <div className="grid items-stretch gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(20rem,2fr)]">
              <ValueOverTime series={wealth.series} data={data} scope={scope} />
              <ValueBridge rows={wealth.rows} scope={scope} />
            </div>
            <div className="grid items-stretch gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(20rem,2fr)]">
              <AssetValues rows={wealth.rows} scope={scope} />
              <AssetBars rows={wealth.rows} repaid={repaid} onOpenLoans={onOpenLoans} />
            </div>
          </>
        )}
    </div>
  );
}

/** "Owed went from X to Y" for the linked loans, when both are known. */
function debtChange(rows: readonly AssetValueRow[]): string {
  const loans = new Map<string, { start: number | null; end: number | null }>();
  for (const r of rows) if (r.kind === "registered") for (const l of r.loans) loans.set(l.debtId, { start: l.startDebtMinor, end: l.endDebtMinor });
  const all = [...loans.values()];
  if (all.length === 0 || all.some((l) => l.start === null || l.end === null)) return "";
  const delta = all.reduce((sum, l) => sum + (l.end ?? 0) - (l.start ?? 0), 0);
  return `${signedMoney(delta)} during the period`;
}

/** Value, debt and equity at each month end: the registry's value history with the loans' balances in Actual. */
function ValueOverTime({ series, data, scope }: { series: AssetSeries; data: Ready; scope: [string, string][] }) {
  const { period, ledger } = data;
  const hasOpening = ledger.firstMonth !== null && ledger.firstMonth <= addMonths(period.startMonth, -1);
  // A quarter or a year is stood for by its last month's position; the unit opens by the length of the period.
  const [unit, setUnit] = useGranularity(series.months);
  const names = GRANULARITY_NAME[unit];
  const buckets = useMemo(() => balanceBuckets(series.months, unit), [series.months, unit]);
  const months = buckets.map((b) => b.label);
  const partial = period.partial ? months.length - 1 : null;
  const early = !period.partial && buckets.length > 0 && endsEarly(buckets[buckets.length - 1], unit) ? months.length - 1 : null;
  const [, endMonthNo, endDay] = period.endDate.split("-");
  const todayLabel = `Today (${Number(endDay)} ${monthLabel(`${period.endDate.slice(0, 4)}-${endMonthNo}`).slice(0, 3)})`;
  const labels = [...(hasOpening ? ["Opening"] : []), ...months.map((l, i) => (i === partial ? todayLabel : l))];
  const points = [...(hasOpening ? [series.opening] : []), ...buckets.map((b) => series.points[lastIndex(b)])];
  const linked = series.linked > 0;
  const lines = [
    { key: "value", label: "Asset value", colour: "var(--fi-property)", values: points.map((p) => p.valueMinor) as (number | null)[], primary: true },
    ...(linked ? [
      { key: "debt", label: "Debt against linked assets", colour: "var(--fi-loan)", values: points.map((p) => p.debtMinor) as (number | null)[] },
      { key: "equity", label: "Equity", colour: "var(--fi-up)", values: points.map((p) => p.equityMinor) as (number | null)[] },
    ] : []),
  ];
  const table = { head: ["Point", ...lines.map((l) => l.label)], rows: labels.map((l, i) => [l, ...lines.map((x) => x.values[i])]) };
  const tip = (i: number) => monthTip({ title: labels[i], partial: false, partialNote: "", rows: lines.map((l) => ({ colour: l.colour, name: l.label, value: money(l.values[i]) })), compare: { values: lines[0].values, index: i, label: "asset value" } });
  return (
    <ChartFrame
      id="asset-value-over-time" title="Value, debt and equity over time" hint={linked ? "The assets, the loans against them and what is left" : "The value of your assets"}
      subtitle={<><p>The value of every registered asset at each {names.one} end, from the Asset Registry: the same history as the Assets page.{linked ? " Debt and equity cover only the assets that have a loan linked in Assets, and use the loan balances Actual holds at the same date." : ""}{unit !== "month" && ` A ${names.one} is a calendar ${names.one}, shown by its last month's position.`}</p><p>The line starts at the value before the period began. Only assets the registry could read are counted; accounts that need review are listed under the table.</p></>}
      legend={lines.map((l) => ({ label: l.label, colour: l.colour, dot: true }))} table={table} csvScope={scope}
      actions={<UnitPills value={unit} onChange={setUnit} label="Show values by" />}
      footnote={[hasOpening ? `The first point is the value before ${formatDay(period.startDate)}.` : "", partial !== null ? `${todayLabel} is the position today: a valid balance, only not a ${names.one}-end one.` : "", early !== null ? `* ${months[early]} is the position at ${formatDay(period.endDate)}, the end of the period, not the end of the ${names.one}.` : "", !linked ? "No loan is linked to an asset in Assets, so debt and equity are not shown." : ""].filter(Boolean).join(" ") || undefined}
    >
      {series.assets === 0 ? <p className="py-12 text-center text-xs text-muted-foreground">None of your assets could be read from the Asset Registry, so there is no history to draw. They are listed under Property and asset values.</p>
        : <LineChart labels={labels} partialIndex={early === null ? null : early + (hasOpening ? 1 : 0)} series={lines} height={290} ariaLabel={`Value of your assets, the debt against them and the equity at each ${names.one} end`} tip={tip} />}
    </ChartFrame>
  );
}

/** From what the assets were worth at the start to what they are worth now: capital added, revaluation, depreciation and disposals. */
function ValueBridge({ rows, scope }: { rows: readonly AssetValueRow[]; scope: [string, string][] }) {
  const ready = rows.filter((r): r is Extract<Registered, { state: "ready" }> => r.kind === "registered" && r.state === "ready");
  const left = new Set(rows.filter((r) => !(r.kind === "registered" && r.state === "ready")).map((r) => r.accountId)).size;
  const sum = (pick: (b: Extract<Registered, { state: "ready" }>["bridge"]) => number) => ready.reduce((a, r) => a + pick(r.bridge), 0);
  const lines = [
    { key: "capital", label: "Capital added", value: sum((b) => b.capitalMinor), note: "Money put into the assets: a purchase, improvements, a loan paid into them." },
    { key: "revaluation", label: "Revaluation", value: sum((b) => b.revaluationMinor), note: "A change in what the assets are worth, as recorded in Assets." },
    { key: "depreciation", label: "Depreciation", value: sum((b) => b.depreciationMinor), note: "Value lost to age or use, as recorded in Assets." },
    { key: "disposal", label: "Disposal", value: sum((b) => b.disposalMinor), note: "Assets sold or written off." },
    { key: "other", label: "Other", value: sum((b) => b.otherMinor), note: "Entries the registry holds that are none of the above." },
  ];
  const steps: WaterfallStep[] = [
    { key: "start", label: "Value at start", kind: "total", amountMinor: sum((b) => b.openingMinor) },
    ...lines.filter((l) => l.value !== 0).map((l) => ({ key: l.key, label: l.label, kind: "delta" as const, amountMinor: l.value, note: l.note })),
    { key: "end", label: "Value at end", kind: "total", amountMinor: sum((b) => b.closingMinor) },
  ];
  return (
    <ChartFrame
      id="asset-value-bridge" title="What changed the value of your assets" hint="Start to end of the period"
      subtitle={<><p>The value of your registered assets at the start of the period, one line at a time, to the value at the end, from the Asset Registry&apos;s own classified entries.</p><p>It covers the assets the registry could read; the others are listed under Property and asset values.</p></>}
      legend={[...steps.filter((x) => x.kind === "delta").map((x) => ({ label: x.label, colour: x.amountMinor >= 0 ? "var(--fi-up)" : "var(--fi-down)" })), { label: "Value", colour: "var(--fi-balance)" }]}
      table={{ head: ["Step", "Amount"], rows: steps.map((s) => [s.label, s.amountMinor]) }} csvScope={scope}
      footnote={left > 0 ? <span className={WARNING}>{left} {left === 1 ? "account is" : "accounts are"} not in these figures because {left === 1 ? "it needs" : "they need"} review.</span> : "The lines add up to the value at the end."}
    >
      {ready.length === 0 ? <p className="py-12 text-center text-xs text-muted-foreground">None of your assets could be read from the Asset Registry, so there is no bridge to draw.</p>
        : <Waterfall steps={steps} height={290} ariaLabel="What changed the value of your assets" canSelect={() => false} onSelect={() => undefined} />}
    </ChartFrame>
  );
}

/** Each asset's value, split into the loan against it and the equity: one bar per asset on a shared scale. */
function AssetBars({ rows, repaid, onOpenLoans }: { rows: readonly AssetValueRow[]; repaid: ReadonlyMap<string, number | null>; onOpenLoans?: () => void }) {
  const sorted = [...rows].sort((a, b) => closingOf(b) - closingOf(a));
  const scale = Math.max(1, ...sorted.map((r) => Math.max(0, closingOf(r))));
  return (
    <section className="h-full rounded-lg border border-border bg-card p-4" aria-label="Value, loan and equity by asset">
      <CardTitle title="Value, loan and equity by asset" hint="At the end of the period, on one scale" infoLabel="value, loan and equity by asset"
        info={<><p>Each asset&apos;s value at the end of the period. Where a loan is linked in Assets, the bar splits into the part still owed on the loan and the equity: what is left if the loan were paid from the value.</p><p>An asset with no loan linked is drawn as value only. All bars share one scale, so a larger asset is a longer bar.</p></>} />
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-sm" style={{ background: "var(--fi-up)" }} aria-hidden />Equity</span>
        <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-sm" style={{ background: "var(--fi-loan)" }} aria-hidden />Still owed on the linked loan</span>
        <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-sm" style={{ background: "var(--fi-property)" }} aria-hidden />Value, no loan linked</span>
      </div>
      <ul className="mt-3 space-y-4">
        {sorted.map((r) => {
          const value = closingOf(r);
          const ready = r.kind === "registered" && r.state === "ready" ? r : null;
          const end = ready?.equity.end;
          const split = !!ready && ready.linked && end?.debtMinor != null && end.equityMinor != null && value > 0;
          const owed = split ? Math.min(Math.max(0, end!.debtMinor!), value) : 0;
          const key = r.kind === "registered" ? r.assetId : r.accountId;
          const description = split ? `${r.name}: value ${money(value)}, owed ${money(end!.debtMinor!)}, equity ${money(end!.equityMinor!)}` : `${r.name}: value ${money(value)}`;
          return (
            <li key={key}>
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-xs">
                <span className="font-medium">{r.name}</span>
                <span className="tabular-nums">
                  <span className="font-semibold">{money(value)}</span>
                  {split && end!.ltvPercent !== null && <span className="ml-2 text-muted-foreground">Loan-to-value {percent(end!.ltvPercent)}</span>}
                  {ready && ready.linked && !split && <span className={`ml-2 ${WARNING}`}>Equity unavailable</span>}
                  {ready && !ready.linked && <span className="ml-2 text-muted-foreground">No loan linked</span>}
                  {!ready && <span className={`ml-2 ${WARNING}`}>Needs review</span>}
                </span>
              </div>
              <div className="mt-1 h-3 overflow-hidden rounded bg-muted" role="img" aria-label={description}>
                <div className="flex h-full" style={{ width: `${Math.max(1, (Math.max(0, value) / scale) * 100)}%` }}>
                  {split ? (<>
                    <div className="h-full" style={{ width: `${(Math.max(0, end!.equityMinor!) / value) * 100}%`, background: "var(--fi-up)" }} />
                    <div className="h-full" style={{ width: `${(owed / value) * 100}%`, background: "var(--fi-loan)" }} />
                  </>) : <div className="h-full w-full" style={{ background: colourOf(r) }} />}
                </div>
              </div>
              {split && end!.equityMinor! < 0 && <p className={`mt-1 text-xs ${WARNING}`}>More is owed than the asset is worth: equity is {money(end!.equityMinor!)}.</p>}
              {ready && ready.loans.length > 0 && (
                <ul className="mt-1.5 space-y-0.5 text-xs text-muted-foreground">
                  {ready.loans.map((l) => {
                    const principal = l.accountId ? repaid.get(l.accountId) : null;
                    return (
                      <li key={l.debtId}>
                        <span className="text-foreground">{l.name}</span>
                        {l.endDebtMinor === null ? " · balance unavailable" : <> · owed {money(l.endDebtMinor)}{l.startDebtMinor !== null && <>, {signedMoney(l.endDebtMinor - l.startDebtMinor)} in the period</>}</>}
                        {principal != null && principal > 0 && <> · principal repaid {money(principal)}</>}
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
      {onOpenLoans && (
        <p className="mt-4 border-t border-border/50 pt-2 text-xs text-muted-foreground">
          Repayments, interest and the schedule of each loan are on <button type="button" className="underline underline-offset-2 hover:text-foreground" onClick={onOpenLoans}>Loans &amp; cards</button>.
        </p>
      )}
    </section>
  );
}

/** Property, vehicles and other assets: the Asset Registry's value bridge, with equity and loan-to-value where loans are linked. */
function AssetValues({ rows, scope }: { rows: readonly AssetValueRow[]; scope: [string, string][] }) {
  const csv = rows.map((r) => (r.kind === "registered" && r.state === "ready"
    ? [r.name, r.bridge.openingMinor, r.bridge.capitalMinor, r.bridge.revaluationMinor, r.bridge.depreciationMinor, r.bridge.disposalMinor, r.bridge.otherMinor, r.bridge.closingMinor, r.equity.end.equityMinor, r.equity.end.ltvPercent === null ? null : `${r.equity.end.ltvPercent}%`]
    : [r.name, openingOf(r), null, null, null, null, null, closingOf(r), null, null]));
  // The columns nothing uses are left out (depreciation, disposal and other are often all zero), so the table fits half the page; the CSV keeps every column.
  const ready = rows.filter((r): r is Extract<Registered, { state: "ready" }> => r.kind === "registered" && r.state === "ready");
  const show = { depreciation: ready.some((r) => r.bridge.depreciationMinor !== 0), disposal: ready.some((r) => r.bridge.disposalMinor !== 0), other: ready.some((r) => r.bridge.otherMinor !== 0) };
  const heads = assetHead.slice(1).filter((h) => (h !== "Depreciation" || show.depreciation) && (h !== "Disposal" || show.disposal) && (h !== "Other" || show.other));
  const middle = 2 + Number(show.depreciation) + Number(show.disposal) + Number(show.other);
  const missing = rows.filter((r) => r.kind === "unregistered" || r.state === "unavailable");
  const missingAccounts = new Set(missing.map((r) => r.accountId)).size;
  return (
    <TableCard id="asset-values" title="Property and asset values" hint="Property, vehicles and other assets" csvScope={scope} head={assetHead} rows={csv}
      info={<><p>How each asset registered in Assets moved from its value at the start of the period to its value at the end, from the Asset Registry&apos;s own classified entries: the same figures as the Assets page for the same dates.</p><p>Equity is the recorded value less the linked loan balance in Actual on that date; loan-to-value is that debt as a share of the value. Either is Unavailable, never zero, when an input is missing.</p></>}
      note={missing.length > 0 ? <p className={WARNING}>{missingAccounts} {missingAccounts === 1 ? "account needs" : "accounts need"} review: their closing value is shown, but what depends on the Asset Registry is not. <Link href="/assets" className="underline underline-offset-2">Open Assets</Link></p> : "Registered assets only. Linked loans come from Assets; the loan balances are Actual's."}>
      <table className="w-full border-collapse text-xs">
        <thead><tr className="border-b border-border text-muted-foreground"><th scope="col" className="py-1.5 pr-2 text-left font-medium">Asset</th>{heads.map((h) => <th key={h} scope="col" className={TH}>{h}</th>)}</tr></thead>
        <tbody>
          {rows.map((r) => {
            const name = <th scope="row" className="max-w-56 py-1.5 pr-2 text-left font-normal whitespace-nowrap"><span className="block truncate" title={r.name}>{r.name}</span></th>;
            if (r.kind === "unregistered") {
              return <tr key={r.accountId} className="border-b border-border/40">{name}<td className={TD}>{money(r.openingMinor)}</td><td colSpan={middle} className={`pr-2 text-left ${WARNING}`} title={r.reason}>{r.reason ? `Needs review · ${r.reason}` : "Not in the Asset Registry · Needs review"}</td><td className={`${TD} font-medium`}>{money(r.closingMinor)}</td><td className="pr-2 text-right text-muted-foreground">{MISSING}</td><td className="pr-2 text-right text-muted-foreground">{MISSING}</td></tr>;
            }
            if (r.state === "unavailable") {
              return <tr key={r.assetId} className="border-b border-border/40">{name}<td className={TD}>{money(r.openingMinor)}</td><td colSpan={middle} className={`pr-2 text-left ${WARNING}`} title={r.reason}>Needs review · {r.reason}</td><td className={`${TD} font-medium`}>{money(r.closingMinor)}</td><td className="pr-2 text-right text-muted-foreground">{MISSING}</td><td className="pr-2 text-right text-muted-foreground">{MISSING}</td></tr>;
            }
            const b = r.bridge, e = r.equity.end;
            const equityCell = !r.linked ? <span className="text-muted-foreground">Not linked</span> : e.equityMinor === null ? <span className={WARNING} title={e.gaps.join(". ")}>Unavailable</span>
              : <span title={r.equity.start.equityMinor !== null ? `Equity at the start: ${money(r.equity.start.equityMinor)}` : undefined}>{money(e.equityMinor)}</span>;
            const ltvCell = !r.linked ? <span className="text-muted-foreground">{MISSING}</span> : e.ltvPercent === null ? <span className={WARNING}>Unavailable</span> : <>{percent(e.ltvPercent)}</>;
            const signed = (v: number) => (v === 0 ? money(0) : signedMoney(v));
            return (
              <tr key={r.assetId} className="border-b border-border/40">
                {name}<td className={TD}>{money(b.openingMinor)}</td><td className={TD}>{signed(b.capitalMinor)}</td><td className={TD}>{signed(b.revaluationMinor)}</td>{show.depreciation && <td className={TD}>{signed(b.depreciationMinor)}</td>}{show.disposal && <td className={TD}>{signed(b.disposalMinor)}</td>}{show.other && <td className={TD}>{signed(b.otherMinor)}</td>}
                <td className={`${TD} font-medium`}>{money(b.closingMinor)}</td><td className={TD}>{equityCell}</td><td className={TD}>{ltvCell}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </TableCard>
  );
}
