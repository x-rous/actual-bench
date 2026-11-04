"use client";

import { useMemo } from "react";
import { ArrowRight } from "lucide-react";
import { cashBridgeLines } from "@/lib/financial-insights/breakdowns";
import type { DrillKind, DrillTarget } from "@/lib/financial-insights/drill";
import { GRANULARITY_NAME, bucketMonths, type Granularity } from "@/lib/financial-insights/buckets";
import type { FinancialInsightsView } from "../hooks/useFinancialInsights";
import { useGranularity } from "../hooks/useGranularity";
import { money, percent, signedMoney, formatDay } from "../format";
import { ChartFrame } from "./ChartFrame";
import { Delta } from "./Delta";
import { DrillLink } from "./DrillLink";
import { DebtRepaymentsCard } from "./DebtRepaymentsCard";
import { CardTitle } from "./InfoTip";
import { Tile } from "./Tile";
import { UnitPills } from "./UnitPills";
import { BarChart } from "./charts/BarChart";
import { FlowChart } from "./charts/FlowChart";
import { monthTip } from "./charts/monthTip";
import { Waterfall, type WaterfallStep } from "./charts/Waterfall";

type Ready = Extract<FinancialInsightsView["data"], { state: "ready" }>;
const WARNING = "text-amber-700 dark:text-amber-400";
/** The cash steps that open transactions, by the key of the step, and what each opens. */
const CASH_DRILLS: Record<string, DrillKind> = {
  cashIncome: "cashIncome", cashSpending: "cashSpending", card: "cardPaid", contributed: "contributed", withdrawn: "withdrawn", repaid: "repaid", borrowed: "borrowed",
  fixedDeposits: "fixedMoved", assets: "assetsMoved", liabilities: "liabilitiesMoved",
};

type Monthly = Ready["monthly"];

/** A flow card's unit: months, calendar quarters or calendar years (opening by the length of the period), and what each adds up to. */
function useFlowUnit(monthly: Monthly) {
  const [unit, setUnit] = useGranularity(monthly.map((m) => m.month));
  const buckets = useMemo(() => bucketMonths(monthly.map((m) => m.month), monthly.map((m) => m.hasData), monthly.map((m) => m.partial), unit), [monthly, unit]);
  const sum = (pick: (m: Monthly[number]) => number) => buckets.map((b) => (b.hasData ? b.indexes.reduce((total, i) => total + (monthly[i].hasData ? pick(monthly[i]) : 0), 0) : null));
  return { unit, setUnit, names: GRANULARITY_NAME[unit], buckets, labels: buckets.map((b) => b.label), partials: buckets.flatMap((b, i) => (b.partial ? [i] : [])), sum };
}

const partialNoteOf = (unit: Granularity, endDate: string) => (unit === "month" ? `Partial month: it runs to ${formatDay(endDate)}.` : `Partial ${GRANULARITY_NAME[unit].one}: the period covers only part of it, or it includes the month still running.`);
const partialFootnote = (labels: string[], partials: number[], unit: Granularity, period: Ready["period"]) => (partials.length === 0 ? undefined
  : unit === "month" ? `* ${labels[partials[0]]} is partial: it runs to ${formatDay(period.endDate)}, is drawn lighter with a dashed outline and is not compared with full months.`
  : `* ${partials.map((i) => labels[i]).join(" and ")} ${partials.length === 1 ? "is" : "are"} partial: the period covers only part of ${partials.length === 1 ? "it" : "them"} (${formatDay(period.startDate)} to ${formatDay(period.endDate)}), so ${partials.length === 1 ? "it is" : "they are"} drawn lighter with a dashed outline and not compared with whole ${GRANULARITY_NAME[unit].many}.`);
const drillRange = (b: { first: string; last: string }) => ({ month: b.first, throughMonth: b.last !== b.first ? b.last : undefined });
type FlowProps = { monthly: Monthly; period: Ready["period"]; scope: [string, string][]; onDrill: (target: DrillTarget) => void };

