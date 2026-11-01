"use client";

import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PillGroup } from "@/components/ui/pill-group";
import { downloadCsv } from "@/lib/csv";
import { usePersistedFilters } from "@/hooks/usePersistedFilters";
import { money, MISSING } from "../format";
import type { ChartPoint, ChartSeries } from "./ChartCanvas";
import { lazyChart } from "@/features/credit-cards/components/charts/lazyChart";

const Canvas = lazyChart(() => import("./ChartCanvas"));
export const preloadFinancialChart = Canvas.preload;

type Mode = "line" | "bar" | "table";
const MODES: { value: Mode; label: string }[] = [
  { value: "line", label: "Line" },
  { value: "bar", label: "Bars" },
  { value: "table", label: "Table" },
];

/**
 * The one chart every tab uses: Line, Bars or an exact Table of the same series and figures, a legend, and a CSV of
 * what is shown. A month with no value is a gap ("Unavailable"), never zero, and a partial month is marked.
 */
export function ChartCard({ id, title, subtitle, lead, series, points, footnote, csvScope }: {
  /** Keeps this card's chosen mode across visits. */
  id: string;
  title: string;
  subtitle?: string;
  /** Content that sits above the chart inside the same card, such as a headline figure. */
  lead?: React.ReactNode;
  series: ChartSeries[];
  points: ChartPoint[];
  footnote?: string;
  /** Lines written above the CSV: the period and the as-of date. */
  csvScope: [string, string][];
}) {
  const [{ mode }, setState] = usePersistedFilters(`filters:financial-insights:chart:${id}`, { mode: "line" as Mode });

  function exportCsv() {
    downloadCsv(`financial-insights-${id}.csv`, [
      ["Financial Insights", title],
      ...csvScope,
      [],
      ["Month", ...series.map((s) => s.label)],
      ...points.map((p) => [p.partial ? `${p.label} (partial)` : p.label, ...p.values.map((v) => (v === null ? "unavailable" : (v / 100).toFixed(2)))]),
    ]);
  }

  return (
    <section className="flex min-w-0 flex-col rounded-lg border border-border bg-card" aria-label={title}>
      {lead}
      <header className="flex flex-wrap items-center justify-between gap-2 px-4 pt-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">{title}</h2>
          {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
        </div>
        <div className="flex items-center gap-2">
          <PillGroup options={MODES} value={mode} onChange={(next) => setState({ mode: next })} />
          <Button size="xs" variant="outline" onClick={exportCsv} aria-label={`Export ${title} as CSV`}><Download className="size-3.5" aria-hidden />CSV</Button>
        </div>
      </header>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 px-4 pt-2 text-xs text-muted-foreground" aria-label="Legend">
        {series.map((s) => <li key={s.label} className="flex items-center gap-1.5"><span className="size-2 rounded-sm" style={{ background: s.color }} aria-hidden />{s.label}</li>)}
      </ul>
      <div className="px-2 pb-2 pt-1">
        {mode === "table" ? (
          <div className="max-h-80 overflow-auto">
            <table className="w-full border-collapse text-xs">
              <thead className="sticky top-0 bg-card">
                <tr className="border-b border-border">
                  <th scope="col" className="px-3 py-1.5 text-left font-medium text-muted-foreground">Month</th>
                  {series.map((s) => <th key={s.label} scope="col" className="px-3 py-1.5 text-right font-medium text-muted-foreground">{s.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {points.map((p) => (
                  <tr key={p.label} className="border-b border-border/40">
                    <th scope="row" className="whitespace-nowrap px-3 py-1 text-left font-normal">{p.label}{p.partial && <span className="ml-2 text-muted-foreground">partial</span>}</th>
                    {p.values.map((v, i) => <td key={series[i].label} className="px-3 py-1 text-right tabular-nums">{v === null ? <span title="Unavailable">{MISSING}</span> : money(v)}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Canvas.Chart title={title} series={series} points={points} mode={mode} fallback={<div className="h-80" aria-busy="true" />} />}
      </div>
      {footnote && <p className="border-t border-border/50 px-4 py-2 text-xs text-muted-foreground">{footnote}</p>}
    </section>
  );
}
