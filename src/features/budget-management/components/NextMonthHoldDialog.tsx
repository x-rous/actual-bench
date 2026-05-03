"use client";

import { useState } from "react";
import { formatMonthLabel } from "@/lib/budget/monthMath";
import { useNextMonthHold } from "../hooks/useNextMonthHold";

type Props = {
  month: string;
  onClose: () => void;
  /** Pre-fill the amount input (minor units). */
  defaultAmount?: number;
  /** When true, hides the Clear Hold button — the caller handles clearing separately. */
  setOnly?: boolean;
};

/**
 * Envelope-mode: immediate next-month budget hold dialog.
 *
 * Lets users set or clear the hold for a given month.
 * Displays a disclaimer that the action is immediate and bypasses the save panel.
 */
export function NextMonthHoldDialog({ month, onClose, defaultAmount, setOnly }: Props) {
  const { setHold, clearHold, isPending, error } = useNextMonthHold();
  const monthLabel = formatMonthLabel(month, "long");

  const [amountStr, setAmountStr] = useState(
    defaultAmount != null && defaultAmount > 0
      ? (defaultAmount / 100).toFixed(2)
      : ""
  );
  const [done, setDone] = useState(false);
  const [lastAction, setLastAction] = useState<"clear" | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  const handleSet = async () => {
    const amount = Math.round(parseFloat(amountStr) * 100);
    if (isNaN(amount) || amount < 0) {
      setValidationError("Please enter a valid amount (0 or greater).");
      return;
    }
    setValidationError(null);
    try {
      await setHold(month, { amount });
      onClose();
    } catch {
      // error is set by the hook
    }
  };

  const handleClear = async () => {
    try {
      await clearHold(month);
      setLastAction("clear");
      setDone(true);
    } catch {
      // error is set by the hook
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Manage next month budget hold"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
    >
      <div className="bg-background border border-border rounded-lg shadow-xl w-full max-w-sm mx-4 p-5">
        {!done ? (
          <>
            <h2 className="text-base font-semibold mb-4">
              Hold for next month — {monthLabel}
            </h2>

            <div className="mb-4">
              <label htmlFor="hold-amount" className="block text-sm font-medium mb-1">
                Amount to hold
              </label>
              <input
                id="hold-amount"
                type="number"
                min="0"
                step="0.01"
                value={amountStr}
                onChange={(e) => setAmountStr(e.target.value)}
                disabled={isPending}
                placeholder="0.00"
                className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background font-mono"
                aria-label="Hold amount in dollars"
              />
            </div>

            <div
              className="mb-4 p-2 rounded bg-orange-50 dark:bg-orange-950/20 text-xs text-orange-700 dark:text-orange-400"
              role="note"
            >
              This action applies immediately and does not go through the save panel.
            </div>

            {validationError && (
              <p className="text-xs text-destructive mb-3" role="alert">{validationError}</p>
            )}
            {error && (
              <p className="text-xs text-destructive mb-3" role="alert">{error}</p>
            )}

            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={onClose}
                disabled={isPending}
                className="px-3 py-1.5 text-sm rounded border border-border hover:bg-muted disabled:opacity-40 transition-colors"
              >
                Cancel
              </button>
              {!setOnly && (
                <button
                  type="button"
                  onClick={() => void handleClear()}
                  disabled={isPending}
                  aria-label="Clear the next month hold immediately"
                  className="px-3 py-1.5 text-sm rounded border border-border hover:bg-muted disabled:opacity-40 transition-colors"
                >
                  {isPending && lastAction === "clear" ? "Clearing…" : "Clear Hold"}
                </button>
              )}
              <button
                type="button"
                onClick={() => void handleSet()}
                disabled={isPending || amountStr === ""}
                aria-label="Set the next month hold amount immediately"
                className="px-3 py-1.5 text-sm rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {isPending ? "Saving…" : "Set Hold"}
              </button>
            </div>
          </>
        ) : (
          <>
            <h2 className="text-base font-semibold mb-3">Hold Cleared</h2>
            <p className="text-sm text-muted-foreground mb-4">
              The next-month hold has been cleared. The grid has been updated.
            </p>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={onClose}
                className="px-3 py-1.5 text-sm rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                Done
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
