"use client";

import { ArrowUpCircle, X } from "lucide-react";
import { useVersionCheckContext } from "@/hooks/useVersionCheck";

const RELEASES_URL = "https://github.com/x-rous/actual-bench/releases";

export function NewVersionBanner() {
  const { updateAvailable, latestVersion, dismissed, dismiss } = useVersionCheckContext();

  if (!updateAvailable || dismissed) return null;

  return (
    <div
      role="alert"
      aria-live="polite"
      className="flex items-center gap-2 border-b border-blue-200 bg-blue-50 px-4 py-1.5 text-xs text-blue-700 dark:border-blue-900/50 dark:bg-blue-950/30 dark:text-blue-400"
    >
      <ArrowUpCircle className="h-3.5 w-3.5 shrink-0" />
      <span>
        Version <strong>{latestVersion}</strong> is available.{" "}
        <a
          href={RELEASES_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-2 hover:opacity-80"
        >
          View release notes
        </a>{" "}
        to update, pull the latest image and restart.
      </span>
      <button
        onClick={dismiss}
        aria-label="Dismiss update notification"
        className="ml-auto shrink-0 opacity-60 hover:opacity-100"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
