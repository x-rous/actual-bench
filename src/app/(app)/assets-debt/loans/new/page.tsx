import type { Metadata } from "next";
import { AssetsDebtShell } from "@/features/assets-debt/components/AssetsDebtViews";
import { NewLoanView } from "@/features/assets-debt/components/LoanPages";

export const metadata: Metadata = {
  title: "New loan - Actual Bench",
};

export default function NewLoanPage() {
  return (
    <AssetsDebtShell title="Assets & Debt">
      <NewLoanView />
    </AssetsDebtShell>
  );
}
