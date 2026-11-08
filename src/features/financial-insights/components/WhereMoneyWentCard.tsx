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
const COLOUR: Record<MoneyWentLine["key"], string> = {
  spent: "var(--fi-spend)", debtRepaid: "var(--fi-invest)", borrowed: "var(--fi-loan)", invested: "var(--fi-invest)", depositsAndAssets: "var(--fi-g2)", cards: "var(--fi-gap)", cash: "var(--fi-cash)", other: "var(--fi-balance)",
};

/**
 * Where your money went: what was received, split into the uses it went to, in parts that add up to it exactly. Every line is an
 * existing figure (see `whereMoneyWent`); this card only presents them. Only Spent opens transactions.
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
        <CardTitle title="Where your money went" hint="What was received, and what it went to"
          info={<p>Each line is a figure already on this page. Together with Other they add up to what you received. A negative line brought money in: you borrowed, or you owe more on cards.</p>} infoLabel="where your money went" />
        <Button size="xs" variant="ghost" onClick={exportCsv} aria-label="Export Where your money went as CSV"><Download className="size-3.5" aria-hidden />CSV</Button>
      </header>
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
                  {l.key === "other" && <span className="ml-1 inline-flex align-middle"><InfoTip label="Other in where your money went"><p>{OTHER_NOTE}</p></InfoTip></span>}
                </th>
                <td className="text-right tabular-nums">
                  {l.key === "spent"
                    ? <DrillLink label={`Spent ${money(l.amountMinor)}`} onClick={() => onDrill({ kind: "spent" })}>{money(l.amountMinor)}</DrillLink>
                    : l.key === "cash" || l.key === "other" || l.key === "cards" || l.key === "borrowed" ? signedMoney(l.amountMinor) : money(l.amountMinor)}
                </td>
                <td className="text-right tabular-nums text-muted-foreground">{share(l.amountMinor)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="border-t border-border/50 px-4 py-2 text-xs text-muted-foreground">Money kept is everything here except Spent.</p>
    </section>
  );
}
