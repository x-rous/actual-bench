"use client";

import dynamic from "next/dynamic";

const BudgetDiagnosticsView = dynamic(
  () =>
    import("@/features/budget-diagnostics/components/BudgetDiagnosticsView").then(
      (mod) => mod.BudgetDiagnosticsView
    ),
  {
    ssr: false,
    loading: () => (
      <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="border-b border-border px-6 py-4">
          <div className="h-7 w-56 animate-pulse rounded-md bg-muted" />
          <div className="mt-2 h-4 w-96 max-w-full animate-pulse rounded-md bg-muted/70" />
        </div>
      </main>
    ),
  }
);

export function BudgetDiagnosticsClient() {
  return <BudgetDiagnosticsView />;
}
