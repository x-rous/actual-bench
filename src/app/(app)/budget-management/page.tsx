import type { Metadata } from "next";
import { BudgetManagementView } from "@/features/budget-management/components/BudgetManagementView";

export const metadata: Metadata = {
  title: "Budget Management - Actual Bench",
};

export default function BudgetManagementPage() {
  return <BudgetManagementView />;
}
