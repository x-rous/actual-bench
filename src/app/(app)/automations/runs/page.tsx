import type { Metadata } from "next";
import { Suspense } from "react";
import { RunHistoryView } from "@/features/automations/components/RunHistoryView";

export const metadata: Metadata = {
  title: "Run history - Actual Bench",
};

export default function AutomationRunsPage() {
  // `useSearchParams` needs a Suspense boundary to prerender.
  return (
    <Suspense fallback={null}>
      <RunHistoryView />
    </Suspense>
  );
}
