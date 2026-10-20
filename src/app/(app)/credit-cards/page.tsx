import { Suspense } from "react";
import type { Metadata } from "next";
import { CreditCardWorkspace } from "@/features/credit-cards/components/CreditCardWorkspace";

export const metadata: Metadata = { title: "Credit Cards - Actual Bench" };

export default function CreditCardsPage() {
  return (
    // The card, tab, panel and filters live in the URL; `useSearchParams` needs a Suspense boundary to prerender.
    <Suspense fallback={null}>
      <CreditCardWorkspace />
    </Suspense>
  );
}
