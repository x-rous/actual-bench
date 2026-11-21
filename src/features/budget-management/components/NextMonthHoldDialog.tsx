"use client";

import { useEffect, useRef, useState } from "react";
import { formatMonthLabel } from "@/lib/budget/monthMath";
import { useBudgetEditsStore } from "@/store/budgetEdits";
import { Input } from "@/components/ui/input";
import { useRawMonthFromContext } from "../context/MonthsDataContext";
import { parseBudgetExpression } from "../lib/budgetMath";
import { formatMinor } from "../lib/format";

type Props = {
  month: string;
  onClose: () => void;
  /** Pre-fill the amount input (positive minor units). */
  defaultAmount?: number;
  /**
   * Server's current forNextMonth for this month (positive minor units, as
   * returned by the API). Used to build previousAmount in the staged hold.
   */
  currentForNextMonth: number;
  /** When true, hides the Clear Hold button — the caller handles clearing separately. */
  setOnly?: boolean;
};

/**
 * Envelope-mode: staged next-month budget hold dialog.
 *
 * Stages a hold (holdBudgetForNextMonth) or a hold clear (resetBudgetHold)
 * into the draft pipeline. The change is flushed to the server on Save.
 */
export function NextMonthHoldDialog({
  month,
  onClose,
  defaultAmount,
  currentForNextMonth,
  setOnly,
}: Props) {
  const stageHold = useBudgetEditsStore((s) => s.stageHold);
  const monthLabel = formatMonthLabel(month, "long");

  const [amountStr, setAmountStr] = useState(
    defaultAmount != null && defaultAmount > 0
      ? (defaultAmount / 100).toFixed(2)
      : ""
  );
  const [validationError, setValidationError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.select();
  }, []);

  const previousAmount = currentForNextMonth;

  // H5: holds are saved before budget edits, and Actual caps a hold at the
  // saved To Budget (after clearing the old hold) without reporting it. Check
  // against that same limit so a hold is never silently cut short. Money
  // freed by unsaved edits becomes holdable only after those edits are saved.
  const rawMonth = useRawMonthFromContext(month);
  const holdLimit = rawMonth
    ? Math.max(0, rawMonth.summary.toBudget + rawMonth.summary.forNextMonth)
    : null;

  const handleSet = () => {
    const parsed = parseBudgetExpression(amountStr);
    const amount = parsed.ok ? parsed.value : NaN;
    if (!Number.isFinite(amount) || !Number.isSafeInteger(amount) || amount < 0) {
      setValidationError("Please enter a valid amount (0 or greater).");
      return;
    }
    if (holdLimit !== null && amount > holdLimit) {
      setValidationError(
        holdLimit === 0
          ? "Nothing can be held: the saved To Budget for this month has no money left. Save any edits that free money first."
          : `Actual can hold at most ${formatMinor(holdLimit)} (the saved To Budget). Save any edits that free more money first.`
      );
      return;
    }
    setValidationError(null);
    stageHold({ month, nextAmount: amount, previousAmount });
    onClose();
  };

  const handleClear = () => {
    stageHold({ month, nextAmount: 0, previousAmount });
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Manage next month budget hold"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
    >
      <div className="bg-background border border-border rounded-lg shadow-xl w-full max-w-sm mx-4 p-5">
        <h2 className="text-base font-semibold mb-4">
          Hold for next month - {monthLabel}
        </h2>

        <div className="mb-4">
          <label htmlFor="hold-amount" className="block text-xs font-medium mb-1">
            Amount to hold
          </label>
          <Input
            ref={inputRef}
            id="hold-amount"
            type="text"
            inputMode="text"
            value={amountStr}
            onChange={(e) => setAmountStr(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && amountStr !== "") handleSet(); }}
            placeholder="0.00"
            size="sm"
            className="font-mono"
            aria-label="Hold amount in dollars"
          />
        </div>

        {holdLimit !== null && (
          <p className="text-xs text-muted-foreground mb-3">
            Available to hold: {formatMinor(holdLimit)}
          </p>
        )}

        {validationError && (
          <p className="text-xs text-destructive mb-3" role="alert">{validationError}</p>
        )}

        <div className="flex gap-2 justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-sm rounded border border-border hover:bg-muted transition-colors"
          >
            Cancel
          </button>
          {!setOnly && (
            <button
              type="button"
              onClick={handleClear}
              aria-label="Stage a hold clear for next month"
              className="px-3 py-1.5 text-sm rounded border border-border hover:bg-muted transition-colors"
            >
              Clear Hold
            </button>
          )}
          <button
            type="button"
            onClick={handleSet}
            disabled={amountStr === ""}
            aria-label="Stage the next month hold amount"
            className="px-3 py-1.5 text-sm rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Stage Hold
          </button>
        </div>
      </div>
    </div>
  );
}
