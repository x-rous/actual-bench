"use client";

import { useMemo } from "react";
import { TransactionListDialog } from "@/components/transactions/TransactionListDialog";
import { drillScope, type DrillTarget } from "@/lib/financial-insights/drill";
import type { FinancialInsightsView } from "../hooks/useFinancialInsights";

/** The read-only list of the transactions behind a figure. */
export function DrillDialog({ target, data, today, onClose }: { target: Exclude<DrillTarget, { kind: "inTransit" }>; data: Extract<FinancialInsightsView["data"], { state: "ready" }>; today: string; onClose: () => void }) {
  const scope = useMemo(() => drillScope(target, data.drill), [target, data.drill]);
  return (
    <TransactionListDialog
      title={scope.title} description={scope.description} today={today} constraints={scope.constraints} lockedLabels={scope.lockedLabels}
      defaults={scope.defaults} filters={scope.filters} rowFilter={scope.rowFilter} insights={scope.insights ?? undefined} noteColumn={scope.noteColumn} fullDates expectedMinor={scope.expectedMinor} onClose={onClose}
    />
  );
}
