"use client";

import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { downloadCsv } from "@/lib/csv";
import { whereMoneyWent, type MoneyWentLine } from "@/lib/financial-insights/breakdowns";
import type { DrillTarget } from "@/lib/financial-insights/drill";
import type { FinancialInsightsView } from "../hooks/useFinancialInsights";
import { money, percent, signedMoney } from "../format";
import { DrillLink } from "./DrillLink";
import { CardTitle, InfoTip } from "./InfoTip";

type Ready = Extract<FinancialInsightsView["data"], { state: "ready" }>;

const OTHER_NOTE = "What the lines above don't explain: income or spending in other accounts, unidentified entries, debt paid from investments, and transfers whose two sides fall in different periods.";
/** What each line means in plain words, for the (i) beside it. */
const EXPLAIN: Record<MoneyWentLine["key"], string> = {
  spent: "What you spent on things: purchases and other costs, including interest and fees a lender charged. Refunds are taken off. Select the amount to see the transactions.",
  debtRepaid: "The part of your loan payments that lowered what you owe. Interest and fees are not in it: they count as spent. Select the amount to see the transactions.",
  borrowed: "Money that came in as a loan. It is shown negative because it was not earned, but it gave you cash. Select the amount to see the transactions.",
  invested: "Money you moved into investments, less what you took back out. Look at the Investments tab for the accounts.",
  depositsAndAssets: "Money moved into fixed deposits, property, vehicles and other assets or liabilities, including accounts left out of Financial Insights.",
  cards: "How much your credit card balances changed. Negative means you owe more than before: you used the cards instead of cash.",
  cash: "How much your cash & bank balance went up (positive) or down (negative) over the period. This is where the money you kept in cash ended up.",
  other: OTHER_NOTE,
};
const COLOUR: Record<MoneyWentLine["key"], string> = {
  spent: "var(--fi-spend)", debtRepaid: "var(--fi-invest)", borrowed: "var(--fi-loan)", invested: "var(--fi-invest)", depositsAndAssets: "var(--fi-g2)", cards: "var(--fi-gap)", cash: "var(--fi-cash)", other: "var(--fi-balance)",
};

/**
 * Where your money went: what was received, split into the uses it went to, in parts that add up to it exactly. Every line is an
 * existing figure (see `whereMoneyWent`); this card only presents them. Spent, Debt repaid and Borrowed open their transactions.
 */
export function WhereMoneyWentCard({ data, csvScope, onDrill }: { data: Ready; csvScope: [string, string][]; onDrill: (target: DrillTarget) => void }) {
  const { receivedMinor, lines } = whereMoneyWent(data.summary, data.debt);
  // Zero lines are left out, except the two that answer the question on their own: what was spent and how cash moved.
  const shown = lines.filter((l) => l.amountMinor !== 0 || l.key === "spent" || l.key === "cash");
  const share = (minor: number) => (receivedMinor > 0 ? percent((minor / receivedMinor) * 100) : "");
  // The bar cannot draw a negative line (money that came in), so it is left out then; the table stays and says it all.
  const bar = shown.some((l) => l.amountMinor < 0) ? [] : shown.filter((l) => l.amountMinor > 0);
  const exportCsv = () => downloadCsv("financial-insights-where-your-money-went.csv", [
    ["Financial Insights", "Where your money went"], ...csvScope, [],
    ["Line", "Amount", "Share of received"],
    ["Received", (receivedMinor / 100).toFixed(2), receivedMinor > 0 ? "100.0%" : ""],
    ...shown.map((l) => [l.label, (l.amountMinor / 100).toFixed(2), share(l.amountMinor)]),
  ]);
  return (
    <section className="flex min-w-0 flex-col rounded-lg border border-border bg-card" aria-label="Where your money went">
      <header className="flex items-start justify-between gap-2 px-4 pt-3">
        <CardTitle title="Where your money went" hint="What you received, and what it ended up as"
          info={<><p>Start with <b>Received</b>: everything that came in during the period. Each line below is one thing that money became: spent, paid to your loans, put into investments, kept as cash, and so on. Together with Other they add up to Received exactly.</p><p>A negative line brought money in: you borrowed, or you owe more on cards. What you kept is everything except Spent.</p></>} infoLabel="where your money went" />
        <Button size="xs" variant="ghost" onClick={exportCsv} aria-label="Export Where your money went as CSV"><Download className="size-3.5" aria-hidden />CSV</Button>
      </header>
      <p className="px-4 pt-1 text-xs text-muted-foreground">Everything you received, split into what it became. The lines add up to the amount received. Select an underlined amount to see its transactions; select (i) to see what a line means.</p>
      <div className="px-4 py-2">
        <div className="flex items-baseline gap-3 pb-2">
          <span className="text-xs text-muted-foreground">Received</span>
          <span className="text-2xl font-semibold tabular-nums">{money(receivedMinor)}</span>
        </div>
        {receivedMinor > 0 && bar.length > 0 && (
          <div className="mb-3 flex h-2.5 gap-0.5 overflow-hidden rounded-full" role="img" aria-label={`Of ${money(receivedMinor)} received: ${bar.map((l) => `${l.label} ${money(l.amountMinor)}`).join(", ")}`}>
            {bar.map((l) => <div key={l.key} style={{ flexGrow: l.amountMinor, backgroundColor: COLOUR[l.key] }} />)}
          </div>
        )}
        <table className="w-full border-collapse text-xs">
          <thead><tr className="border-b border-border text-muted-foreground"><th className="py-1.5 text-left font-medium">Went to</th><th className="text-right font-medium">Amount</th><th className="w-24 text-right font-medium">Share of received</th></tr></thead>
          <tbody>
            {shown.map((l) => (
              <tr key={l.key} className="border-b border-border/40">
                <th scope="row" className="py-1.5 text-left font-normal whitespace-nowrap">
                  <span className="inline-flex items-center gap-2"><span className="size-2.5 shrink-0 rounded-sm" style={{ background: COLOUR[l.key] }} aria-hidden />{l.label}</span>
                  <span className="ml-1 inline-flex align-middle"><InfoTip label={`${l.label} in where your money went`}><p>{EXPLAIN[l.key]}</p></InfoTip></span>
                </th>
                <td className="text-right tabular-nums">
                  {l.key === "spent"
                    ? <DrillLink label={`Spent ${money(l.amountMinor)}`} onClick={() => onDrill({ kind: "spent" })}>{money(l.amountMinor)}</DrillLink>
                    : l.key === "debtRepaid" && l.amountMinor !== 0
                    ? <DrillLink label={`${l.label} ${money(l.amountMinor)}`} onClick={() => onDrill({ kind: "loanPrincipal" })}>{money(l.amountMinor)}</DrillLink>
                    : l.key === "borrowed" && l.amountMinor !== 0
                    ? <DrillLink label={`${l.label} ${signedMoney(l.amountMinor)}`} onClick={() => onDrill({ kind: "borrowed" })}>{signedMoney(l.amountMinor)}</DrillLink>
                    : l.key === "cash" || l.key === "other" || l.key === "cards" || l.key === "borrowed" ? signedMoney(l.amountMinor) : money(l.amountMinor)}
                </td>
                <td className="text-right tabular-nums text-muted-foreground">{share(l.amountMinor)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="border-t border-border/50 px-4 py-2 text-xs text-muted-foreground">Money kept is everything here except Spent. Only the lines with transactions behind them open a list; the others are changes in balances.</p>
    </section>
  );
}
