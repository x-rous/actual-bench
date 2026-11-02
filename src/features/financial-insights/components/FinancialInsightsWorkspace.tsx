"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TransactionListDialog } from "@/components/transactions/TransactionListDialog";
import { drillScope, type DrillTarget } from "@/lib/financial-insights/drill";
import { PageLayout } from "@/components/layout/PageLayout";
import { resolvePeriod } from "@/lib/financial-insights/period";
import { useFinancialInsights } from "../hooks/useFinancialInsights";
import { GateScreen } from "./GateScreen";
import { InTransitStatus, useInTransitTarget } from "./InTransitDialog";
import { TipProvider } from "./charts/Tip";
import { PeriodControl } from "./PeriodControl";
import { MoneyTab } from "./MoneyTab";
import { MyBudgetTab } from "./MyBudgetTab";
import { SpendingTab } from "./SpendingTab";
import { SummaryTab } from "./SummaryTab";
import { WealthTab } from "./WealthTab";
import { formatDay } from "../format";

const readTime = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/**
 * Financial Insights: Summary, Money in & out, Spending, My budget and Wealth & investments, with a read-only list behind any figure. Nothing
 * is drawn until every account is understood and the data has been read.
 */
export function FinancialInsightsWorkspace() {
  const view = useFinancialInsights();
  const { gate, data } = view;
  const [drill, setDrill] = useState<DrillTarget | null>(null);

  const accountNames = useMemo(() => new Map(gate.state === "ready" ? gate.accounts.map((a) => [a.id, a.name]) : []), [gate]);
  const ready = data.state === "ready" ? data : null;
  const period = ready?.summary.period ?? resolvePeriod(view.period, view.today, null);

  const actions = ready ? (
    <div className="flex shrink-0 items-center gap-2">
      <PeriodControl choice={view.period} period={period} today={view.today} firstMonth={ready.firstMonth} onChange={view.setPeriod} />
      <Button size="xs" variant="outline" onClick={view.refresh} disabled={ready.refreshing} aria-label="Refresh Financial Insights">
        <RefreshCw className={ready.refreshing ? "size-3.5 animate-spin" : "size-3.5"} aria-hidden />Refresh
      </Button>
    </div>
  ) : undefined;

  // Two rows: the page name with the period and Refresh, then the tabs with what the figures are as of beside them.
  const header = ready && gate.state === "ready" ? (
    <div className="shrink-0 border-b border-border">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 pt-2">
        <h1 className="text-sm font-semibold">Financial Insights</h1>
        {actions}
      </div>
      <Tabs value={view.tab} onValueChange={(v) => view.setTab(v as typeof view.tab)}>
        <div className="flex flex-wrap items-end justify-between gap-x-4">
          <TabsList aria-label="Financial Insights views" className="gap-1 border-0 px-3">
            {view.tabs.map((t) => <TabsTrigger key={t.value} value={t.value} className="h-9 shrink-0 px-2 text-[13px] whitespace-nowrap">{t.label}</TabsTrigger>)}
          </TabsList>
          <p className="px-4 pb-2.5 text-xs text-muted-foreground" role="status">
            <span className="font-medium text-foreground">{gate.accounts.length} {gate.accounts.length === 1 ? "account" : "accounts"} included</span>
            {gate.excluded.length > 0 && (
              <>{" · "}<Link href="/accounts" className="underline underline-offset-2" title={`Excluded: ${gate.excluded.map((a) => a.name).join(", ")}`}>{gate.excluded.length} excluded</Link></>
            )}
            {" · "}As of {formatDay(ready.summary.period.endDate)}{ready.summary.period.partial && " (partial month)"} · Read at {readTime(ready.readAt)}{ready.refreshing && " · Refreshing…"}
          </p>
        </div>
      </Tabs>
    </div>
  ) : undefined;

  return (
    <TipProvider>
    <PageLayout title="Financial Insights" header={header}>
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
        <div className="min-h-full bg-muted/40">
          {data.refreshFailed && !data.refreshing && (
            <div role="alert" className="flex items-center justify-between gap-3 border-b border-amber-500/40 bg-amber-50 px-4 py-1.5 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
              <span>The latest read failed, so these figures are from {readTime(data.readAt)}.</span>
              <Button size="xs" variant="outline" onClick={view.refresh}>Try again</Button>
            </div>
          )}
          {view.tab === "money" ? <MoneyTab data={data} onDrill={setDrill} />
            : view.tab === "spending" ? <SpendingTab data={data} today={view.today} onDrill={setDrill} />
            : view.tab === "wealth" ? <WealthTab data={data} onDrill={setDrill} />
            : view.tab === "budget" && view.budgetMode ? <MyBudgetTab data={data} today={view.today} mode={view.budgetMode} onDrill={setDrill} />
            : <SummaryTab data={data} today={view.today} accountNames={accountNames} onDrill={setDrill} />}
          {drill && <DrillHost key={JSON.stringify(drill)} target={drill} data={data} today={view.today} onClose={() => setDrill(null)} />}
        </div>
      )}
    </PageLayout>
    </TipProvider>
  );
}

/** Opens the list behind a figure. An "in transit" amount first finds its transfers and why each is there. */
function DrillHost({ target, data, today, onClose }: { target: DrillTarget; data: Extract<ReturnType<typeof useFinancialInsights>["data"], { state: "ready" }>; today: string; onClose: () => void }) {
  const transit = target.kind === "inTransit";
  const found = useInTransitTarget(data, today, transit ? target.cashOnly : false, transit);
  if (target.kind === "inTransit") {
    if (found.data) return <DrillDialog target={found.data} data={data} today={today} onClose={onClose} />;
    return <InTransitStatus state={found.isError ? "error" : "loading"} onClose={onClose} retry={() => void found.refetch()} />;
  }
  return <DrillDialog target={target} data={data} today={today} onClose={onClose} />;
}

function DrillDialog({ target, data, today, onClose }: { target: Exclude<DrillTarget, { kind: "inTransit" }>; data: Extract<ReturnType<typeof useFinancialInsights>["data"], { state: "ready" }>; today: string; onClose: () => void }) {
  const scope = useMemo(() => drillScope(target, data.drill), [target, data.drill]);
  return (
    <TransactionListDialog
      title={scope.title} description={scope.description} today={today} constraints={scope.constraints} lockedLabels={scope.lockedLabels}
      defaults={scope.defaults} filters={scope.filters} rowFilter={scope.rowFilter} insights={scope.insights ?? undefined} noteColumn={scope.noteColumn} fullDates expectedMinor={scope.expectedMinor} onClose={onClose}
    />
  );
}
