"use client";

import type { DrillTarget } from "@/lib/financial-insights/drill";
import type { FinancialInsightsView } from "../hooks/useFinancialInsights";
import { FlowTab } from "./FlowTab";

type Ready = Extract<FinancialInsightsView["data"], { state: "ready" }>;
type Props = { data: Ready; today: string; onDrill: (target: DrillTarget) => void };

/** Spending: where the money went, by category group, by payee and category by month, quarter or year. */
export function SpendingTab(props: Props) {
  return <FlowTab mode="spending" {...props} />;
}
