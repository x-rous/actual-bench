"use client";

import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { downloadCsv } from "@/lib/csv";
import { moneyInOut, type MoneyFlowKey, type MoneyFlowLine } from "@/lib/financial-insights/breakdowns";
import type { DrillTarget } from "@/lib/financial-insights/drill";
import type { FinancialInsightsView } from "../hooks/useFinancialInsights";
import { money, percent } from "../format";
import { DrillLink } from "./DrillLink";
import { CardTitle, InfoTip } from "./InfoTip";

type Ready = Extract<FinancialInsightsView["data"], { state: "ready" }>;

const OTHER_NOTE = "What the lines don't explain: income or spending in other accounts, unidentified entries, debt paid from investments, and transfers whose two sides fall in different periods.";
/** What each line means in plain words, for the (i) beside it. */
const EXPLAIN: Record<MoneyFlowKey, string> = {
  received: "Everything that came in as income during the period. Transfers between your own accounts are not income. Select the amount to see the transactions.",
  borrowed: "Money that came in as a loan. It was not earned, but it gave you cash to use. Select the amount to see the transactions.",
  moreOwedCards: "How much more you owe on your credit cards than at the start. You used the cards instead of cash, so that money came in.",
  withdrawn: "Money you took out of investments, less what you put in.",
  released: "Money that came back from fixed deposits, property, vehicles and other assets or liabilities, including accounts left out of Financial Insights.",
  fromCash: "Your cash & bank balance went down over the period, so some of what you used came out of cash you already had.",
  addedToLoans: "Interest and fees charged to your loans were more than you paid in, so what you owe grew.",
  refunds: "Refunds were larger than what you spent.",
  otherIn: OTHER_NOTE,
  incomeReversed: "Income that was paid back or reversed was more than the income received, so the net went back out. Select the amount to see the transactions.",
  spent: "What you spent on things: purchases and other costs, including interest and fees a lender charged. Refunds are taken off. Select the amount to see the transactions.",
  debtRepaid: "The part of your loan payments that lowered what you owe. Interest and fees are not in it: they count as spent. Select the amount to see the transactions.",
  borrowingPaidBack: "Borrowing that went back out.",
  invested: "Money you moved into investments, less what you took back out. See the Investments tab for the accounts.",
  depositsAndAssets: "Money moved into fixed deposits, property, vehicles and other assets or liabilities, including accounts left out of Financial Insights.",
  cardsPaid: "Your credit card balances went down over the period: you paid the cards down.",
  cash: "Your cash & bank balance went up over the period. This is the money that stayed in cash.",
  otherOut: OTHER_NOTE,
};
const COLOUR: Record<MoneyFlowKey, string> = {
  received: "var(--fi-income)", borrowed: "var(--fi-loan)", moreOwedCards: "var(--fi-gap)", withdrawn: "var(--fi-invest)", released: "var(--fi-g2)", fromCash: "var(--fi-cash)", addedToLoans: "var(--fi-loan)", refunds: "var(--fi-income)", otherIn: "var(--fi-balance)",
  incomeReversed: "var(--fi-spend)", spent: "var(--fi-spend)", debtRepaid: "var(--fi-invest)", borrowingPaidBack: "var(--fi-loan)", invested: "var(--fi-invest)", depositsAndAssets: "var(--fi-g2)", cardsPaid: "var(--fi-gap)", cash: "var(--fi-cash)", otherOut: "var(--fi-balance)",
};
/** The transactions behind a line, where it has any; the others are changes in balances. */
const DRILL: Partial<Record<MoneyFlowKey, DrillTarget>> = { received: { kind: "received" }, incomeReversed: { kind: "received" }, borrowed: { kind: "borrowed" }, spent: { kind: "spent" }, debtRepaid: { kind: "loanPrincipal" } };

/**
 * Where your money came from and where it went: two lists that total the same. Money in starts with what was received and adds
 * borrowing and anything drawn from balances; money out is what was spent, paid to loans, put away or left in cash. Every line is an
 * existing figure (see `moneyInOut`); this card only presents them. Received, Spent, Debt repaid and Borrowed open their transactions.
 */
