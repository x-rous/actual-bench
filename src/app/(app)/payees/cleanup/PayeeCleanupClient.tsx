"use client";

import dynamic from "next/dynamic";

/**
 * Loaded on the client only, as Budget File Health is.
 *
 * The view reads `?tab=` through `useSearchParams`, which a prerendered page
 * cannot do without a Suspense boundary — and this page has nothing worth
 * prerendering anyway, since every word on it comes from the user's budget.
 */
const PayeeCleanupView = dynamic(
  () =>
    import("@/features/payee-cleanup/components/PayeeCleanupView").then(
      (mod) => mod.PayeeCleanupView
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

export function PayeeCleanupClient() {
  return <PayeeCleanupView />;
}
