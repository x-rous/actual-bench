"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Loader2, Plus, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageLayout } from "@/components/layout/PageLayout";
import { decodeFlowPlanConfig } from "@/lib/sync/flowConfig";
import { listFlows } from "@/features/sync/lib/syncApi";
import { addManualFxRate, fillFxRange, listFxRates } from "../lib/fxApi";
import { FxImportPanel } from "./FxImportPanel";
import type { FxRateRecord } from "@/lib/fx/types";

type Pair = { base: string; quote: string };
const pairKey = (p: Pair) => `${p.base}:${p.quote}`;

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/** All calendar days in [from, to], ascending (capped for safety). */
function daysBetween(from: string, to: string, cap = 400): string[] {
  const out: string[] = [];
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  for (let d = start; d <= end && out.length < cap; d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

const SOURCE_LABEL: Record<string, string> = { frankfurter: "Frankfurter", "user-upload": "Uploaded", manual: "Manual", derived: "Derived" };

export function FxRatesView() {
  // Pairs the user actually consolidates, derived from FX-enabled flows.
  const flowPairsQuery = useQuery({
    queryKey: ["fx-flow-pairs"],
    queryFn: async () => {
      const { flows } = await listFlows();
      const seen = new Map<string, Pair>();
      for (const flow of flows) {
        if (flow.flowType !== "transaction_sync") continue;
        const c = decodeFlowPlanConfig(flow);
        if (c.fxEnabled && c.fxSourceCurrency && c.fxTargetCurrency && c.fxSourceCurrency !== c.fxTargetCurrency) {
          const p = { base: c.fxSourceCurrency, quote: c.fxTargetCurrency };
          seen.set(pairKey(p), p);
        }
      }
      return [...seen.values()];
    },
  });

  const [extraPairs, setExtraPairs] = useState<Pair[]>([]);
  const pairs = useMemo(() => {
    const all = new Map<string, Pair>();
    for (const p of flowPairsQuery.data ?? []) all.set(pairKey(p), p);
    for (const p of extraPairs) all.set(pairKey(p), p);
    return [...all.values()];
  }, [flowPairsQuery.data, extraPairs]);

  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const selected = pairs.find((p) => pairKey(p) === selectedKey) ?? pairs[0] ?? null;

  return (
    <PageLayout title="FX Rates">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-5 p-4 lg:p-5">
        <p className="text-sm text-muted-foreground">
          The exchange rates applied when you consolidate local-currency budgets into your master budget. They fill
          in automatically as you sync — review the trend, override any you want to control, or import your own.
        </p>

        <PairSelector pairs={pairs} selected={selected} onSelect={(p) => setSelectedKey(pairKey(p))} onAdd={(p) => { setExtraPairs((x) => [...x, p]); setSelectedKey(pairKey(p)); }} />

        {flowPairsQuery.isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading your currency pairs…</div>
        ) : !selected ? (
          <EmptyState />
        ) : (
          <PairPanel key={pairKey(selected)} pair={selected} />
        )}
      </div>
    </PageLayout>
  );
}

function EmptyState() {
  return (
    <div className="rounded-md border border-dashed border-border bg-muted/20 px-6 py-10 text-center">
      <p className="text-sm font-medium">No currency conversion set up yet</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
        Turn on <span className="font-medium">Convert currency</span> on a Budget File Sync flow to consolidate a
        local-currency budget into a master currency. Its pair will appear here — or add one above to manage rates
        ahead of time.
      </p>
    </div>
  );
}

function PairSelector({ pairs, selected, onSelect, onAdd }: { pairs: Pair[]; selected: Pair | null; onSelect: (p: Pair) => void; onAdd: (p: Pair) => void }) {
  const [adding, setAdding] = useState(false);
  const [base, setBase] = useState("");
  const [quote, setQuote] = useState("");
  const canAdd = base.length === 3 && quote.length === 3 && base !== quote;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {pairs.map((p) => {
        const active = selected && pairKey(p) === pairKey(selected);
        return (
          <button
            key={pairKey(p)}
            type="button"
            onClick={() => onSelect(p)}
            className={`rounded-full border px-3 py-1 text-sm transition-colors ${active ? "border-foreground bg-foreground text-background" : "border-border text-foreground hover:bg-muted"}`}
          >
            {p.base} → {p.quote}
          </button>
        );
      })}
      {adding ? (
        <div className="flex items-center gap-1">
          <Input aria-label="New base currency" className="w-16 uppercase" maxLength={3} placeholder="JOD" value={base} onChange={(e) => setBase(e.target.value.toUpperCase())} />
          <span className="text-muted-foreground">→</span>
          <Input aria-label="New quote currency" className="w-16 uppercase" maxLength={3} placeholder="AUD" value={quote} onChange={(e) => setQuote(e.target.value.toUpperCase())} />
          <Button size="sm" disabled={!canAdd} onClick={() => { onAdd({ base, quote }); setAdding(false); setBase(""); setQuote(""); }}>Add</Button>
          <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>Cancel</Button>
        </div>
      ) : (
        <button type="button" onClick={() => setAdding(true)} className="flex items-center gap-1 rounded-full border border-dashed border-border px-3 py-1 text-sm text-muted-foreground hover:bg-muted">
          <Plus className="h-3.5 w-3.5" /> pair
        </button>
      )}
    </div>
  );
}

