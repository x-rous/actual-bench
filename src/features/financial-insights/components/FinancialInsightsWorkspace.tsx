"use client";

import { useEffect, useMemo } from "react";
import Link from "next/link";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageLayout } from "@/components/layout/PageLayout";
import { resolvePeriod } from "@/lib/financial-insights/period";
import { useFinancialInsights } from "../hooks/useFinancialInsights";
import { preloadFinancialChart } from "./ChartCard";
import { GateScreen } from "./GateScreen";
import { PeriodControl } from "./PeriodControl";
import { SummaryTab } from "./SummaryTab";

const readTime = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/**
 * Financial Insights. The Summary is the only tab for now; the tab strip appears once a second tab exists. Nothing
 * is drawn until every account is understood and the data has been read.
 */
export function FinancialInsightsWorkspace() {
  const view = useFinancialInsights();
  const { gate, data } = view;
  useEffect(() => { void preloadFinancialChart().catch(() => undefined); }, []);

  const accountNames = useMemo(() => new Map(gate.state === "ready" ? gate.accounts.map((a) => [a.id, a.name]) : []), [gate]);
  const ready = data.state === "ready" ? data : null;
  const period = ready?.summary.period ?? resolvePeriod(view.period, view.today, null);

  const actions = ready ? (
    <div className="flex items-center gap-2">
      <PeriodControl choice={view.period} period={period} today={view.today} firstMonth={ready.firstMonth} onChange={view.setPeriod} />
      <Button size="xs" variant="outline" onClick={view.refresh} disabled={ready.refreshing} aria-label="Refresh Financial Insights">
        <RefreshCw className={ready.refreshing ? "size-3.5 animate-spin" : "size-3.5"} aria-hidden />Refresh
      </Button>
    </div>
  ) : undefined;

  return (
    <PageLayout title="Financial Insights" count={ready ? `${period.label} · ${period.partial ? "to today" : "complete months"}` : undefined} actions={actions}>
      {gate.state !== "ready" ? (
        <GateScreen gate={gate} onCheckAgain={view.refresh} />
      ) : data.state === "loading" ? (
        <div className="p-8 text-sm text-muted-foreground" role="status" aria-live="polite">Reading your accounts…</div>
      ) : data.state === "error" ? (
        <div className="mx-auto max-w-md space-y-3 p-8 text-center">
          <h2 className="text-sm font-semibold">We could not read your transactions</h2>
          <p className="text-sm text-muted-foreground">No figures are shown until the read succeeds.</p>
          <Button size="sm" onClick={data.retry}>Retry</Button>
        </div>
      ) : data.firstMonth === null ? (
        <div className="mx-auto max-w-md space-y-2 p-8 text-center">
          <h2 className="text-sm font-semibold">There is nothing to show yet</h2>
          <p className="text-sm text-muted-foreground">This budget has no transactions up to today. Add some in Actual, then press Refresh.</p>
          <Button size="sm" variant="outline" onClick={view.refresh}>Refresh</Button>
        </div>
      ) : (
        <>
          <p className="border-b border-border/50 px-4 py-1.5 text-xs text-muted-foreground" role="status">
            <span className="font-medium text-foreground">{gate.accounts.length} {gate.accounts.length === 1 ? "account" : "accounts"} included</span>
            {gate.excluded.length > 0 && (
              <>{" · "}<Link href="/accounts" className="underline underline-offset-2" title={`Excluded: ${gate.excluded.map((a) => a.name).join(", ")}`}>{gate.excluded.length} excluded</Link></>
            )}
            {" · "}As of {data.summary.period.endDate}
            {data.summary.period.partial && " (partial month)"} · Read at {readTime(data.readAt)}{data.refreshing && " · Refreshing…"}
          </p>
          {data.refreshFailed && !data.refreshing && (
            <div role="alert" className="flex items-center justify-between gap-3 border-b border-amber-500/40 bg-amber-50 px-4 py-1.5 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
              <span>The latest read failed, so these figures are from {readTime(data.readAt)}.</span>
              <Button size="xs" variant="outline" onClick={view.refresh}>Try again</Button>
            </div>
          )}
          <SummaryTab data={data} today={view.today} accountNames={accountNames} />
        </>
      )}
    </PageLayout>
  );
}
