import type { Metadata } from "next";
import { CashflowWorkspace } from "@/features/cashflow-planning/components/CashflowWorkspace";

export const metadata: Metadata = { title: "Cashflow Planning - Actual Bench" };

export default function CashflowPlanningPage() {
  return <CashflowWorkspace />;
}