function PairPanel({ pair }: { pair: Pair }) {
  const [from, setFrom] = useState(isoDaysAgo(29));
  const [to, setTo] = useState(isoDaysAgo(0));
  const [overrideDate, setOverrideDate] = useState<string>("");
  const [overrideRate, setOverrideRate] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const ratesQuery = useQuery({
    queryKey: ["fx-rates", pairKey(pair), from, to],
    queryFn: () => listFxRates(pair.base, pair.quote, from, to),
  });
  const rates = ratesQuery.data?.rates ?? [];
  const rateByDate = useMemo(() => new Map(rates.map((r) => [r.requestedDate, r])), [rates]);
  const days = useMemo(() => daysBetween(from, to), [from, to]);
  const covered = days.filter((d) => rateByDate.has(d)).length;
  const latest = rates.length > 0 ? rates[rates.length - 1] : null;
  const series = useMemo(() => rates.map((r) => Number(r.rate)).filter((n) => Number.isFinite(n)), [rates]);

  const fillM = useMutation({
    mutationFn: () => fillFxRange(pair.base, pair.quote, from, to),
    onSuccess: ({ result }) => { setNotice(`Filled ${result.inserted} day(s) from Frankfurter (${result.skipped} already set).`); setError(null); ratesQuery.refetch(); },
    onError: (e) => setError(e instanceof Error ? e.message : "Could not fetch rates."),
  });
  const overrideM = useMutation({
    mutationFn: () => addManualFxRate({ baseCurrency: pair.base, quoteCurrency: pair.quote, date: overrideDate, rate: overrideRate }),
    onSuccess: () => { setNotice(`Set your rate for ${overrideDate}.`); setError(null); setOverrideRate(""); setOverrideDate(""); ratesQuery.refetch(); },
    onError: (e) => setError(e instanceof Error ? e.message : "Could not save the rate."),
  });

  return (
    <div className="flex flex-col gap-4">
      {/* Hero: latest rate + trend + coverage */}
      <section className="rounded-md border border-border bg-background p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="text-2xl font-semibold tabular-nums">
              1 {pair.base} = {latest ? latest.rate : "—"} {pair.quote}
            </div>
            <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
              {latest ? (
                <>
                  <span>as of {latest.requestedDate}</span>
                  <Badge variant="secondary" className="text-[10px]">{SOURCE_LABEL[latest.source] ?? latest.source}</Badge>
                </>
              ) : (
                <span>No rate yet in this range — Fill or add one below.</span>
              )}
              <span>· {covered} of {days.length} days covered</span>
            </div>
          </div>
          <Sparkline values={series} />
        </div>
      </section>

      {/* Toolbar */}
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">From<Input aria-label="From date" type="date" className="w-40" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">To<Input aria-label="To date" type="date" className="w-40" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <Button size="sm" variant="outline" disabled={fillM.isPending} onClick={() => fillM.mutate()}>
          {fillM.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Fill range from Frankfurter
        </Button>
      </div>
      {notice && <p className="text-xs text-green-600 dark:text-green-400">{notice}</p>}
      {error && <p className="text-xs text-destructive">{error}</p>}

      {/* Override a specific date */}
      <section className="rounded-md border border-border bg-muted/20 p-3">
        <div className="flex flex-wrap items-end gap-2">
          <span className="pb-2 text-xs font-medium">Use your own rate for a date:</span>
          <Input aria-label="Override date" type="date" className="w-40" value={overrideDate} onChange={(e) => setOverrideDate(e.target.value)} />
          <Input aria-label="Override rate" className="w-28" placeholder="0.4162" value={overrideRate} onChange={(e) => setOverrideRate(e.target.value)} />
          <Button size="sm" disabled={!overrideDate || !overrideRate.trim() || overrideM.isPending} onClick={() => overrideM.mutate()}>Save rate</Button>
        </div>
      </section>

      {/* Coverage ledger: every day in range, gaps shown */}
      <div className="min-h-0 overflow-auto rounded-md border border-border" style={{ maxHeight: "24rem" }}>
        <table className="w-full text-xs">
          <thead className="sticky top-0 z-10 bg-muted text-left text-[11px] uppercase text-muted-foreground">
            <tr className="[&>th]:px-3 [&>th]:py-2"><th>Date</th><th className="text-right">Rate (1 {pair.base})</th><th>Source</th></tr>
          </thead>
          <tbody>
            {ratesQuery.isFetching && rates.length === 0 ? (
              <tr><td colSpan={3} className="px-3 py-6 text-center text-muted-foreground">Loading…</td></tr>
            ) : days.slice().reverse().map((day) => {
              const r = rateByDate.get(day);
              return (
                <tr
                  key={day}
                  className={`cursor-pointer border-t border-border/60 hover:bg-muted/50 ${r ? "" : "text-muted-foreground"}`}
                  onClick={() => { setOverrideDate(day); setOverrideRate(r?.rate ?? ""); }}
                  title="Click to set your own rate for this date"
                >
                  <td className="px-3 py-1.5 tabular-nums">{day}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums font-medium">{r ? r.rate : "—"}</td>
                  <td className="px-3 py-1.5">
                    {r ? (
                      <Badge variant={r.source === "manual" ? "status-warning" : r.source === "user-upload" ? "status-active" : "secondary"} className="text-[10px]">
                        {SOURCE_LABEL[r.source] ?? r.source}{r.isUserOverride ? " · yours" : ""}
                      </Badge>
                    ) : (
                      <span className="text-[11px]">not fetched</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <FxImportPanel onCommitted={() => ratesQuery.refetch()} />
    </div>
  );
}

/** Minimal inline SVG sparkline — the rate's own movement, the page's signature. */
function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return <div className="h-12 w-40" aria-hidden />;
  const w = 160;
  const h = 44;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * w;
    const y = h - ((v - min) / span) * h;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const up = values[values.length - 1] >= values[0];
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="shrink-0" role="img" aria-label="Rate trend">
      <polyline points={pts.join(" ")} fill="none" stroke="currentColor" strokeWidth="1.5" className={up ? "text-green-500" : "text-amber-500"} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
