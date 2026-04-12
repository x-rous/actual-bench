import type { Metadata } from "next";
import { BudgetOverviewView } from "@/features/overview/components/BudgetOverviewView";

export const metadata: Metadata = {
  title: "Budget Overview — Actual Bench",
};

export default function OverviewPage() {
  return <BudgetOverviewView />;
}
