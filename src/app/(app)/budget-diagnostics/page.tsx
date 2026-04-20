import type { Metadata } from "next";
import { BudgetDiagnosticsClient } from "./BudgetDiagnosticsClient";

export const metadata: Metadata = {
  title: "Budget Diagnostics — Actual Bench",
};

export default function BudgetDiagnosticsPage() {
  return <BudgetDiagnosticsClient />;
}
