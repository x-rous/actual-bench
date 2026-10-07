import type { Metadata } from "next";
import { Suspense } from "react";
import { DebtListView } from "@/features/assets-debt/components/AssetsDebtViews";

export const metadata: Metadata = {
  title: "Loans & Debt - Actual Bench",
};

export default function LoansPage() {
  return (
    // `useSearchParams` (the ?filter= switch) needs a Suspense boundary to prerender.
    <Suspense fallback={null}>
      <DebtListView />
    </Suspense>
  );
}
