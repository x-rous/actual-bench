import type { Metadata } from "next";
import { Suspense } from "react";
import { AutomationsView } from "@/features/automations/components/AutomationsView";

export const metadata: Metadata = {
  title: "Automations - Actual Bench",
};

export default function AutomationsPage() {
  // `useSearchParams` needs a Suspense boundary to prerender.
  return (
    <Suspense fallback={null}>
      <AutomationsView />
    </Suspense>
  );
}
