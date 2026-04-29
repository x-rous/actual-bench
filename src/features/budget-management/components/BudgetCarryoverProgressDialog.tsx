"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { useCarryoverToggle } from "../hooks/useCarryoverToggle";
import type {
  CarryoverToggleInput,
  CarryoverToggleResult,
} from "../hooks/useCarryoverToggle";

type Props = {
  request: CarryoverToggleInput;
  /** Display-friendly category label for the dialog header. */
  categoryLabel?: string;
  onClose: () => void;
};

type DialogState = "running" | "success" | "partial-failure" | "failure";

const AUTO_CLOSE_SECONDS = 3;

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Carryover update failed.";
}

function buildRejectedResults(
  request: CarryoverToggleInput,
  error: unknown
): CarryoverToggleResult[] {
  const message = getErrorMessage(error);
  return request.months.map((m) => ({
    month: m,
    status: "error" as const,
    message,
  }));
}

/**
 * Progress + partial-failure dialog for the carryover toggle.
 *
 * Mirrors `BudgetSaveProgressDialog`: shows progress while the multi-month
 * PATCH loop runs, auto-closes on full success after 3s, and offers a
 * "Retry Failed" path that re-issues only the months that didn't succeed.
 */
export function BudgetCarryoverProgressDialog({
  request,
  categoryLabel,
  onClose,
}: Props) {
  const { run, isPending, progress } = useCarryoverToggle();
  const [results, setResults] = useState<CarryoverToggleResult[]>([]);
  const [dialogState, setDialogState] = useState<DialogState>("running");
  const [countdown, setCountdown] = useState(AUTO_CLOSE_SECONDS);
  const hasStarted = useRef(false);

  const failedResults = results.filter((r) => r.status === "error");
  const succeededResults = results.filter((r) => r.status === "success");

  const applyResults = useCallback((next: CarryoverToggleResult[]) => {
    setResults(next);
    const failed = next.filter((r) => r.status === "error").length;
    const succeeded = next.filter((r) => r.status === "success").length;
    if (failed === 0) {
      setDialogState("success");
      setCountdown(AUTO_CLOSE_SECONDS);
    } else if (succeeded === 0) {
      setDialogState("failure");
    } else {
      setDialogState("partial-failure");
    }
  }, []);

  // Kick off on mount.
  useEffect(() => {
    if (hasStarted.current) return;
    hasStarted.current = true;
    void run(request)
      .then(applyResults)
      .catch((error: unknown) => {
        console.error("Carryover toggle failed", error);
        applyResults(buildRejectedResults(request, error));
      });
  }, [request, run, applyResults]);

  // Auto-close countdown for success.
  useEffect(() => {
    if (dialogState !== "success") return;
    if (countdown <= 0) {
      onClose();
      return;
    }
    const timer = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [dialogState, countdown, onClose]);

  async function handleRetry() {
    const failedMonths = failedResults.map((r) => r.month);
    if (failedMonths.length === 0) return;
    setDialogState("running");
    setResults([]);
    try {
      const retry = await run({ ...request, months: failedMonths });
      applyResults(retry);
    } catch (error) {
      console.error("Carryover toggle retry failed", error);
      applyResults(buildRejectedResults({ ...request, months: failedMonths }, error));
    }
  }

  const verbing = request.newValue ? "Enabling" : "Disabling";
  const verbed = request.newValue ? "enabled" : "disabled";
  const verbedTitle = request.newValue ? "Rollover enabled" : "Rollover disabled";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Carryover update progress"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
    >
      <div className="bg-background border border-border rounded-lg shadow-xl w-full max-w-md mx-4 p-5">
        {dialogState === "running" && (
          <>
            <div className="flex items-center gap-2 mb-4">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              <h2 className="text-base font-semibold text-foreground">
                {verbing} rollover
                {categoryLabel ? ` for ${categoryLabel}` : ""}
              </h2>
            </div>
            <p className="text-sm text-muted-foreground mb-3">
              {progress.total > 0
                ? `${progress.completed} of ${progress.total} months updated…`
                : "Preparing…"}
            </p>
            {progress.total > 0 && (
              <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary transition-all duration-150"
                  style={{
                    width: `${(progress.completed / progress.total) * 100}%`,
                  }}
                />
              </div>
            )}
          </>
        )}

        {dialogState === "success" && (
          <>
            <div className="flex items-center gap-2 mb-3">
              <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
              <h2 className="text-base font-semibold text-foreground">{verbedTitle}</h2>
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              Rollover {verbed} on {succeededResults.length} month
              {succeededResults.length !== 1 ? "s" : ""}
              {categoryLabel ? ` for ${categoryLabel}` : ""}.
            </p>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={onClose}
                className="px-3 py-1.5 text-sm rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                Close ({countdown})
              </button>
            </div>
          </>
        )}

        {(dialogState === "partial-failure" || dialogState === "failure") && (
          <>
            <div className="flex items-center gap-2 mb-3">
              <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
              <h2 className="text-base font-semibold text-foreground">
                {dialogState === "failure" ? "Rollover update failed" : "Partially updated"}
              </h2>
            </div>
            <p className="text-sm text-muted-foreground mb-3">
              {dialogState === "partial-failure"
                ? `${succeededResults.length} month${succeededResults.length !== 1 ? "s" : ""} updated, ${failedResults.length} failed.`
                : `${failedResults.length} month${failedResults.length !== 1 ? "s" : ""} could not be updated.`}
            </p>
            <div className="mb-4 max-h-44 overflow-y-auto rounded border border-border divide-y divide-border">
              {failedResults.map((r) => (
                <div key={r.month} className="px-3 py-2 text-xs">
                  <span className="font-mono text-foreground">{r.month}</span>
                  {r.message && (
                    <p className="text-destructive mt-0.5">{r.message}</p>
                  )}
                </div>
              ))}
            </div>
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={onClose}
                disabled={isPending}
                className="px-3 py-1.5 text-sm rounded border border-border text-foreground hover:bg-muted disabled:opacity-40 transition-colors"
              >
                Close
              </button>
              <button
                type="button"
                onClick={() => void handleRetry()}
                disabled={isPending}
                className="px-3 py-1.5 text-sm rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {isPending ? "Retrying…" : "Retry Failed"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
