"use client";

import { useMemo } from "react";
import type { DrillTarget } from "@/lib/financial-insights/drill";
import { addMonths, monthLabel } from "@/lib/financial-insights/period";
import { otherOf, portfolioBridge, portfolioMonthly, portfolioSeries, type AccountBridge } from "@/lib/financial-insights/wealth";
import type { FinancialInsightsView } from "../hooks/useFinancialInsights";
import { MISSING, money, percent, signedMoney, formatDay } from "../format";
import { ASSET_CLASSES, LIABILITY_CLASSES } from "@/lib/financial-insights/breakdowns";
import { GRANULARITY_NAME, balanceBuckets, bucketMonths, endsEarly, lastIndex } from "@/lib/financial-insights/buckets";
import { useGranularity } from "../hooks/useGranularity";
import { UnitPills } from "./UnitPills";
import { ChartFrame } from "./ChartFrame";
import { TableCard, TD, TH } from "./TableCard";
import { DrillLink } from "./DrillLink";
import { Tile } from "./Tile";
import { BarChart } from "./charts/BarChart";
import { LineChart } from "./charts/LineChart";
import { monthTip } from "./charts/monthTip";
import { Waterfall, type WaterfallStep } from "./charts/Waterfall";

type Ready = Extract<FinancialInsightsView["data"], { state: "ready" }>;
const WARNING = "text-amber-700 dark:text-amber-400";
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

/** " (+4.6%)" for a change against where it started; nothing when there was nothing to compare with. */
const pctText = (change: number, base: number): string => (base === 0 ? "" : ` (${change > 0 ? "+" : ""}${percent((change / Math.abs(base)) * 100)})`);

