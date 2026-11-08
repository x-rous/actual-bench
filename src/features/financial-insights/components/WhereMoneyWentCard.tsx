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

/** The lines the kept money went to, the lines that brought money in besides income, and the rest, in the order the card reads them. */
const USED: MoneyWentLine["key"][] = ["debtRepaid", "invested", "depositsAndAssets", "cash"];
const FUNDED: MoneyWentLine["key"][] = ["borrowed", "cards"];

/**
 * Where your money went, in the order a person reads it: what was received, less what was spent, is what was kept; then what the
 * kept money did (paid loans, went into investments, deposits or cash), and the borrowing and card use that funded some of it.
 * Every line is an existing figure (see `whereMoneyWent`) and the lines add up to what was kept exactly. Spent, Debt repaid and
 * Borrowed open their transactions.
 */
export function WhereMoneyWentCard({ data, csvScope, onDrill }: { data: Ready; csvScope: [string, string][]; onDrill: (target: DrillTarget) => void }) {
  const { receivedMinor, lines } = whereMoneyWent(data.summary, data.debt);
  const line = (key: MoneyWentLine["key"]) => lines.find((l) => l.key === key)!;
  const spentMinor = line("spent").amountMinor;
  const keptMinor = receivedMinor - spentMinor;
  const share = (minor: number) => (receivedMinor > 0 ? percent((minor / receivedMinor) * 100) : "");
  // Zero lines are left out, except how cash moved, which answers the question on its own.
  const used = USED.map(line).filter((l) => l.amountMinor !== 0 || l.key === "cash");
  const funded = FUNDED.map(line).filter((l) => l.amountMinor !== 0);
  const other = line("other");
  const exportCsv = () => downloadCsv("financial-insights-where-your-money-went.csv", [
    ["Financial Insights", "Where your money went"], ...csvScope, [],
    ["Line", "Amount", "Share of received"],
    ["Received", (receivedMinor / 100).toFixed(2), receivedMinor > 0 ? "100.0%" : ""],
    ["Spent", (spentMinor / 100).toFixed(2), share(spentMinor)],
    ["Kept (received less spent)", (keptMinor / 100).toFixed(2), share(keptMinor)],
    ...[...used, ...funded, ...(other.amountMinor !== 0 ? [other] : [])].map((l) => [l.label, (l.amountMinor / 100).toFixed(2), share(l.amountMinor)]),
  ]);
  const amount = (l: MoneyWentLine) => l.key === "debtRepaid" && l.amountMinor !== 0
    ? <DrillLink label={`${l.label} ${signedMoney(l.amountMinor)}`} onClick={() => onDrill({ kind: "loanPrincipal" })}>{signedMoney(l.amountMinor)}</DrillLink>
    : l.key === "borrowed" && l.amountMinor !== 0
    ? <DrillLink label={`${l.label} ${signedMoney(l.amountMinor)}`} onClick={() => onDrill({ kind: "borrowed" })}>{signedMoney(l.amountMinor)}</DrillLink>
    : signedMoney(l.amountMinor);
  const row = (l: MoneyWentLine) => (
    <tr key={l.key} className="border-b border-border/40">
      <th scope="row" className="py-1.5 pl-3 text-left font-normal whitespace-nowrap">
        <span className="inline-flex items-center gap-2"><span className="size-2.5 shrink-0 rounded-sm" style={{ background: COLOUR[l.key] }} aria-hidden />{l.label}</span>
        <span className="ml-1 inline-flex align-middle"><InfoTip label={`${l.label} in where your money went`}><p>{EXPLAIN[l.key]}</p></InfoTip></span>
      </th>
      <td className="text-right tabular-nums">{amount(l)}</td>
    </tr>
  );
  const heading = (text: string, note: string) => (
    <tr key={text} className="bg-muted/30"><th colSpan={2} scope="colgroup" className="px-3 py-1.5 text-left font-medium">{text} <span className="font-normal text-muted-foreground">{note}</span></th></tr>
  );
  return (
    <section className="flex min-w-0 flex-col rounded-lg border border-border bg-card" aria-label="Where your money went">
      <header className="flex items-start justify-between gap-2 px-4 pt-3">
        <CardTitle title="Where your money went" hint="Received, less spent, is what you kept"
          info={<><p>Read it from the top: what you <b>received</b>, less what you <b>spent</b>, is what you <b>kept</b>. Below that, the kept money is shown as what it did: paid down loans, went into investments or deposits, or stayed in cash.</p><p>Borrowing and card use are shown as negative lines: they brought money in that was not income, so they are taken off. Together the lines add up to what you kept exactly. Other is whatever they do not explain.</p></>} infoLabel="where your money went" />
        <Button size="xs" variant="ghost" onClick={exportCsv} aria-label="Export Where your money went as CSV"><Download className="size-3.5" aria-hidden />CSV</Button>
      </header>
      <div className="px-4 py-3">
        <dl className="flex flex-wrap items-end gap-x-6 gap-y-2" aria-label="Received, spent and kept">
          <div><dt className="text-xs text-muted-foreground">Received</dt><dd className="text-2xl font-semibold tabular-nums">{money(receivedMinor)}</dd></div>
          <div className="pb-0.5 text-xl text-muted-foreground" aria-hidden>−</div>
          <div>
            <dt className="text-xs text-muted-foreground">Spent{receivedMinor > 0 ? ` · ${share(spentMinor)}` : ""}</dt>
            <dd className="text-2xl font-semibold tabular-nums"><DrillLink label={`Spent ${money(spentMinor)}`} onClick={() => onDrill({ kind: "spent" })}>{money(spentMinor)}</DrillLink></dd>
          </div>
          <div className="pb-0.5 text-xl text-muted-foreground" aria-hidden>=</div>
          <div>
            <dt className="text-xs text-muted-foreground">Kept{receivedMinor > 0 ? ` · ${share(keptMinor)}` : ""}</dt>
            <dd className="text-2xl font-semibold tabular-nums">{keptMinor < 0 ? signedMoney(keptMinor) : money(keptMinor)}</dd>
          </div>
        </dl>
        {receivedMinor > 0 && keptMinor >= 0 && spentMinor >= 0 && (
          <div className="mt-3 flex h-2.5 gap-0.5 overflow-hidden rounded-full" role="img" aria-label={`Of ${money(receivedMinor)} received: spent ${money(spentMinor)}, kept ${money(keptMinor)}`}>
            {spentMinor > 0 && <div style={{ flexGrow: spentMinor, backgroundColor: COLOUR.spent }} />}
            {keptMinor > 0 && <div style={{ flexGrow: keptMinor, backgroundColor: COLOUR.cash }} />}
          </div>
        )}
        <p className="mt-2 text-xs text-muted-foreground">{keptMinor < 0 ? "You spent more than you received. Below is how that was covered." : "Below is what the money you kept did."} A <b>+</b> line adds to what you kept; a <b>−</b> line takes away from it. Select an underlined amount to see its transactions; select (i) to see what a line means.</p>
        <table className="mt-2 w-full border-collapse text-xs">
          <thead className="sr-only"><tr><th scope="col">Line</th><th scope="col">Amount</th></tr></thead>
          <tbody>
            {heading(keptMinor < 0 ? "How it was covered" : "Where the kept money went", "")}
            {used.map(row)}
            {funded.length > 0 && heading("Money that came from borrowing and cards", "· not income, so it is taken off")}
            {funded.map(row)}
            {other.amountMinor !== 0 && heading("Not explained", "")}
            {other.amountMinor !== 0 && row(other)}
            <tr className="border-t border-border"><th scope="row" className="py-1.5 pl-3 text-left font-semibold">Kept (received less spent)</th><td className="text-right font-semibold tabular-nums">{keptMinor < 0 ? signedMoney(keptMinor) : money(keptMinor)}</td></tr>
          </tbody>
        </table>
      </div>
      <p className="border-t border-border/50 px-4 py-2 text-xs text-muted-foreground">The lines above add up to what you kept. Spent, Debt repaid and Borrowed open their transactions; the others are changes in balances.</p>
    </section>
  );
}
