"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { useBudgetSave } from "../hooks/useBudgetSave";
import { useBudgetEditsStore } from "@/store/budgetEdits";
import type { BudgetCellKey, BudgetSaveResult, StagedBudgetEdit, StagedHold } from "../types";

type Props = {
  edits: Record<BudgetCellKey, StagedBudgetEdit>;
  holds?: Record<string, StagedHold>;
  onClose: () => void;
};

type DialogState = "saving" | "success" | "partial-failure" | "failure";

const AUTO_CLOSE_SECONDS = 3;

function getSaveErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Budget save failed.";
}

function buildRejectedSaveResults(
  edits: Record<BudgetCellKey, StagedBudgetEdit>,
  error: unknown
): BudgetSaveResult[] {
  const message = getSaveErrorMessage(error);

  return Object.values(edits).map((edit) => ({
    month: edit.month,
    categoryId: edit.categoryId,
    status: "error",
    message,
  }));
}

export function BudgetSaveProgressDialog({ edits, holds = {}, onClose }: Props) {
  const { save, isSaving, progress } = useBudgetSave();
  const [results, setResults] = useState<BudgetSaveResult[]>([]);
  const [dialogState, setDialogState] = useState<DialogState>("saving");
  const [countdown, setCountdown] = useState(AUTO_CLOSE_SECONDS);
  const hasStarted = useRef(false);

  const failedResults = results.filter((r) => r.status === "error");
  const succeededResults = results.filter((r) => r.status === "success");
  const successMonths = [...new Set(succeededResults.map((r) => r.month))].sort();

  const applyResults = useCallback((saveResults: BudgetSaveResult[]) => {
    setResults(saveResults);
    const failed = saveResults.filter((r) => r.status === "error").length;
    const succeeded = saveResults.filter((r) => r.status === "success").length;
    if (failed === 0) {
      setDialogState("success");
      setCountdown(AUTO_CLOSE_SECONDS);
    } else if (succeeded === 0) {
      setDialogState("failure");
    } else {
      setDialogState("partial-failure");
    }
  }, []);

  // Start saving on mount
  useEffect(() => {
    if (hasStarted.current) return;
    hasStarted.current = true;
    void save(edits, holds)
      .then(applyResults)
      .catch((error: unknown) => {
        console.error("Budget save failed", error);
        applyResults(buildRejectedSaveResults(edits, error));
      });
  }, [edits, holds, save, applyResults]);

  // Auto-close countdown for success state
  useEffect(() => {
    if (dialogState !== "success") return;
    if (countdown <= 0) { onClose(); return; }
    const timer = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [dialogState, countdown, onClose]);

  async function handleRetry() {
    const currentEdits = useBudgetEditsStore.getState().edits;
    const failedKeys = new Set(
      failedResults.map((r) => `${r.month}:${r.categoryId}` as BudgetCellKey)
    );
    const retryEdits: Record<BudgetCellKey, StagedBudgetEdit> = {};
    for (const [key, edit] of Object.entries(currentEdits)) {
      if (failedKeys.has(key as BudgetCellKey)) {
        retryEdits[key as BudgetCellKey] = edit;
      }
    }
    // Retry failed hold months too.
    const failedHoldMonths = new Set(
      failedResults.filter((r) => r.categoryId === "").map((r) => r.month)
    );
    const currentHolds = useBudgetEditsStore.getState().holds;
    const retryHolds: Record<string, StagedHold> = {};
    for (const [month, hold] of Object.entries(currentHolds)) {
      if (failedHoldMonths.has(month)) retryHolds[month] = hold;
    }

    setDialogState("saving");
    setResults([]);
    try {
      const retryResults = await save(retryEdits, retryHolds);
      applyResults(retryResults);
    } catch (error) {
      console.error("Budget save retry failed", error);
      applyResults(buildRejectedSaveResults(retryEdits, error));
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Budget save progress"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
    >
      <div className="bg-background border border-border rounded-lg shadow-xl w-full max-w-md mx-4 p-5">

        {dialogState === "saving" && (
          <>
            <div className="flex items-center gap-2 mb-4">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              <h2 className="text-base font-semibold text-foreground">Saving budget changes</h2>
            </div>
            <p className="text-sm text-muted-foreground mb-3">
              {progress.total > 0
                ? `${progress.completed} of ${progress.total} changes saved…`
                : "Preparing…"}
            </p>
            {progress.total > 0 && (
              <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary transition-all duration-150"
                  style={{ width: `${(progress.completed / progress.total) * 100}%` }}
                />
              </div>
            )}
          </>
        )}

        {dialogState === "success" && (
          <>
            <div className="flex items-center gap-2 mb-3">
              <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
              <h2 className="text-base font-semibold text-foreground">All changes saved</h2>
            </div>
            <p className="text-sm text-muted-foreground mb-1">
              {succeededResults.length} change{succeededResults.length !== 1 ? "s" : ""} saved
              {successMonths.length > 0 && ` across ${successMonths.length} month${successMonths.length !== 1 ? "s" : ""}`}.
            </p>
            {successMonths.length > 0 && (
              <p className="text-xs text-muted-foreground mb-4">{successMonths.join(", ")}</p>
            )}
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
                {dialogState === "failure" ? "Save failed" : "Partially saved"}
              </h2>
            </div>
            <p className="text-sm text-muted-foreground mb-3">
              {dialogState === "partial-failure"
                ? `${succeededResults.length} change${succeededResults.length !== 1 ? "s" : ""} saved, ${failedResults.length} failed.`
                : `${failedResults.length} change${failedResults.length !== 1 ? "s" : ""} could not be saved.`}
            </p>
            <div className="mb-4 max-h-44 overflow-y-auto rounded border border-border divide-y divide-border">
              {failedResults.map((r) => (
                <div key={`${r.month}:${r.categoryId}`} className="px-3 py-2 text-xs">
                  <span className="font-mono text-foreground">{r.month}</span>
                  <span className="mx-1 text-muted-foreground">/</span>
                  <span className="font-mono text-muted-foreground">{r.categoryId}</span>
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
                disabled={isSaving}
                className="px-3 py-1.5 text-sm rounded border border-border text-foreground hover:bg-muted disabled:opacity-40 transition-colors"
              >
                Close
              </button>
              <button
                type="button"
                onClick={() => void handleRetry()}
                disabled={isSaving}
                className="px-3 py-1.5 text-sm rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {isSaving ? "Retrying…" : "Retry Failed"}
              </button>
            </div>
          </>
        )}

      </div>
    </div>
  );
}
