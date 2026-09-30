"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { formatMinor } from "../../lib/money";
import type { ChartData, SeriesId } from "../../lib/results";

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
  comparison: "Saved loan balance",
  offsetBalance: "Offset balance",
  interestBearing: "Interest-bearing balance",
  cumulativeInterest: "Interest paid so far",
};

export function LoanChartPanel({ data, view, onViewChange, currency, digits }: { data: ChartData; view: "month" | "year"; onViewChange: (v: "month" | "year") => void; currency: string; digits: number }) {
  const [hidden, setHidden] = useState<SeriesId[]>([]);
  const visible = data.series.filter((s) => !hidden.includes(s));
  const first = data.points[0];
  const last = data.points.at(-1);
  const peak = data.points.reduce((m, p) => Math.max(m, p.balance ?? 0), 0);
  const summary = first && last ? `Loan balance from ${first.period} to ${last.period}: highest ${formatMinor(peak, digits, currency)}, ending at ${formatMinor(last.balance ?? 0, digits, currency)}.${data.series.includes("comparison") ? " A second line shows the saved loan for comparison." : ""}` : "No chart yet.";
  return (
    <section aria-labelledby="chart-heading" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="chart-heading" className="text-sm font-semibold">
          Balance over time
        </h2>
        <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Series shown">
          {data.series.map((id) => {
            const on = !hidden.includes(id);
            return (
              <button
                key={id}
                type="button"
                aria-pressed={on}
                onClick={() => setHidden((h) => (on ? [...h, id] : h.filter((x) => x !== id)))}
                className={cn("rounded-full border px-2 py-0.5 text-[11px]", on ? "border-primary font-medium" : "border-border text-muted-foreground line-through")}
              >
                {LABELS[id]}
                <span className="sr-only">{on ? " (shown)" : " (hidden)"}</span>
              </button>
            );
          })}
          <span className="mx-1 h-4 w-px bg-border" aria-hidden />
          <div role="radiogroup" aria-label="Chart detail" className="flex gap-1">
            {(["month", "year"] as const).map((v) => (
              <button key={v} type="button" role="radio" aria-checked={view === v} onClick={() => onViewChange(v)} className={cn("rounded border border-border px-2 py-0.5 text-[11px]", view === v ? "border-primary bg-primary/10 font-medium" : "text-muted-foreground")}>
                {v === "month" ? "Monthly" : "Yearly"}
              </button>
            ))}
          </div>
        </div>
      </div>
      <figure className="m-0" aria-describedby="chart-summary">
        <div role="group" aria-label="Loan balance chart. Focus it and use the arrow keys to step through periods.">
          <LoanProjectionChart data={data} visible={visible} currency={currency} digits={digits} />
        </div>
        <figcaption id="chart-summary" className="text-[11px] text-muted-foreground">
          {summary} The schedule below lists every figure.
        </figcaption>
      </figure>
    </section>
  );
}