/** Investments: what has been built up, without an invented return. */
export function WealthTab({ data, onDrill }: { data: Ready; onDrill: (target: DrillTarget) => void }) {
  const { ledger, period, summary } = data;
  const scope: [string, string][] = [["Period", `${period.label}: ${formatDay(period.startDate)} to ${formatDay(period.endDate)}`], ["As of", formatDay(period.endDate)]];
  const bridge = useMemo(() => portfolioBridge(ledger, period), [ledger, period]);
  const series = useMemo(() => portfolioSeries(ledger, period), [ledger, period]);
  const monthly = useMemo(() => portfolioMonthly(ledger, period), [ledger, period]);
  // The value the period opened with, as its own point before the first month: the first month's end value can differ a lot from it.
  const hasOpening = ledger.firstMonth !== null && ledger.firstMonth <= addMonths(period.startMonth, -1);
  const lines = useMemo(() => CHANGE_LINES.filter((l) => l.always || monthly.some((m) => l.of(m) !== 0)), [monthly]);
  const hasPortfolio = bridge.accounts.length > 0;
  const t = bridge.total;
  const tileLink = (amount: number, target: DrillTarget, label: string, signed = false) => (amount === 0 ? money(0) : <DrillLink smallDecimals label={`${label} ${signed ? signedMoney(amount) : money(amount)}`} onClick={() => onDrill(target)}>{signed ? signedMoney(amount) : money(amount)}</DrillLink>);
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
  // A picture of the End column: only with more than one account, and only a share of positive values.
  const positiveClosing = bridge.accounts.reduce((sum, a) => sum + Math.max(0, a.closing), 0);
  const showShare = bridge.accounts.length > 1 && positiveClosing > 0;
  const shareCell = (value: number) => {
    const part = Math.max(0, value) / positiveClosing;
    return (
      <td className="py-1.5 pr-2 text-right whitespace-nowrap">
        {part > 0 ? <span className="inline-flex items-center justify-end gap-1.5 tabular-nums"><span className="h-1.5 w-20 overflow-hidden rounded-full bg-muted" aria-hidden><span className="block h-full rounded-full bg-muted-foreground/50" style={{ width: `${Math.max(2, part * 100)}%` }} /></span><span className="w-9 text-muted-foreground">{percent(part * 100)}</span></span> : ""}
      </td>
    );
  };
  const accountHead = ["Account", "Treatment", "Start", "Funding", "Withdrawals", "Investment activity", ...(showOpened ? ["Opened"] : []), ...(showOther ? ["Other"] : []), "End"];
  const accountCsv = [...bridge.accounts.map((a) => [a.name, a.treatment, a.opening, a.funding, a.withdrawals, a.activity, ...(showOpened ? [a.openingBalances] : []), ...(showOther ? [otherOf(a)] : []), a.closing]),
    ["Total", "", t.opening, t.funding, t.withdrawals, t.activity, ...(showOpened ? [t.openingBalances] : []), ...(showOther ? [otherOf(t)] : []), t.closing]];
  const cell = (amount: number, target: DrillTarget | null, label: string, signed = true) => (amount !== 0 && target ? <DrillLink label={`${label} ${signedMoney(amount)}`} onClick={() => onDrill(target)}>{signed ? signedMoney(amount) : money(amount)}</DrillLink> : amount === 0 ? money(0) : signed ? signedMoney(amount) : money(amount));
  const accountRow = (a: AccountBridge) => {
    return (
      <tr key={a.accountId} className="border-b border-border/40">
        <th scope="row" className="max-w-56 py-1.5 pr-2 text-left font-normal whitespace-nowrap"><span className="block truncate" title={a.name}>{a.name}</span></th>
        <td className="pr-2 text-left whitespace-nowrap text-muted-foreground" >{a.treatment}</td>
        <td className={TD}>{money(a.opening)}</td>
        <td className={TD}>{cell(a.funding, { kind: "contributed", accountId: a.accountId }, `${a.name} funding`)}</td>
        <td className={TD}>{cell(a.withdrawals, { kind: "withdrawn", accountId: a.accountId }, `${a.name} withdrawals`)}</td>
        <td className={TD}>{cell(a.activity, a.offBudget ? { kind: "investmentResults", accountId: a.accountId } : null, `${a.name} investment activity`)}</td>
        {showOpened && <td className={TD}>{signedMoney(a.openingBalances)}</td>}
        {showOther && <td className={`${TD} ${a.unexplained !== 0 ? WARNING : ""}`}>{signedMoney(otherOf(a))}</td>}
        <td className={`${TD} font-medium`}>{money(a.closing)}</td>
        {showShare && shareCell(a.closing)}
      </tr>
    );
  };

  return (
    <div className="space-y-4 p-4">
      <section className="space-y-4" aria-label="Your wealth">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <Tile label="Investments" info={<p>The value of your investment and retirement accounts at the end of the period.</p>} detail={<>{signedMoney(t.closing - t.opening)}{pctText(t.closing - t.opening, t.opening)} during the period</>}>{money(t.closing)}</Tile>
          <Tile label="Put in" info={<p>Money moved in from accounts outside your investments.</p>} detail="From outside your investments">{tileLink(t.funding, portfolioDrill("contributed"), "Put into investments")}</Tile>
          <Tile label="Withdrawn" info={<p>Money moved out to accounts outside your investments.</p>} detail="To outside your investments">{tileLink(0 - t.withdrawals, portfolioDrill("withdrawn"), "Withdrawn from investments")}</Tile>
          <Tile label="Investment activity" info={<p>Entries with no category inside your investment accounts: price changes, dividends, interest and fees as recorded. This is not a return.</p>} detail="Recorded inside: not a return">{tileLink(t.activity, portfolioDrill("investmentResults"), "Investment activity", true)}</Tile>
          <Tile label="Share of your assets" detail={summary.assets > 0 ? `${money(t.closing)} of ${money(summary.assets)} owned` : "Nothing owned yet"}>{summary.assets > 0 ? percent((t.closing / summary.assets) * 100) : MISSING}</Tile>
        </div>
      </section>

      {/* The two timelines on the left, the bridge and the accounts on the right: each row is a pair of cards of one height. */}
      <div className="grid items-stretch gap-4 xl:grid-cols-[minmax(0,6fr)_minmax(0,5fr)]">
        <WealthOverview data={data} scope={scope} />
        {hasPortfolio && (
          <>
          <ChartFrame
            id="portfolio-bridge" title="What changed your investments" hint="Start to end of the period"
            subtitle={<><p>The value of your investment and retirement accounts at the start of the period, one line at a time, to the value at the end.</p><p>Funding and withdrawals are money moved between these accounts and anything outside them. Investment activity and value changes are what was recorded inside. If the lines do not reach the end value, the difference is shown as Unexplained rather than hidden. This is not a return.</p><p>Select a step to see its transactions.</p></>}
            legend={[...steps.filter((x) => x.kind === "delta").map((x) => ({ label: x.label, colour: x.colour ?? "var(--fi-balance)" })), { label: "Value", colour: "var(--fi-balance)" }]}
            table={{ head: ["Step", "Amount"], rows: bridgeRows }} csvScope={scope}
            footnote={<>{t.unexplained === 0 ? "Nothing is left unexplained: the lines add up to the value at the end." : <span className={WARNING}>{money(Math.abs(t.unexplained))} of the change is not explained by the lines. Please review your accounts.</span>} Investment activity is not a return.</>}
          >
            <Waterfall steps={steps} height={290} ariaLabel="What changed the value of your investments" canSelect={(s) => stepDrill(s.key) !== null} onSelect={(s) => { const target = stepDrill(s.key); if (target) onDrill(target); }} />
          </ChartFrame>
          <PortfolioValueCard bridge={bridge} series={series} monthly={monthly} lines={lines} hasOpening={hasOpening} period={period} scope={scope} onDrill={onDrill} />
        <TableCard id="investment-accounts" title="Investment accounts" hint="Account by account, same lines as the bridge" csvScope={scope}
          info={<><p>Each investment and retirement account from its value at the start of the period to its value at the end. Funding and withdrawals are transfers with accounts outside your investments; investment activity is what was recorded inside without a category.</p><p>Moves between two of your investment accounts have their own column and cancel in the total. Select a figure to see its transactions.</p></>}
          head={accountHead} rows={accountCsv} note="The totals row equals the bridge.">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-border text-muted-foreground">
                <th scope="col" className="py-1.5 pr-2 text-left font-medium">Account</th><th scope="col" className="pr-2 text-left font-medium">Treatment</th>
                {accountHead.slice(2).map((h) => <th key={h} scope="col" className={TH}>{h}</th>)}{showShare && <th scope="col" className={TH}>Share</th>}
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
                {showShare && <td />}
              </tr>
            </tbody>
          </table>
        </TableCard>
          </>
        )}
      </div>
    </div>
  );
}

