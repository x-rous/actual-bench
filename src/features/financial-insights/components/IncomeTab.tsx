"use client";

import type { DrillTarget } from "@/lib/financial-insights/drill";
import type { FinancialInsightsView } from "../hooks/useFinancialInsights";
import { FlowTab } from "./FlowTab";

type Ready = Extract<FinancialInsightsView["data"], { state: "ready" }>;
type Props = { data: Ready; today: string; onDrill: (target: DrillTarget) => void };

/** Income: where the money came from (money received, not budgeted income), by category group, by payer and category by month, quarter or year. */
export function IncomeTab(props: Props) {
  return <FlowTab mode="income" {...props} />;
}
