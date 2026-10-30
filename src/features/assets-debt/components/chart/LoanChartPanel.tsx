"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { formatAmount, fractionToPercent } from "../../lib/money";
import { formatChartDate, formatChartPeriod, SERIES_META } from "./chartMeta";
import type { ChartData, SeriesId } from "../../lib/results";
import { HelpDialogButton } from "../simulator/ConfigurationSection";

/**
 * The chart's frame: series chips, the monthly/yearly switch and a text
 * summary. The Recharts chart itself is code-split and loads only here, so it
 * never weighs on other pages (P1.3b T211 gate).
 */

const LoanProjectionChart = dynamic(() => import("./LoanProjectionChart"), {
  ssr: false,
  loading: () => <div className="h-[320px] w-full animate-pulse rounded bg-muted/40" aria-hidden />,
});

const LABELS: Record<SeriesId, string> = {
  balance: "Loan balance",
  actualBalance: "Balance in Actual",
  comparison: "Saved loan balance",
  baseline: "Without what-ifs",
  offsetBalance: "Offset balance",
  interestBearing: "Interest-bearing balance",
  cumulativeInterest: "Interest paid",
};

export function LoanChartPanel({ data, view, onViewChange, digits }: { data: ChartData; view: "month" | "year"; onViewChange: (v: "month" | "year") => void; digits: number }) {
  const [hidden, setHidden] = useState<SeriesId[]>(["baseline"]);
  const [showEvents, setShowEvents] = useState(false);
  const [separateInterest, setSeparateInterest] = useState(false);
  const visible = data.series.filter((s) => !hidden.includes(s));
  const interestAxis = separateInterest && visible.includes("cumulativeInterest");
  const balancePoints = data.points.filter((point) => point.balance !== undefined);
  const first = balancePoints[0];
  const last = balancePoints.at(-1);
  const peak = data.points.reduce((m, p) => Math.max(m, p.balance ?? 0), 0);
  const rateSummary = data.rateChanges.flatMap((group) => group.changes).map((change) => `${formatChartDate(change.date)} to ${fractionToPercent(change.annualRateDecimal)}%`).join("; ");
  const otherSeries = visible.filter((id) => id !== "balance").map((id) => LABELS[id]);
  const summary = first && last
    ? `${visible.includes("balance") ? `Loan balance from ${formatChartPeriod(first.period)} to ${formatChartPeriod(last.period)}: highest ${formatAmount(peak, digits)}, ending at ${formatAmount(last.balance!, digits)}.` : "Loan balance is hidden."}${data.payoff && visible.includes("balance") ? ` ${data.payoff.recorded ? "Paid off" : "Projected payoff"} on ${formatChartDate(data.payoff.date)}.` : ""}${rateSummary ? ` Rate changes: ${rateSummary}.` : ""}${otherSeries.length ? ` Other visible lines: ${otherSeries.join(", ")}.` : ""}${interestAxis ? " Interest uses a separate right-hand scale." : ""}`
    : "No loan balance to display.";
  return (
    <section aria-labelledby="chart-heading" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <h2 id="chart-heading" className="text-sm font-semibold">Balance over time</h2>
          <HelpDialogButton
            title="Balance chart help"
            description={summary}
            groups={[{ items: [
              { term: "Series", description: "Use the legend buttons to show or hide each line. Colour and line style both distinguish the series." },
              { term: "Rate changes", description: "Amber dotted markers show the effective date and new annual rate." },
              { term: "Monthly / Yearly", description: "Changes the chart detail only. It does not change the projection or repayment frequency." },
              { term: "Period values", description: "Balances follow the latest event in each period; scheduled payments are totals for the period. Paid compares the balance with the opening amount; draws and charges can affect it." },
              { term: "Interest", description: "Interest paid includes projected and capitalized charges. The interest-bearing balance is used for accrual on the event date; depending on event order it may be before the repayment. Offset balance is the linked account balance." },
              { term: "Interest axis", description: "Use a separate right-hand scale to see interest in more detail. When scales differ, lines crossing do not mean the amounts are equal." },
              { term: "Percentages", description: "Repayment component percentages are shares of the repayment total." },
              { term: "Without what-ifs", description: "Removes optional events while retaining the opening offset and contractual rate changes." },
              { term: "Exact figures", description: "Use the tooltip for a plotted period and the amortization schedule for the underlying event detail." },
            ] }]}
          />
        </div>
        <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Chart controls">
          <div className="flex flex-wrap items-center gap-1" aria-label="Chart legend">
            {data.series.map((id) => {
              const on = !hidden.includes(id);
              return (
                <button
                  key={id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setHidden((h) => (on ? [...h, id] : h.filter((x) => x !== id)))}
                  className={cn("flex items-center gap-1.5 rounded-full border px-2 py-1 text-[11px]", on ? "border-border bg-background font-medium" : "border-border text-muted-foreground line-through")}
                >
                  <span className="h-0 w-4 border-t-2" style={{ borderColor: SERIES_META[id].color, borderTopStyle: SERIES_META[id].dash ? "dashed" : "solid" }} aria-hidden />
                  {LABELS[id]}
                  <span className="sr-only">{on ? " (shown)" : " (hidden)"}</span>
                </button>
              );
            })}
            {data.rateChanges.length ? (
              <span className="flex items-center gap-1.5 rounded-full border border-border bg-background px-2 py-1 text-[11px] font-medium">
                <span className="h-4 border-l-2 border-dotted" style={{ borderColor: "var(--chart-rate-change)" }} aria-hidden />
                Rate change
              </span>
            ) : null}
            {data.points.some((point) => point.events?.length) ? <button type="button" aria-pressed={showEvents} onClick={() => setShowEvents((shown) => !shown)} className={cn("rounded-full border border-border px-2 py-1 text-[11px]", showEvents ? "bg-background font-medium" : "text-muted-foreground")}>Events</button> : null}
          </div>
          {data.series.includes("cumulativeInterest") ? <button type="button" aria-pressed={separateInterest} disabled={!visible.includes("cumulativeInterest")} onClick={() => setSeparateInterest((on) => !on)} className={cn("rounded-full border border-border px-2 py-1 text-[11px] disabled:opacity-50", interestAxis ? "bg-background font-medium" : "text-muted-foreground")}>Interest axis</button> : null}
          <span className="mx-1 h-4 w-px bg-border" aria-hidden />
          <div role="radiogroup" aria-label="Chart detail" className="flex gap-1" onKeyDown={(event) => {
            if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
            event.preventDefault();
            const next = view === "month" ? "year" : "month";
            onViewChange(next);
            event.currentTarget.querySelector<HTMLButtonElement>(`[data-view="${next}"]`)?.focus();
          }}>
            {(["month", "year"] as const).map((v) => (
              <button key={v} data-view={v} type="button" role="radio" tabIndex={view === v ? 0 : -1} aria-checked={view === v} onClick={() => onViewChange(v)} className={cn("rounded border border-border px-2 py-0.5 text-[11px]", view === v ? "border-primary bg-primary/10 font-medium" : "text-muted-foreground")}>
                {v === "month" ? "Monthly" : "Yearly"}
              </button>
            ))}
          </div>
        </div>
      </div>
      <figure className="m-0" aria-describedby="chart-summary">
        <div role="group" aria-label="Loan balance chart. Focus it and use the arrow keys to step through periods.">
          <LoanProjectionChart data={data} visible={visible} digits={digits} showEvents={showEvents} separateInterest={interestAxis} />
        </div>
        <figcaption id="chart-summary" className="sr-only">{summary} The schedule below lists every figure.</figcaption>
      </figure>
    </section>
  );
}
