"use client";

import { useMemo, useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import { SearchInput } from "@/components/ui/search-input";
import { Select } from "@/components/ui/select";
import { downloadCsv } from "@/lib/csv";
import type { FxConversionRow } from "@/lib/sync/fxPosition";
import { formatAmount } from "../lib/previewRows";

/** Enough to scan; the export always holds every matching row. */
const MAX_SHOWN = 500;

const plainAmount = (minor: number) => (minor / 100).toFixed(2);

/** Every synced row's original amount, rate and converted amount, filterable and exportable. */
export function FxConversionsTable({ rows, flowName }: { rows: FxConversionRow[]; flowName: string }) {
  const [search, setSearch] = useState("");
  const [rateSource, setRateSource] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const sources = useMemo(() => [...new Set(rows.map((row) => row.rateSource))].sort(), [rows]);
  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return rows.filter((row) =>
      (rateSource === "all" || row.rateSource === rateSource) &&
      (!from || row.date >= from) &&
      (!to || row.date <= to) &&
      (!needle || (row.payeeName ?? "").toLowerCase().includes(needle) || row.rate.includes(needle))
    );
  }, [rows, search, rateSource, from, to]);

  function exportCsv() {
    const safeName = flowName.replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 40) || "flow";
    downloadCsv(`fx-conversions-${safeName}.csv`, [
      ["Date", "Payee", "Original currency", "Original amount", "Rate", "Rate date", "Rate source", "Converted currency", "Converted amount", "On target"],
      ...visible.map((row) => [row.date, row.payeeName ?? "", row.sourceCurrency, plainAmount(row.sourceAmount), row.rate, row.rateDate, row.rateSource, row.targetCurrency, plainAmount(row.convertedAmount), row.onTarget ? "Yes" : "No"]),
    ]);
  }

  return (
    <section aria-label="Conversions" className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="w-64"><SearchInput value={search} onValueChange={setSearch} placeholder="Search payee or rate" aria-label="Search conversions" /></div>
        <div className="w-44"><Select aria-label="Rate source" size="sm" value={rateSource} onValueChange={setRateSource} options={[{ value: "all", label: "All rate sources" }, ...sources.map((value) => ({ value, label: value }))]} /></div>
        <DateInput aria-label="From date" size="sm" className="w-36" value={from} onValueChange={setFrom} />
        <DateInput aria-label="To date" size="sm" className="w-36" value={to} onValueChange={setTo} />
        <span className="text-xs tabular-nums text-muted-foreground">{visible.length} of {rows.length}</span>
        <span className="flex-1" />
        <Button size="sm" variant="outline" onClick={exportCsv} disabled={visible.length === 0}><Download className="h-3.5 w-3.5" /> Export CSV</Button>
      </div>
      {rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">No converted transactions yet. They appear here once this flow has synced.</p>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto rounded-md border border-border">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-muted text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr className="[&>th]:whitespace-nowrap [&>th]:px-2 [&>th]:py-1.5 [&>th]:font-medium">
                <th>Date</th><th>Payee</th><th className="text-right">Original</th><th className="text-right">Rate</th><th>Rate date</th><th>Rate source</th><th className="text-right">Converted</th><th>On target</th>
              </tr>
            </thead>
            <tbody>
              {visible.slice(0, MAX_SHOWN).map((row) => (
                <tr key={row.transactionId} className="border-t border-border/60 tabular-nums [&>td]:whitespace-nowrap [&>td]:px-2 [&>td]:py-1">
                  <td>{row.date}</td>
                  <td className="max-w-64 truncate" title={row.payeeName ?? undefined}>{row.payeeName ?? "-"}</td>
                  <td className="text-right"><span className="mr-1 text-[10px] text-muted-foreground">{row.sourceCurrency}</span>{formatAmount(row.sourceAmount)}</td>
                  <td className="text-right">{row.rate}</td>
                  <td>{row.rateDate}</td>
                  <td>{row.rateSource}</td>
                  <td className="text-right"><span className="mr-1 text-[10px] text-muted-foreground">{row.targetCurrency}</span>{formatAmount(row.convertedAmount)}</td>
                  <td>{row.onTarget ? "Yes" : "Deleted"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {visible.length > MAX_SHOWN && <p className="text-xs text-muted-foreground">Showing the newest {MAX_SHOWN}. Export CSV includes all {visible.length}.</p>}
    </section>
  );
}
