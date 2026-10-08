import type { Metadata } from "next";
import { LoanWorkspaceShell } from "@/features/assets-debt/components/AssetsDebtViews";
import { NewLoanView } from "@/features/assets-debt/components/LoanPages";

export const metadata: Metadata = {
  title: "New loan - Actual Bench",
};

export default function NewLoanPage() {
  return (
    <LoanWorkspaceShell>
      <NewLoanView />
    </LoanWorkspaceShell>
  );
}