/** Money moved between the cash accounts and the investments, by month, quarter or year. */
function InvestmentsFlow({ monthly, period, scope, onDrill }: FlowProps) {
  const { unit, setUnit, names, buckets, labels, partials, sum } = useFlowUnit(monthly);
  const put = sum((m) => m.contributed), taken = sum((m) => m.withdrawn);
  const moved = monthly.some((m) => m.contributed || m.withdrawn);
  return (
    <ChartFrame id="investments" title="Investments" hint={`Between your cash accounts and investments, each ${names.one}`}
      legend={[{ label: "Put into investments", colour: "var(--fi-invest)" }, { label: "Withdrawn from investments", colour: "var(--fi-income)" }]}
      actions={<UnitPills value={unit} onChange={setUnit} label="Show investments by" />}
      table={{ head: [names.one[0].toUpperCase() + names.one.slice(1), "Put into investments", "Withdrawn"], rows: buckets.map((b, i) => [labels[i] + (b.partial ? " (partial)" : ""), put[i], taken[i]]) }} csvScope={scope}
      footnote={partialFootnote(labels, partials, unit, period)}>
      {!moved ? <p className="py-12 text-center text-xs text-muted-foreground">No money moved between your cash accounts and investments in this period.</p> : <BarChart labels={labels} partialIndex={partials.length ? partials : null} height={210} ariaLabel={`Money put into and withdrawn from investments each ${names.one}`}
        series={[{ key: "in", label: "Put into investments", colour: "var(--fi-invest)", values: put }, { key: "out", label: "Withdrawn from investments", colour: "var(--fi-income)", values: taken }]}
        tip={(i) => monthTip({ title: labels[i], partial: buckets[i].partial, partialNote: partialNoteOf(unit, period.endDate), rows: [{ colour: "var(--fi-invest)", name: "Put into investments", value: money(put[i] ?? 0) }, { colour: "var(--fi-income)", name: "Withdrawn", value: money(taken[i] ?? 0) }] })}
        onSelect={(i, k) => onDrill({ kind: k === 0 ? "contributed" : "withdrawn", ...drillRange(buckets[i]) })} />}
    </ChartFrame>
  );
}

/** Loan principal that left the cash accounts, by month, quarter or year, with the money borrowed listed under it. */
function LoanPrincipalFlow({ monthly, period, scope, onDrill }: FlowProps) {
  const { unit, setUnit, names, buckets, labels, partials, sum } = useFlowUnit(monthly);
  const repaid = sum((m) => m.repaid), borrowed = sum((m) => m.borrowed);
  const borrowedIn = borrowed.flatMap((amount, i) => (amount !== null && amount > 0 ? [{ i, amount }] : []));
  return (
    <ChartFrame id="loan-principal" title="Loan principal repaid" hint={`Left your cash accounts for loans, each ${names.one}`} subtitle={<p>Borrowing is listed below the chart, not drawn.</p>}
      legend={[{ label: "Loan principal repaid", colour: "var(--fi-loan)" }]}
      actions={<UnitPills value={unit} onChange={setUnit} label="Show loan principal by" />}
      table={{ head: [names.one[0].toUpperCase() + names.one.slice(1), "Loan principal repaid", "Borrowed"], rows: buckets.map((b, i) => [labels[i] + (b.partial ? " (partial)" : ""), repaid[i], borrowed[i]]) }} csvScope={scope}
      footnote={partialFootnote(labels, partials, unit, period)}>
      {monthly.every((m) => !m.repaid) ? <p className="py-12 text-center text-xs text-muted-foreground">No loan principal left your cash accounts in this period.</p> : <BarChart labels={labels} partialIndex={partials.length ? partials : null} height={210} ariaLabel={`Loan principal repaid each ${names.one}`}
        series={[{ key: "repaid", label: "Loan principal repaid", colour: "var(--fi-loan)", values: repaid }]}
        tip={(i) => monthTip({ title: labels[i], partial: buckets[i].partial, partialNote: partialNoteOf(unit, period.endDate), rows: [{ colour: "var(--fi-loan)", name: "Loan principal repaid", value: money(repaid[i] ?? 0) }, ...(borrowed[i] ? [{ name: `◆ Borrowed that ${names.one}`, value: money(borrowed[i] ?? 0) }] : [])], compare: { values: repaid, index: i, label: "repaid" } })}
        onSelect={(i) => onDrill({ kind: "repaid", ...drillRange(buckets[i]) })} />}
      {borrowedIn.length > 0 && (
        <ul className="mt-1 divide-y divide-border/50 text-xs">
          {borrowedIn.map((b) => <li key={b.i} className="flex justify-between gap-3 py-1"><span>◆ {labels[b.i]} · borrowed (received from loans)</span><DrillLink label={`Borrowed ${labels[b.i]} ${money(b.amount)}`} onClick={() => onDrill({ kind: "borrowed", ...drillRange(buckets[b.i]) })}>{money(b.amount)}</DrillLink></li>)}
        </ul>
      )}
    </ChartFrame>
  );
}