type PortfolioProps = {
  bridge: ReturnType<typeof portfolioBridge>;
  series: ReturnType<typeof portfolioSeries>;
  monthly: ReturnType<typeof portfolioMonthly>;
  lines: typeof CHANGE_LINES;
  hasOpening: boolean;
  period: Ready["period"];
  scope: [string, string][];
  onDrill: (target: DrillTarget) => void;
};

/** The value of the portfolio and what moved it, by month, quarter or year: a quarter or year adds up its months' changes and ends on its last month's value. */
function PortfolioValueCard({ bridge, series, monthly, lines, hasOpening, period, scope, onDrill }: PortfolioProps) {
  const [unit, setUnit] = useGranularity(series.months);
  const names = GRANULARITY_NAME[unit];
  const hasValue = useMemo(() => series.totals.map((v) => v !== null), [series.totals]);
  const buckets = useMemo(() => bucketMonths(series.months, hasValue, series.months.map((_, i) => period.partial && i === series.months.length - 1), unit), [series.months, hasValue, unit, period.partial]);
  const labels = buckets.map((b) => b.label);
  const partials = buckets.flatMap((b, i) => (b.partial ? [i] : []));
  const shift = hasOpening ? 1 : 0;
  const openingValue = bridge.total.opening;
  // Each bucket over its months that have a value: what each line added up to, where it opened and where it ended.
  const over = buckets.map((b) => {
    const live = b.indexes.filter((i) => hasValue[i]);
    if (live.length === 0) return null;
    const first = live[0], last = live[live.length - 1];
    return { live, first, last, opening: monthly[first].opening, closing: monthly[last].closing, value: series.totals[last] as number };
  });
  const lineValue = (l: (typeof lines)[number], i: number) => (over[i] ? over[i]!.live.reduce((sum, k) => sum + l.of(monthly[k]), 0) : null);
  const colourOf = (i: number) => ACCOUNT_COLOURS[i % ACCOUNT_COLOURS.length];
  const partialNote = unit === "month" ? `Partial month: it runs to ${formatDay(period.endDate)}.` : `Partial ${names.one}: the period covers only part of it, or it includes the month still running.`;
  const footnote = [
    hasOpening ? `The first point is the opening balance: the value at the end of ${monthLabel(addMonths(period.startMonth, -1))}, before ${formatDay(period.startDate)}.` : "",
    partials.length === 0 ? "" : unit === "month" ? `* ${labels[partials[0]]} is partial: it runs to ${formatDay(period.endDate)} and is drawn lighter with a dashed outline.`
      : `* ${partials.map((i) => labels[i]).join(" and ")} ${partials.length === 1 ? "is" : "are"} partial: the period covers only part of ${partials.length === 1 ? "it" : "them"}, or ${partials.length === 1 ? "it includes" : "they include"} the month still running, so ${partials.length === 1 ? "it is" : "they are"} drawn lighter with a dashed outline.`,
  ].filter(Boolean).join(" ") || undefined;
  return (
    <ChartFrame
      id="portfolio-value" title={`Portfolio value and changes by ${names.one}`} hint="One scale: the value of the portfolio"
      subtitle={<><p>The line is the value of the portfolio, starting from the opening balance (the value before the period began) and then at each {names.one} end. Each {names.one}&apos;s bar starts at the value the {names.one} opened with: increases (funding, investment activity, value changes) stack above it and decreases (withdrawals) hang below it, so you see which change moved the line, and when. The axis does not start at zero.{unit !== "month" && ` A ${names.one} is a calendar ${names.one}: it adds up its months' changes and ends on its last month's value.`}</p><p>Select a segment to see its transactions.</p></>}
      legend={[...lines.map((l) => ({ label: l.label, colour: l.colour })), { label: `Value at ${names.one} end`, colour: "var(--fi-networth)", line: true }]}
      actions={<UnitPills value={unit} onChange={setUnit} label="Show the portfolio by" />}
      table={{ head: [names.one[0].toUpperCase() + names.one.slice(1), ...lines.map((l) => l.label), "Change", ...series.accounts.map((a) => `${a.name} at end`), "Value at end"], rows: [
        ...(hasOpening ? [["Opening balance", ...lines.map(() => null), null, ...bridge.accounts.filter((a) => series.accounts.some((x) => x.accountId === a.accountId)).map((a) => a.opening), openingValue] as (string | number | null)[]] : []),
        ...buckets.map((b, i) => [labels[i] + (b.partial ? " (partial)" : ""), ...lines.map((l) => lineValue(l, i)), over[i] ? over[i]!.closing - over[i]!.opening : null, ...series.accounts.map((a) => (over[i] ? a.values[over[i]!.last] : null)), over[i]?.value ?? null] as (string | number | null)[]),
      ] }} csvScope={scope}
      footnote={footnote}
    >
      <BarChart labels={hasOpening ? ["Opening", ...labels] : labels} partialIndex={partials.length ? partials.map((i) => i + shift) : null} stacked height={290} ariaLabel={`What changed the value of the portfolio in each ${names.one}, with its value at the opening and at each ${names.one} end`}
        series={lines.map((l) => ({ key: l.key, label: l.label, colour: l.colour, values: [...(hasOpening ? [null] : []), ...buckets.map((_, i) => lineValue(l, i))] }))}
        base={[...(hasOpening ? [null] : []), ...over.map((o) => (o ? o.opening : null))]}
        overlay={{ label: `Value at ${names.one} end`, colour: "var(--fi-networth)", values: [...(hasOpening ? [openingValue] : []), ...over.map((o) => (o ? o.value : null))] }}
        tip={(at) => {
          if (hasOpening && at === 0) {
            return monthTip({
              title: "Opening balance", partial: false, partialNote: "",
              rows: [...(bridge.accounts.length > 1 ? bridge.accounts.filter((a) => a.opening !== 0).map((a) => ({ name: a.name, value: money(a.opening) })) : []), { name: "Value at the start", value: money(openingValue), strong: true }],
            });
          }
          const i = at - shift;
          const o = over[i];
          return monthTip({
            title: labels[i], partial: buckets[i].partial, partialNote,
            rows: [...lines.map((l) => ({ colour: l.colour, name: l.label, value: signedMoney(lineValue(l, i) ?? 0) })), { name: `Change in the ${names.one}`, value: signedMoney(o ? o.closing - o.opening : 0), strong: true }, ...(series.accounts.length > 1 && o ? series.accounts.map((a, k) => ({ colour: colourOf(k), name: `${a.name} at the end`, value: money(a.values[o.last]) })) : []), { name: <span className="font-semibold">Value at the end</span>, value: <span className="font-semibold">{money(o ? o.closing : null)}</span> }],
          });
        }}
        onSelect={(at, k) => { const i = at - shift; const line = lines[k]; if (i >= 0 && line?.drill) onDrill({ kind: line.drill, portfolio: true, month: buckets[i].first, throughMonth: buckets[i].last !== buckets[i].first ? buckets[i].last : undefined }); }} />
    </ChartFrame>
  );
}

