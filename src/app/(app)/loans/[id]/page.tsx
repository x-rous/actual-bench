import type { Metadata } from "next";
import { Suspense } from "react";
import { LoanWorkspaceShell } from "@/features/assets-debt/components/AssetsDebtViews";
import { LoanView } from "@/features/assets-debt/components/LoanPages";

export const metadata: Metadata = {
  title: "Loan - Actual Bench",
};

export default async function LoanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <LoanWorkspaceShell>
      {/* `useSearchParams` (the ?view= switch) needs a Suspense boundary to prerender. */}
      <Suspense fallback={null}>
        <LoanView id={id} />
      </Suspense>
    </LoanWorkspaceShell>
  );
}