/** Money in & out: what came in, what went out, what was left, and how cash moved. */
export function MoneyTab({ data, onDrill }: { data: Ready; onDrill: (target: DrillTarget) => void }) {
  const { summary, monthly, period, comparison } = data;
  const scope: [string, string][] = [["Period", `${period.label}: ${formatDay(period.startDate)} to ${formatDay(period.endDate)}`], ["As of", formatDay(period.endDate)]];
  const partialNote = `Partial month: it runs to ${formatDay(period.endDate)}.`;
  // Money in, money out by month, quarter or year (it opens by the length of the period): a quarter or year adds up its months.
  const [unit, setUnit] = useGranularity(monthly.map((m) => m.month));
  const names = GRANULARITY_NAME[unit];
  const buckets = useMemo(() => bucketMonths(monthly.map((m) => m.month), monthly.map((m) => m.hasData), monthly.map((m) => m.partial), unit), [monthly, unit]);
  const unitLabels = buckets.map((b) => b.label);
  const unitPartials = buckets.flatMap((b, i) => (b.partial ? [i] : []));
  const totalOf = (pick: (m: Ready["monthly"][number]) => number) => buckets.map((b) => (b.hasData ? b.indexes.reduce((sum, i) => sum + (monthly[i].hasData ? pick(monthly[i]) : 0), 0) : null));
  const received = totalOf((m) => m.received), spent = totalOf((m) => m.spent);
  // Kept needs review for a whole quarter or year when it does for any month of it.
  const keptSeries = buckets.map((b) => (!b.hasData || b.indexes.some((i) => monthly[i].hasData && monthly[i].kept === null) ? null : b.indexes.reduce((sum, i) => sum + (monthly[i].hasData ? (monthly[i].kept ?? 0) : 0), 0)));
  const keptReady = summary.moneyKept.state === "ready";
  const spentShare = summary.received > 0 ? Math.max(0, Math.min(100, (summary.spent / summary.received) * 100)) : null;
  const flows = summary.flows;
  const bridge = cashBridgeLines(summary);

  // ── Cash waterfalls: everyday movements, then loans on their own scale ──
  const line = (key: string) => bridge.lines.find((l) => l.key === key);
  const loanKeys = new Set(["repaid", "borrowed"]);
  const everyday = bridge.lines.filter((l) => !loanKeys.has(l.key));
  const beforeLoans = bridge.openingMinor + everyday.reduce((a, l) => a + l.amountMinor, 0) + bridge.unattributedMinor;
  const stepsA: WaterfallStep[] = [
    { key: "start", label: "Cash at start", kind: "total", amountMinor: bridge.openingMinor },
    ...everyday.map((l) => ({ key: l.key, label: l.label, kind: "delta" as const, amountMinor: l.amountMinor, note: l.key === "cashIncome" ? "Income in cash accounts: part of what is shown as received above" : l.key === "cashSpending" ? "Spending in cash accounts: part of what is shown as spent above" : l.key === "inTransit" ? "Transfers between cash accounts that do not net to zero. Select to see why each is here." : undefined })),
    ...(bridge.unattributedMinor !== 0 ? [{ key: "unattributed", label: "Unattributed", kind: "gap" as const, amountMinor: bridge.unattributedMinor, note: "Part of the change in cash that the steps do not explain. Shown, never forced to zero." }] : []),
    { key: "before", label: "Before loans", kind: "total", amountMinor: beforeLoans },
  ];
  const stepsB: WaterfallStep[] = [
    { key: "before", label: "Before loans", kind: "total", amountMinor: beforeLoans },
    ...(["repaid", "borrowed"] as const).flatMap((k) => { const l = line(k); return l ? [{ key: k, label: l.label, kind: "delta" as const, amountMinor: l.amountMinor }] : []; }),
    { key: "end", label: "Cash at end", kind: "total", amountMinor: bridge.closingMinor },
  ];
  const cashTarget = (key: string): DrillTarget | null => (CASH_DRILLS[key] ? { kind: CASH_DRILLS[key] } : key === "inTransit" ? { kind: "inTransit", cashOnly: true } : null);
  const cashRows: (string | number)[][] = [["Cash at the start", bridge.openingMinor], ...bridge.lines.map((l) => [l.label, l.amountMinor]), ["Unattributed", bridge.unattributedMinor], ["Cash at the end", bridge.closingMinor]];
  const reconciliation = (
    <table className="w-full max-w-2xl border-collapse text-xs">
      <tbody>
        {cashRows.map((r, i) => {
          const key = i === 0 || i === cashRows.length - 1 ? "" : i === cashRows.length - 2 ? "unattributed" : bridge.lines[i - 1].key;
          const target = cashTarget(key);
          const strong = i === 0 || i === cashRows.length - 1;
          return (
            <tr key={i} className={`border-b border-border/40 ${strong ? "font-semibold" : ""} ${key === "unattributed" && bridge.unattributedMinor !== 0 ? WARNING : ""}`}>
              <th scope="row" className="py-1.5 text-left font-normal">{r[0]}</th>
              <td className="text-right tabular-nums">{target ? <DrillLink label={`${r[0]} ${signedMoney(r[1] as number)}`} onClick={() => onDrill(target)}>{signedMoney(r[1] as number)}</DrillLink> : strong ? money(r[1] as number) : signedMoney(r[1] as number)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );

  const others = [
    { key: "uncategorizedIn", label: "Money in with no category", amount: flows.uncategorizedIn, note: "On-budget entries; counted as received.", target: { kind: "uncategorizedIn" } as DrillTarget },
    { key: "uncategorizedOut", label: "Money out with no category", amount: flows.uncategorizedOut, note: "On-budget entries; counted as spent.", target: { kind: "uncategorizedOut" } as DrillTarget },
    { key: "investmentResults", label: `Investment activity (${flows.investmentResultsCount})`, amount: flows.investmentResults, note: "No category, in investment and retirement accounts: price changes, dividends, interest and fees. Not income or spending.", target: { kind: "investmentResults" } as DrillTarget },
    { key: "unidentified", label: `Unidentified movements (${flows.unidentifiedCount})`, amount: flows.unidentified, note: "No category, in other off-budget accounts; not income or spending.", target: { kind: "unidentified" } as DrillTarget },
    { key: "valueChange", label: "Changes in value", amount: flows.valueChanges, note: "Classified in Assets; not income or spending.", target: { kind: "valueChange" } as DrillTarget },
    { key: "assetSale", label: "Asset sales", amount: flows.assetSales, note: "Linked in Assets; not income or spending.", target: { kind: "assetSale" } as DrillTarget },
    { key: "excludedTransfer", label: "Transfers with excluded accounts", amount: flows.excludedTransfers, note: "Change net worth; not income, spending or in transit.", target: { kind: "excludedTransfer" } as DrillTarget },
  ].filter((o) => o.amount !== 0);

  const flowTip = (i: number) => monthTip({
    title: unitLabels[i], partial: buckets[i].partial, partialNote: unit === "month" ? partialNote : `Partial ${names.one}: the period covers only part of it, or it includes the month still running.`,
    rows: [{ colour: "var(--fi-income)", name: "Received", value: money(received[i] ?? 0) }, { colour: "var(--fi-spend)", name: "Spent", value: money(spent[i] ?? 0) }, { colour: "var(--fi-kept)", name: "Kept", value: keptSeries[i] === null ? "Needs review" : signedMoney(keptSeries[i] as number) }],
    compare: { values: spent, index: i, label: "spending" },
    share: { part: spent[i] ?? 0, whole: summary.spent, of: "spending in the period" },
  });
  const flowFootnote = unitPartials.length === 0 ? "Select a bar to see its transactions."
    : unit === "month" ? `* ${unitLabels[unitPartials[0]]} is partial: it runs to ${formatDay(period.endDate)}, is drawn lighter with a dashed outline and is not compared with full months. Select a bar to see its transactions.`
    : `* ${unitPartials.map((i) => unitLabels[i]).join(" and ")} ${unitPartials.length === 1 ? "is" : "are"} partial: the period covers only part of ${unitPartials.length === 1 ? "it" : "them"} (${formatDay(period.startDate)} to ${formatDay(period.endDate)}), so ${unitPartials.length === 1 ? "it is" : "they are"} drawn lighter with a dashed outline and not compared with whole ${names.many}. Select a bar to see its transactions.`;

  return (
    <div className="space-y-4 p-4">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Tile label="Received" detail={<>Income in the period{comparison && <Delta now={comparison.current.received} before={comparison.previous.received} label={comparison.label} good="up" />}</>}><DrillLink smallDecimals label={`Received ${money(summary.received)}`} onClick={() => onDrill({ kind: "received" })}>{money(summary.received)}</DrillLink></Tile>
        <Tile label="Spent" detail={<>Refunds lower it; transfers are not spending{comparison && <Delta now={comparison.current.spent} before={comparison.previous.spent} label={comparison.label} good="down" />}</>}><DrillLink smallDecimals label={`Spent ${money(summary.spent)}`} onClick={() => onDrill({ kind: "spent" })}>{money(summary.spent)}</DrillLink></Tile>
        <Tile label="Kept from income" tone={keptReady ? undefined : "warning"} detail={summary.moneyKept.state === "ready" ? <>Received less spent{comparison && <Delta now={comparison.current.kept} before={comparison.previous.kept} label={comparison.label} good="up" />}</> : summary.moneyKept.reason}>
          {summary.moneyKept.state === "ready" ? money(summary.moneyKept.value) : "Needs review"}
        </Tile>
        <Tile label="Savings rate" tone={summary.savingsRate.state === "ready" ? undefined : "warning"}
          detail={summary.savingsRate.state === "ready" && spentShare !== null ? (
            <>
            <span className="block" role="img" aria-label={summary.spent > summary.received ? `Spent ${((summary.spent / summary.received) * 100).toFixed(1)} for every 100 received, nothing kept` : `Of every 100 received, ${spentShare.toFixed(1)} spent and ${(100 - spentShare).toFixed(1)} kept`}>
              <span className="flex h-1.5 overflow-hidden rounded-full bg-muted"><span className="h-full" style={{ width: `${spentShare}%`, background: "var(--fi-spend)" }} /><span className="h-full" style={{ width: `${100 - spentShare}%`, background: "var(--fi-income)" }} /></span>
              <span className="mt-1 block">{summary.spent > summary.received ? `Spent ${((summary.spent / summary.received) * 100).toFixed(1)} for every 100 received · nothing kept` : `Of every 100 received: ${spentShare.toFixed(1)} spent · ${(100 - spentShare).toFixed(1)} kept`}</span>
            </span>
            {comparison && comparison.current.received > 0 && comparison.previous.received > 0 && <Delta points now={(comparison.current.kept / comparison.current.received) * 100} before={(comparison.previous.kept / comparison.previous.received) * 100} label={comparison.label} good="up" />}
            </>
          ) : summary.savingsRate.state === "ready" ? "Kept ÷ received" : summary.savingsRate.reason}>
          {summary.savingsRate.state === "ready" ? percent(summary.savingsRate.value) : "Needs review"}
        </Tile>
        <Tile label="Change in cash" detail="Cash & bank, end of the period less the start">{signedMoney(summary.eligibleCash.change)}</Tile>
      </div>

      <ChartFrame
        id="money-in-out" title="Money in, money out" hint="Received above the line, spent below it" actions={<UnitPills value={unit} onChange={setUnit} label="Show money in and out by" />} subtitle={<><p>Received rises above the line and spent hangs below it; the dashed line is what was kept (received less spent). Nothing is stacked, so nothing is counted twice.{unit !== "month" && ` A ${names.one} adds up its months; it is a calendar ${names.one}, and one the period only partly covers is marked *.`}</p><p>Select a bar to see its transactions.</p></>}
        legend={[{ label: "Received", colour: "var(--fi-income)" }, { label: "Spent", colour: "var(--fi-spend)" }, { label: "Kept (received less spent)", colour: "var(--fi-kept)", line: true }]}
        table={{ head: [names.one[0].toUpperCase() + names.one.slice(1), "Received", "Spent", "Kept"], rows: buckets.map((b, i) => [unitLabels[i] + (b.partial ? " (partial)" : ""), received[i], spent[i], keptSeries[i]]) }} csvScope={scope}
        footnote={flowFootnote}
      >
        <FlowChart labels={unitLabels} partialIndex={unitPartials.length ? unitPartials : null} received={received} spent={spent} kept={keptSeries} tip={flowTip} onSelect={(i, series) => onDrill({ kind: series, month: buckets[i].first, throughMonth: buckets[i].last !== buckets[i].first ? buckets[i].last : undefined })} />
      </ChartFrame>

      <ChartFrame
        id="cash-change" title="Cash change, one step at a time"
        hint="Cash & bank, start to end of the period" subtitle={<><p>Cash &amp; bank from {formatDay(period.startDate)} to {formatDay(period.endDate)}, one step at a time.</p><p>Read it in two parts: part 2 (Loans) continues from the balance where part 1 (Everyday movements) ends, so borrowing cannot hide everyday movements. Select a step to see its transactions.</p></>}
        legend={[{ label: "Raises cash", colour: "var(--fi-up)" }, { label: "Lowers cash", colour: "var(--fi-down)" }, { label: "Balance", colour: "var(--fi-balance)" }, ...(bridge.unattributedMinor !== 0 ? [{ label: "Unattributed", colour: "var(--fi-gap)", dashed: true }] : [])]}
        table={{ head: ["Step", "Amount"], rows: cashRows }} csvScope={scope}
        detail={{ label: "Reconciliation table", content: reconciliation }}
        footnote={bridge.unattributedMinor === 0 ? "Nothing is left unattributed: the steps add up exactly to the change in cash." : <span className={WARNING}>{money(Math.abs(bridge.unattributedMinor))} of the change is not explained by the steps. Please review your accounts.</span>}
      >
        <div className="grid items-stretch gap-0 overflow-hidden rounded-md border border-border xl:grid-cols-[minmax(0,7fr)_auto_minmax(0,3fr)]">
          <div className="min-w-0 p-3">
            <p className="flex items-center gap-2 px-1 text-xs"><span className="inline-flex size-5 items-center justify-center rounded-full bg-foreground text-[11px] font-semibold text-background" aria-hidden>1</span><span className="font-medium">Everyday movements</span><span className="text-muted-foreground">Cash at start → Before loans</span></p>
            <Waterfall steps={stepsA} height={250} ariaLabel="Everyday cash movements" canSelect={(s) => cashTarget(s.key) !== null} onSelect={(s) => { const t = cashTarget(s.key); if (t) onDrill(t); }} />
          </div>
          <div className="flex items-center justify-center border-y border-dashed border-border bg-muted/40 px-1.5 xl:border-x xl:border-y-0" aria-hidden>
            <span className="flex size-7 items-center justify-center rounded-full border border-border bg-card text-muted-foreground"><ArrowRight className="size-4 max-xl:rotate-90" /></span>
          </div>
          <div className="min-w-0 bg-muted/30 p-3">
            <p className="flex items-center gap-2 px-1 text-xs"><span className="inline-flex size-5 items-center justify-center rounded-full bg-foreground text-[11px] font-semibold text-background" aria-hidden>2</span><span className="font-medium">Loans</span><span className="text-muted-foreground">Before loans → Cash at end</span></p>
            <Waterfall steps={stepsB} height={250} ariaLabel="Loan movements and cash at the end" canSelect={(s) => cashTarget(s.key) !== null} onSelect={(s) => { const t = cashTarget(s.key); if (t) onDrill(t); }} />
          </div>
        </div>
      </ChartFrame>

      <div className="grid items-stretch gap-4 xl:grid-cols-2">
        <InvestmentsFlow monthly={monthly} period={period} scope={scope} onDrill={onDrill} />
        <LoanPrincipalFlow monthly={monthly} period={period} scope={scope} onDrill={onDrill} />
      </div>

      <div className="grid items-stretch gap-4 xl:grid-cols-2">
        <DebtRepaymentsCard data={data} csvScope={scope} />
        <section className="flex h-full min-w-0 flex-col rounded-lg border border-border bg-card p-4" aria-label="Other movements">
          <CardTitle title="Other movements" hint="Not plain income or spending" info={<p>Entries that are not plain income or spending. They are all in your net worth.</p>} infoLabel="other movements" />
          {others.length === 0 ? <p className="mt-3 text-xs text-muted-foreground">There were none in this period.</p> : (
            <dl className="mt-2 divide-y divide-border/50 text-xs">
              {others.map((o) => (
                <div key={o.key} className="flex items-baseline justify-between gap-4 py-2">
                  <dt><span className="font-medium">{o.label}</span><span className="block text-muted-foreground">{o.note}</span></dt>
                  <dd className="text-base font-semibold tabular-nums"><DrillLink label={`${o.label} ${signedMoney(o.amount)}`} onClick={() => onDrill(o.target)}>{signedMoney(o.amount)}</DrillLink></dd>
                </div>
              ))}
            </dl>
          )}
        </section>
      </div>
    </div>
  );
}