/** Your wealth over time, and where it is held: the Summary's own series and classes, drawn for this tab. */
function WealthOverview({ data, scope }: { data: Ready; scope: [string, string][] }) {
  const { composition, period } = data;
  // A quarter or a year is stood for by its last month's balance; the unit opens by the length of the period.
  const [unit, setUnit] = useGranularity(period.months);
  const names = GRANULARITY_NAME[unit];
  const buckets = useMemo(() => balanceBuckets(composition.months.map((m) => m.month), unit), [composition.months, unit]);
  const labels = buckets.map((b) => b.label);
  const stopsEarly = buckets.length > 0 && endsEarly(buckets[buckets.length - 1], unit);
  const partial = period.partial ? labels.length - 1 : null;
  // The period ends before its last quarter or year does: that bar is marked, and says which month it stops at.
  const early = !period.partial && stopsEarly ? labels.length - 1 : null;
  // A month before the budget has data is unavailable, never a balance of zero.
  const known = buckets.map((b) => composition.hasData[lastIndex(b)] ?? true);
  const netWorth = buckets.map((b, i) => (known[i] ? composition.netWorth[lastIndex(b)] : null));
  // Today's balance is a valid balance, only not a month-end one, so it is labelled as today and drawn like any other.
  const [, endMonthNo, endDay] = period.endDate.split("-");
  const todayLabel = `Today (${Number(endDay)} ${monthLabel(`${period.endDate.slice(0, 4)}-${endMonthNo}`).slice(0, 3)})`;
  const shown = labels.map((l, i) => (i === partial ? todayLabel : l));
  const unitEnd = `${names.one} end`;
  // Months in which money was borrowed: assets and debts rise together, which is not an increase in wealth.
  const borrowedBy = buckets.map((b) => b.indexes.reduce((sum, i) => sum + data.monthly[i].borrowed, 0));
  const borrowed = borrowedBy.flatMap((amount, i) => (amount > 0 ? [{ index: i, amount }] : []));
  const owned = buckets.map((b, i) => (known[i] ? ASSET_CLASSES.reduce((a, k) => a + composition.months[lastIndex(b)][k], 0) : null));
  // What is owed is drawn as a positive amount, as on the Summary tiles.
  const owed = buckets.map((b, i) => (known[i] ? 0 - LIABILITY_CLASSES.reduce((a, k) => a + composition.months[lastIndex(b)][k], 0) : null));
  const series = [
    { key: "net", label: "Net worth", colour: "var(--fi-networth)", values: netWorth as (number | null)[], primary: true },
    { key: "owned", label: "Everything owned", colour: "var(--fi-invest)", values: owned as (number | null)[] },
    { key: "owed", label: "Debts", colour: "var(--fi-loan)", values: owed as (number | null)[] },
  ];
  const tip = (i: number) => monthTip({
    title: shown[i], partial: false, partialNote: "",
    rows: [...series.map((s) => ({ colour: s.colour, name: s.label, value: money(s.values[i]), strong: s.key === "net" })), ...(borrowedBy[i] ? [{ name: `◆ Borrowed that ${names.one}`, value: money(borrowedBy[i]) }] : [])],
    compare: { values: netWorth, index: i, label: "net worth" },
  });
  const table = { head: [names.one[0].toUpperCase() + names.one.slice(1), "Net worth", "Everything owned", "Debts"], rows: shown.map((l, i) => [l + (i === early ? ` (to ${monthLabel(buckets[i].last)})` : ""), netWorth[i], owned[i], owed[i]]) };

  return (
    <ChartFrame
        id="wealth-over-time" title="Your wealth over time" hint="The total, the assets behind it and the debts deducted"
        subtitle={<><p>Net worth is everything you own less everything you owe, measured at each {unitEnd}, as on the Summary tab. Debts are drawn as a positive amount.{unit !== "month" && ` A ${names.one} is a calendar ${names.one}, shown by its last month's balance.`}</p></>}
        legend={series.map((s) => ({ label: s.label, colour: s.colour, dot: true }))}
        table={table} csvScope={scope}
        actions={<UnitPills value={unit} onChange={setUnit} label="Show wealth by" />}
        footnote={[partial !== null ? `${todayLabel} is the balance today: a valid balance, only not a ${unitEnd} one.` : "", early !== null ? `* ${labels[early]} is the balance at ${formatDay(period.endDate)}, the end of the period, not the end of the ${names.one}.` : "", ...borrowed.map((b) => `◆ ${labels[b.index]}: ${money(b.amount)} borrowed from loans. Assets and debts rise together, so this is not an increase in wealth.`)].filter(Boolean).join(" ") || undefined}
      >
        <LineChart labels={shown} partialIndex={early} annotations={borrowed.map((b) => ({ index: b.index, text: `Borrowed ${money(b.amount)}: assets and debts rise together` }))} series={series} height={290} ariaLabel={`Net worth, everything owned and debts at each ${unitEnd}`} tip={tip} endLabels />
      </ChartFrame>
  );
}
