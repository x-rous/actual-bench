import type { Metadata } from "next";
import { FinancialInsightsWorkspace } from "@/features/financial-insights/components/FinancialInsightsWorkspace";

export const metadata: Metadata = { title: "Financial Insights - Actual Bench" };

export default function FinancialInsightsPage() {
  return <FinancialInsightsWorkspace />;
}