export function WhereMoneyWentCard({ data, csvScope, onDrill }: { data: Ready; csvScope: [string, string][]; onDrill: (target: DrillTarget) => void }) {
  const { sources, uses, totalMinor } = moneyInOut(data.summary, data.debt);
  const share = (minor: number) => (totalMinor > 0 ? percent((minor / totalMinor) * 100) : "");
  const exportCsv = () => downloadCsv("financial-insights-where-your-money-went.csv", [
    ["Financial Insights", "Where your money came from and went"], ...csvScope, [],
    ["Side", "Line", "Amount", "Share of total"],
    ...sources.map((l) => ["Money in", l.label, (l.amountMinor / 100).toFixed(2), share(l.amountMinor)]),
    ["Money in", "Total", (totalMinor / 100).toFixed(2), "100.0%"],
    ...uses.map((l) => ["Money out", l.label, (l.amountMinor / 100).toFixed(2), share(l.amountMinor)]),
    ["Money out", "Total", (totalMinor / 100).toFixed(2), "100.0%"],
  ]);
  const column = (title: string, hint: string, lines: MoneyFlowLine[]) => (
    <div className="min-w-0" role="group" aria-label={title}>
      <div className="flex items-baseline justify-between gap-2 border-b border-border pb-1.5">
        <h3 className="text-sm font-semibold">{title}</h3>
        <span className="text-[11px] text-muted-foreground">{hint}</span>
      </div>
      <table className="w-full border-collapse text-xs">
        <thead className="sr-only"><tr><th scope="col">Line</th><th scope="col">Amount</th><th scope="col">Share of total</th></tr></thead>
        <tbody>
          {lines.length === 0 && <tr><td className="py-3 text-muted-foreground" colSpan={3}>Nothing in this period.</td></tr>}
          {lines.map((l) => {
            const target = DRILL[l.key];
            return (
              <tr key={l.key + l.label} className="border-b border-border/40">
                <th scope="row" className="py-1.5 text-left font-normal">
                  <span className="inline-flex items-center gap-2"><span className="size-2.5 shrink-0 rounded-sm" style={{ background: COLOUR[l.key] }} aria-hidden />{l.label}</span>
                  <span className="ml-1 inline-flex align-middle"><InfoTip label={`${l.label} in where your money went`}><p>{EXPLAIN[l.key]}</p></InfoTip></span>
                </th>
                <td className="whitespace-nowrap text-right tabular-nums">{target ? <DrillLink label={`${l.label} ${money(l.amountMinor)}`} onClick={() => onDrill(target)}>{money(l.amountMinor)}</DrillLink> : money(l.amountMinor)}</td>
                <td className="w-14 text-right tabular-nums text-muted-foreground">{share(l.amountMinor)}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t border-border font-semibold"><th scope="row" className="py-1.5 text-left">Total {title.toLowerCase()}</th><td className="text-right tabular-nums">{money(totalMinor)}</td><td /></tr>
        </tfoot>
      </table>
    </div>
  );
  return (
    <section className="flex min-w-0 flex-col rounded-lg border border-border bg-card" aria-label="Where your money went">
      <header className="flex items-start justify-between gap-2 px-4 pt-3">
        <CardTitle title="Where your money came from and went" hint="Money in and money out, both adding up to the same total"
          info={<><p><b>Money in</b> starts with what you received. It adds anything else that gave you money to use: loans you took, more owed on cards, or money drawn from your cash, investments or deposits.</p><p><b>Money out</b> is what you did with it: spent it, paid off loans, put it into investments or deposits, paid cards down, or left it in cash. Both sides add up to the same total. Other is whatever they do not explain.</p></>} infoLabel="where your money came from and went" />
        <Button size="xs" variant="ghost" onClick={exportCsv} aria-label="Export Where your money went as CSV"><Download className="size-3.5" aria-hidden />CSV</Button>
      </header>
      <div className="grid gap-x-8 gap-y-5 px-4 py-3 md:grid-cols-2">
        {column("Money in", "where it came from", sources)}
        {column("Money out", "what happened to it", uses)}
      </div>
      <p className="border-t border-border/50 px-4 py-2 text-xs text-muted-foreground">Both sides add up to the same total. Paying off loan principal is money out, not spending: it lowers what you owe. Select an underlined amount to see its transactions; select (i) to see what a line means.</p>
    </section>
  );
}
