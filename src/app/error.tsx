"use client";

import { useEffect } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * Route-segment error boundary. Next.js renders this in place of a crashed
 * route while keeping the root layout (nav, theme, providers) mounted, so the
 * user can recover without a full reload.
 *
 * The retry button uses `unstable_retry` rather than `reset`: `reset` only
 * clears the boundary and re-renders, while `unstable_retry` also refreshes the
 * route's server data before clearing — the right choice here, where a crash
 * usually stems from a bad route/data load. Both props are provided by Next.
 *
 * We intentionally show a generic message and never render `error.message` or
 * the stack to the user — an unhandled error can carry connection details or
 * budget data, which must not surface in the UI (AGENTS.md §4). The raw error
 * is logged to the console for local debugging only.
 */
export default function AppError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  reset: () => void;
  unstable_retry: () => void;
}) {
  useEffect(() => {
    // Console only — never persisted, never shown to the user.
    console.error("Unhandled application error:", error);
  }, [error]);

  return (
    <div
      role="alert"
      className="flex h-full min-h-[60vh] w-full flex-col items-center justify-center gap-6 p-8 text-center"
    >
      <div className="flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <AlertTriangle className="size-6" aria-hidden="true" />
      </div>

      <div className="space-y-2">
        <h1 className="text-lg font-semibold text-foreground">
          Something went wrong
        </h1>
        <p className="max-w-md text-sm text-muted-foreground">
          This page hit an unexpected error. Your unsaved changes may still be
          intact — try again, and if it keeps happening, reconnect from the
          start.
        </p>
        {error.digest ? (
          <p className="text-xs text-muted-foreground/70">
            Reference: {error.digest}
          </p>
        ) : null}
      </div>

      <Button onClick={unstable_retry} variant="default" size="lg">
        <RotateCcw aria-hidden="true" />
        Try again
      </Button>
    </div>
  );
}
