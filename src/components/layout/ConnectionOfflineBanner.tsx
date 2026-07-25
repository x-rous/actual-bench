"use client";

import { AlertTriangle } from "lucide-react";
import { useConnectionHealthContext } from "@/hooks/useConnectionHealth";
import { Button } from "@/components/ui/button";

export function ConnectionOfflineBanner() {
  const { showBanner, status, recheck } = useConnectionHealthContext();

  if (!showBanner) return null;

  // While a manual/scheduled check is running, reflect it on the button so the
  // click has visible feedback (the check itself is guarded against overlap).
  const checking = status === "checking";

  return (
    <div
      role="alert"
      aria-live="polite"
      className="flex items-center gap-2 border-b border-red-200 bg-red-50 px-4 py-1.5 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-400"
    >
      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
      <span>
        Lost connection to server - changes may not save until the connection
        is restored.
      </span>
      <Button
        variant="outline"
        size="xs"
        className="ml-auto"
        onClick={recheck}
        disabled={checking}
      >
        {checking ? "Checking..." : "Retry now"}
      </Button>
    </div>
  );
}
