import type { Metadata } from "next";
import { Suspense } from "react";
import { BackupsView } from "@/features/backups/components/BackupsView";

export const metadata: Metadata = {
  title: "Backups - Actual Bench",
};

export default function BackupsPage() {
  // `useSearchParams` needs a Suspense boundary to prerender.
  return (
    <Suspense fallback={null}>
      <BackupsView />
    </Suspense>
  );
}
