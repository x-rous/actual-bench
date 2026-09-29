import type { Metadata } from "next";
import { DebtListView } from "@/features/assets-debt/components/AssetsDebtViews";

export const metadata: Metadata = {
  title: "Loans & Debt - Actual Bench",
};

export default function LoansPage() {
  return <DebtListView />;
}
