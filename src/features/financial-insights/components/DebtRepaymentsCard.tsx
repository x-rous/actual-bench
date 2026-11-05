"use client";

import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { downloadCsv } from "@/lib/csv";
import type { FinancialInsightsView } from "../hooks/useFinancialInsights";
import { money } from "../format";
import { CardTitle } from "./InfoTip";

type Ready = Extract<FinancialInsightsView["data"], { state: "ready" }>;
const WARNING = "text-amber-700 dark:text-amber-400";

/** Loan repayments: recorded payments only, with principal (a repayment, not an expense) apart from interest and fees (expenses already in Spent). */
/** What the loans' saved schedules say is due in the next twelve months (Loans & cards only). */
export type UpcomingLoans = { loans: number; scheduled: number; toReview: number; principalMinor: number; costMinor: number };

export function DebtRepaymentsCard({ data, csvScope, upcoming }: { data: Ready; csvScope: [string, string][]; upcoming?: UpcomingLoans }) {
  const { debt } = data;
  const total = (p: number, i: number | null, f: number | null) => p + (i ?? 0) + (f ?? 0);
  const missing = debt.rows.some((r) => !r.tracked);
  const grand = total(debt.principalMinor, debt.interestMinor, debt.feesMinor);
  const parts = [
    { label: "Principal repaid", value: debt.principalMinor, colour: "var(--fi-invest)", partial: false, hint: "Reduces what you owe" },
    { label: "Interest paid", value: debt.interestMinor, colour: "var(--fi-gap)", partial: !debt.complete, hint: "Cost of borrowing" },
    { label: "Fees paid", value: debt.feesMinor, colour: "var(--fi-g2)", partial: !debt.complete, hint: "Cost of borrowing" },
  ];
  const rows = [...debt.rows.map((r) => [r.name, r.principalMinor, r.interestMinor, r.feesMinor, total(r.principalMinor, r.interestMinor, r.feesMinor)] as (string | number | null)[]), ["Total recorded", debt.principalMinor, debt.interestMinor, debt.feesMinor, total(debt.principalMinor, debt.interestMinor, debt.feesMinor)]];
  const exportCsv = () => downloadCsv("financial-insights-loan-repayments.csv", [["Financial Insights", "Loan repayments"], ...csvScope, [], ["Loan", "Principal", "Interest", "Fees", "Total"], ...rows.map((r) => r.map((c) => (c === null ? "not identified" : typeof c === "number" ? (c / 100).toFixed(2) : c)))]);
  const cell = (v: number | null) => (v === null ? <span className={WARNING} title="Interest and fees of a loan that is not tracked in Loans cannot be told from other spending">not identified</span> : money(v));
  return (
    <section className="flex h-full min-w-0 flex-col rounded-lg border border-border bg-card" aria-label="Loan repayments">
      <header className="flex items-start justify-between gap-2 px-4 pt-3">
        <CardTitle title="Loan repayments" hint="Recorded payments in the period" info={<p>Principal reduces what you owe and is not an expense. Interest and fees are the cost of borrowing: expenses already counted in Spent.</p>} infoLabel="loan repayments" />
        <Button size="xs" variant="ghost" onClick={exportCsv} aria-label="Export Loan repayments as CSV"><Download className="size-3.5" aria-hidden />CSV</Button>
      </header>
      <div className="flex-1 px-4 py-2">
        {upcoming && (
          <div className="mb-3 rounded-md border border-border/60 bg-muted/30 px-3 py-2" aria-label="Next 12 months, from the saved loan schedules">
            <p className="text-xs font-medium">Next 12 months <span className="font-normal text-muted-foreground">from the saved loan schedules, as of today</span></p>
            {upcoming.scheduled === 0 ? (
              <p className={`mt-1 text-xs ${upcoming.toReview > 0 ? WARNING : "text-muted-foreground"}`}>Not scheduled: {upcoming.toReview > 0 ? `${upcoming.toReview === 1 ? "a loan needs" : `${upcoming.toReview} loans need`} review in Loans` : "no loan is tracked in Loans"}.</p>
            ) : (
              <>
                <dl className="mt-1 grid grid-cols-2 gap-3 text-xs">
                  <div className="flex flex-wrap items-baseline gap-x-2"><dt className="text-muted-foreground">Principal due</dt><dd className="text-sm font-semibold tabular-nums">{money(upcoming.principalMinor)}</dd></div>
                  <div className="flex flex-wrap items-baseline gap-x-2"><dt className="text-muted-foreground">Interest &amp; fees due</dt><dd className="text-sm font-semibold tabular-nums">{money(upcoming.costMinor)}</dd></div>
                </dl>
                <p className="mt-1 text-xs text-muted-foreground">{upcoming.scheduled} of {upcoming.loans} {upcoming.loans === 1 ? "loan" : "loans"} scheduled; credit cards and other liabilities are excluded. Not added to the balance.</p>
              </>
            )}
          </div>
        )}
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
