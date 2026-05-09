"use client";

import { AlertTriangle } from "lucide-react";
import { useConnectionHealthContext } from "@/hooks/useConnectionHealth";

export function ConnectionOfflineBanner() {
  const { showBanner } = useConnectionHealthContext();

  if (!showBanner) return null;

  return (
    <div
      role="alert"
      aria-live="polite"
      className="flex items-center gap-2 border-b border-red-200 bg-red-50 px-4 py-1.5 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-400"
    >
      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
      <span>Lost connection to server — save disabled until reconnected.</span>
    </div>
  );
}
