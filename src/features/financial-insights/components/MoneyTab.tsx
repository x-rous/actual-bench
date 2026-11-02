"use client";

import { ArrowRight, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { downloadCsv } from "@/lib/csv";
import { cashBridgeLines } from "@/lib/financial-insights/breakdowns";
import type { DrillKind, DrillTarget } from "@/lib/financial-insights/drill";
import { monthLabel } from "@/lib/financial-insights/period";
import type { FinancialInsightsView } from "../hooks/useFinancialInsights";
import { money, percent, signedMoney, formatDay } from "../format";
import { ChartFrame } from "./ChartFrame";
import { DrillLink } from "./DrillLink";
import { CardTitle } from "./InfoTip";
import { Tile } from "./Tile";
import { BarChart } from "./charts/BarChart";
import { FlowChart } from "./charts/FlowChart";
import { monthTip } from "./charts/monthTip";
import { Waterfall, type WaterfallStep } from "./charts/Waterfall";

type Ready = Extract<FinancialInsightsView["data"], { state: "ready" }>;
const WARNING = "text-amber-700 dark:text-amber-400";
/** The cash steps that open transactions, by the key of the step, and what each opens. */
const CASH_DRILLS: Record<string, DrillKind> = {
  operating: "cashOperating", card: "cardPaid", contributed: "contributed", withdrawn: "withdrawn", repaid: "repaid", borrowed: "borrowed",
  fixedDeposits: "fixedMoved", assets: "assetsMoved", liabilities: "liabilitiesMoved",
};

/** Debt repayments: recorded payments only, with principal (a repayment, not an expense) apart from interest and fees (expenses already in Spent). */
function DebtRepayments({ data, csvScope }: { data: Ready; csvScope: [string, string][] }) {
  const { debt } = data;
  const total = (p: number, i: number | null, f: number | null) => p + (i ?? 0) + (f ?? 0);
  const missing = debt.rows.some((r) => !r.tracked);
  const grand = total(debt.principalMinor, debt.interestMinor, debt.feesMinor);
  const parts = [
    { label: "Principal paid", value: debt.principalMinor, colour: "var(--fi-invest)", partial: false, hint: "Reduces what you owe" },
    { label: "Interest paid", value: debt.interestMinor, colour: "var(--fi-gap)", partial: !debt.complete, hint: "Cost of borrowing" },
    { label: "Fees paid", value: debt.feesMinor, colour: "var(--fi-g2)", partial: !debt.complete, hint: "Cost of borrowing" },
  ];
  const rows = [...debt.rows.map((r) => [r.name, r.principalMinor, r.interestMinor, r.feesMinor, total(r.principalMinor, r.interestMinor, r.feesMinor)] as (string | number | null)[]), ["Total recorded", debt.principalMinor, debt.interestMinor, debt.feesMinor, total(debt.principalMinor, debt.interestMinor, debt.feesMinor)]];
  const exportCsv = () => downloadCsv("financial-insights-debt-repayments.csv", [["Financial Insights", "Debt repayments"], ...csvScope, [], ["Loan", "Principal", "Interest", "Fees", "Total"], ...rows.map((r) => r.map((c) => (c === null ? "not identified" : typeof c === "number" ? (c / 100).toFixed(2) : c)))]);
  const cell = (v: number | null) => (v === null ? <span className={WARNING} title="Interest and fees of a loan that is not tracked in Loans cannot be told from other spending">not identified</span> : money(v));
  return (
    <section className="flex h-full min-w-0 flex-col rounded-lg border border-border bg-card" aria-label="Debt repayments">
      <header className="flex items-start justify-between gap-2 px-4 pt-3">
        <CardTitle title="Debt repayments" hint="Recorded payments in the period" info={<p>Principal reduces what you owe and is not an expense. Interest and fees are the cost of borrowing: expenses already counted in Spent.</p>} infoLabel="debt repayments" />
        <Button size="xs" variant="ghost" onClick={exportCsv} aria-label="Export Debt repayments as CSV"><Download className="size-3.5" aria-hidden />CSV</Button>
      </header>
      <div className="flex-1 px-4 py-2">
        {debt.rows.length > 0 && (
          <div className="pb-3">
            <div className="flex items-center gap-4">
            <p className="shrink-0 text-2xl font-semibold tabular-nums" aria-label={`Total loan payments ${money(grand)}${debt.complete ? "" : ", at least"}`}>{money(grand)}{debt.complete ? "" : "+"}</p>
            <div className="flex h-2.5 min-w-0 flex-1 gap-0.5 overflow-hidden rounded-full" role="img" aria-label={`Principal ${money(debt.principalMinor)}, interest ${money(debt.interestMinor)}, fees ${money(debt.feesMinor)}`}>
              {parts.filter((p) => p.value > 0).map((p) => <div key={p.label} style={{ flexGrow: p.value, backgroundColor: p.colour }} />)}
            </div>
            </div>
            {!debt.complete && <p className="mt-1 text-xs text-muted-foreground">A minimum: some loans are not tracked in Loans</p>}
            <dl className="mt-2 grid grid-cols-3 gap-3 text-xs">
              {parts.map((p) => (
                <div key={p.label} className="flex flex-wrap items-baseline gap-x-2" title={p.hint}>
                  <dt className="flex items-center gap-1.5 text-muted-foreground"><span className="size-2 rounded-full" style={{ backgroundColor: p.colour }} aria-hidden />{p.label}</dt>
                  <dd className="text-sm font-semibold tabular-nums">{money(p.value)}{p.partial ? "+" : ""}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}
        {debt.rows.length === 0 ? <p className="py-3 text-xs text-muted-foreground">No loan repayments were recorded in this period.</p> : (
          <table className="w-full border-collapse text-xs">
            <thead><tr className="border-b border-border text-muted-foreground"><th className="py-1.5 text-left font-medium">Loan</th><th className="text-right font-medium">Principal</th><th className="text-right font-medium">Interest</th><th className="text-right font-medium">Fees</th><th className="text-right font-medium">Total</th></tr></thead>
            <tbody>
              {debt.rows.map((r) => (
                <tr key={r.accountId} className="border-b border-border/40">
                  <th scope="row" className="max-w-56 py-1.5 text-left font-normal"><span className="flex items-baseline gap-2"><span className="truncate" title={r.name}>{r.name}</span><span className="shrink-0 text-[11px] text-muted-foreground">{r.tracked ? "tracked in Loans" : "not tracked"}</span></span></th>
                  <td className="text-right tabular-nums">{money(r.principalMinor)}</td><td className="text-right tabular-nums">{cell(r.interestMinor)}</td><td className="text-right tabular-nums">{cell(r.feesMinor)}</td>
                  <td className="text-right font-medium tabular-nums">{money(total(r.principalMinor, r.interestMinor, r.feesMinor))}{r.tracked ? "" : "+"}</td>
                </tr>
              ))}
              <tr className="font-semibold"><th scope="row" className="py-1.5 text-left">Total recorded</th><td className="text-right tabular-nums">{money(debt.principalMinor)}</td><td className="text-right tabular-nums">{money(debt.interestMinor)}</td><td className="text-right tabular-nums">{money(debt.feesMinor)}</td><td className="text-right tabular-nums">{money(total(debt.principalMinor, debt.interestMinor, debt.feesMinor))}{debt.complete ? "" : "+"}</td></tr>
            </tbody>
          </table>
        )}
      </div>
      <p className="border-t border-border/50 px-4 py-2 text-xs text-muted-foreground">
        {missing && <span>A loan marked &quot;not identified&quot; is not tracked in Loans, so its interest and fees cannot be separated from other spending; its total is a minimum. </span>}
        {debt.principalMinor !== debt.fromCashMinor && <span>{money(debt.principalMinor)} was paid into loan accounts in all; {money(debt.fromCashMinor)} of it left cash accounts and is what the cash change above calls loan principal repaid. The rest came from other accounts, such as cards. </span>}
        Interest and fees are already included in Spent; principal is not. Recorded payments only: nothing scheduled, and no interest that was only charged or capitalized, is counted.
      </p>
    </section>
  );
}

/** Money in & out: what came in, what went out, what was left, and how cash moved. */
export function MoneyTab({ data, onDrill }: { data: Ready; onDrill: (target: DrillTarget) => void }) {
  const { summary, monthly, period } = data;
  const scope: [string, string][] = [["Period", `${period.label}: ${formatDay(period.startDate)} to ${formatDay(period.endDate)}`], ["As of", formatDay(period.endDate)]];
  const labels = monthly.map((m) => monthLabel(m.month));
  const partial = monthly.findIndex((m) => m.partial) === -1 ? null : monthly.findIndex((m) => m.partial);
  const partialNote = `Partial month: it runs to ${formatDay(period.endDate)}.`;
  const gap = (i: number, v: number | null) => (monthly[i].hasData ? v : null);
  const received = monthly.map((m, i) => gap(i, m.received)), spent = monthly.map((m, i) => gap(i, m.spent)), keptSeries = monthly.map((m, i) => gap(i, m.kept));
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
    ...everyday.map((l) => ({ key: l.key, label: l.label, kind: "delta" as const, amountMinor: l.amountMinor, note: l.key === "operating" ? "Income and spending in cash accounts: shown as received and spent above" : l.key === "inTransit" ? "Transfers between cash accounts that do not net to zero. Select to see why each is here." : undefined })),
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
  const borrowedMonths = monthly.flatMap((m, i) => (m.borrowed > 0 ? [{ i, amount: m.borrowed }] : []));

  const flowTip = (i: number) => {
    const m = monthly[i];
    return monthTip({
      title: labels[i], partial: m.partial, partialNote,
      rows: [{ colour: "var(--fi-income)", name: "Received", value: money(m.received) }, { colour: "var(--fi-spend)", name: "Spent", value: money(m.spent) }, { colour: "var(--fi-kept)", name: "Kept", value: m.kept === null ? "Needs review" : signedMoney(m.kept) }],
      compare: { values: monthly.map((x) => (x.hasData ? x.spent : null)), index: i, label: "spending" },
      share: { part: m.spent, whole: summary.spent, of: "spending in the period" },
    });
  };

  return (
    <div className="space-y-4 p-4">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Tile label="Received" detail="Income in the period"><DrillLink smallDecimals label={`Received ${money(summary.received)}`} onClick={() => onDrill({ kind: "received" })}>{money(summary.received)}</DrillLink></Tile>
        <Tile label="Spent" detail="Refunds lower it; transfers are not spending"><DrillLink smallDecimals label={`Spent ${money(summary.spent)}`} onClick={() => onDrill({ kind: "spent" })}>{money(summary.spent)}</DrillLink></Tile>
        <Tile label="Kept from income" tone={keptReady ? undefined : "warning"} detail={summary.moneyKept.state === "ready" ? "Received less spent" : summary.moneyKept.reason}>
          {summary.moneyKept.state === "ready" ? money(summary.moneyKept.value) : "Needs review"}
        </Tile>
        <Tile label="Savings rate" tone={summary.savingsRate.state === "ready" ? undefined : "warning"}
          detail={summary.savingsRate.state === "ready" && spentShare !== null ? (
            <span className="block" role="img" aria-label={`Of every 100 received, ${spentShare.toFixed(1)} spent and ${(100 - spentShare).toFixed(1)} kept`}>
              <span className="flex h-1.5 overflow-hidden rounded-full bg-muted"><span className="h-full" style={{ width: `${spentShare}%`, background: "var(--fi-spend)" }} /><span className="h-full" style={{ width: `${100 - spentShare}%`, background: "var(--fi-income)" }} /></span>
              <span className="mt-1 block">Of every 100 received: {spentShare.toFixed(1)} spent · {(100 - spentShare).toFixed(1)} kept</span>
            </span>
          ) : summary.savingsRate.state === "ready" ? "Kept ÷ received" : summary.savingsRate.reason}>
          {summary.savingsRate.state === "ready" ? percent(summary.savingsRate.value) : "Needs review"}
        </Tile>
        <Tile label="Change in cash" detail="Cash & bank, end of the period less the start">{signedMoney(summary.eligibleCash.change)}</Tile>
      </div>

      <ChartFrame
        id="money-in-out" title="Money in, money out" hint="Received above the line, spent below it" subtitle={<><p>Received rises above the line and spent hangs below it; the dashed line is what was kept (received less spent). Nothing is stacked, so nothing is counted twice.</p><p>Select a bar to see its transactions.</p></>}
        legend={[{ label: "Received", colour: "var(--fi-income)" }, { label: "Spent", colour: "var(--fi-spend)" }, { label: "Kept (received less spent)", colour: "var(--fi-kept)", line: true }]}
        table={{ head: ["Month", "Received", "Spent", "Kept"], rows: monthly.map((m, i) => [labels[i] + (m.partial ? " (partial)" : ""), received[i], spent[i], keptSeries[i]]) }} csvScope={scope}
        footnote={partial !== null ? `* ${labels[partial]} is partial: it runs to ${formatDay(period.endDate)}, is drawn lighter with a dashed outline and is not compared with full months. Select a bar to see its transactions.` : "Select a bar to see its transactions."}
      >
        <FlowChart labels={labels} partialIndex={partial} received={received} spent={spent} kept={keptSeries} tip={flowTip} onSelect={(i, series) => onDrill({ kind: series, month: monthly[i].month })} />
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
        <ChartFrame id="investments" title="Investments" hint="Between your cash accounts and investments, each month"
          legend={[{ label: "Put into investments", colour: "var(--fi-invest)" }, { label: "Withdrawn from investments", colour: "var(--fi-income)" }]}
          table={{ head: ["Month", "Put into investments", "Withdrawn"], rows: monthly.map((m, i) => [labels[i], gap(i, m.contributed), gap(i, m.withdrawn)]) }} csvScope={scope}>
          <BarChart labels={labels} partialIndex={partial} height={210} ariaLabel="Money put into and withdrawn from investments"
            series={[{ key: "in", label: "Put into investments", colour: "var(--fi-invest)", values: monthly.map((m, i) => gap(i, m.contributed)) }, { key: "out", label: "Withdrawn from investments", colour: "var(--fi-income)", values: monthly.map((m, i) => gap(i, m.withdrawn)) }]}
            tip={(i) => monthTip({ title: labels[i], partial: monthly[i].partial, partialNote, rows: [{ colour: "var(--fi-invest)", name: "Put into investments", value: money(monthly[i].contributed) }, { colour: "var(--fi-income)", name: "Withdrawn", value: money(monthly[i].withdrawn) }] })}
            onSelect={(i, k) => onDrill({ kind: k === 0 ? "contributed" : "withdrawn", month: monthly[i].month })} />
        </ChartFrame>
        <ChartFrame id="loan-principal" title="Loan principal repaid" hint="Left your cash accounts for loans, each month" subtitle={<p>Borrowing is listed below the chart, not drawn.</p>}
          legend={[{ label: "Loan principal repaid", colour: "var(--fi-loan)" }]}
          table={{ head: ["Month", "Loan principal repaid", "Borrowed"], rows: monthly.map((m, i) => [labels[i], gap(i, m.repaid), gap(i, m.borrowed)]) }} csvScope={scope}>
          <BarChart labels={labels} partialIndex={partial} height={210} ariaLabel="Loan principal repaid each month"
            series={[{ key: "repaid", label: "Loan principal repaid", colour: "var(--fi-loan)", values: monthly.map((m, i) => gap(i, m.repaid)) }]}
            tip={(i) => monthTip({ title: labels[i], partial: monthly[i].partial, partialNote, rows: [{ colour: "var(--fi-loan)", name: "Loan principal repaid", value: money(monthly[i].repaid) }, ...(monthly[i].borrowed ? [{ name: "◆ Borrowed that month", value: money(monthly[i].borrowed) }] : [])], compare: { values: monthly.map((m) => (m.hasData ? m.repaid : null)), index: i, label: "repaid" } })}
            onSelect={(i) => onDrill({ kind: "repaid", month: monthly[i].month })} />
          {borrowedMonths.length > 0 && (
            <ul className="mt-1 divide-y divide-border/50 text-xs">
              {borrowedMonths.map((b) => <li key={b.i} className="flex justify-between gap-3 py-1"><span>◆ {labels[b.i]} · borrowed (received from loans)</span><DrillLink label={`Borrowed ${labels[b.i]} ${money(b.amount)}`} onClick={() => onDrill({ kind: "borrowed", month: monthly[b.i].month })}>{money(b.amount)}</DrillLink></li>)}
            </ul>
          )}
        </ChartFrame>
      </div>

      <div className="grid items-stretch gap-4 xl:grid-cols-2">
        <DebtRepayments data={data} csvScope={scope} />
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
