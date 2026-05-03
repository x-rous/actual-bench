"use client";

import { useState } from "react";
import { ArrowRight, Undo2 } from "lucide-react";
import { formatMonthLabel } from "@/lib/budget/monthMath";
import { useNextMonthHold } from "../../hooks/useNextMonthHold";
import { formatMinor } from "../../lib/format";
import { NextMonthHoldDialog } from "../NextMonthHoldDialog";

/**
 * Confirmation dialog before clearing an active "next-month hold". Lifted
 * here from `BudgetGrid` so the envelope-mode hold flow is in one place.
 */
function HoldClearConfirmDialog({
  month,
  forNextMonth,
  onConfirm,
  onCancel,
  isPending,
  error,
}: {
  month: string;
  forNextMonth: number;
  onConfirm: () => void;
  onCancel: () => void;
  isPending: boolean;
  error: string | null;
}) {
  const monthLabel = formatMonthLabel(month, "long");

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Confirm free hold"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
    >
      <div className="bg-background border border-border rounded-lg shadow-xl w-full max-w-xs mx-4 p-4">
        <p className="text-sm font-medium text-foreground mb-0.5">
          Free held amount for {monthLabel}?
        </p>
        <p className="text-xs text-muted-foreground mb-3">
          Currently held:{" "}
          <span className="font-semibold tabular-nums text-foreground">
            {formatMinor(Math.abs(forNextMonth))}
          </span>
        </p>
        <p className="text-xs bg-amber-50 dark:bg-amber-950/20 text-amber-700 dark:text-amber-400 rounded px-2.5 py-1.5 mb-4">
          This action applies immediately and does not go through the save panel.
        </p>
        {error && (
          <p className="text-xs text-destructive mb-3" role="alert">
            {error}
          </p>
        )}
        <div className="flex gap-2 justify-end">
          <button
            type="button"
            onClick={onCancel}
            disabled={isPending}
            className="px-3 py-1.5 text-sm text-foreground rounded border border-border hover:bg-muted disabled:opacity-40 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isPending}
            className="px-3 py-1.5 text-sm text-foreground rounded border border-border hover:bg-muted disabled:opacity-40 transition-colors"
          >
            {isPending ? "Clearing…" : "Free Hold"}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Gray hold action rendered beside the envelope "To Budget" value when money
 * is available and no hold is active for that month.
 */
export function HoldMoneyButton({
  month,
  forNextMonth,
  toBudget,
}: {
  month: string;
  forNextMonth: number;
  toBudget: number;
}) {
  const [showSetDialog, setShowSetDialog] = useState(false);
  const holdActive = forNextMonth !== 0;
  const canHold = !holdActive && toBudget > 0;

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowSetDialog(true);
  };

  if (!canHold) return null;

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        title="Hold money for next month"
        aria-label="Hold money for next month"
        className="flex items-center justify-center w-5 h-5 rounded text-muted-foreground/40 hover:text-muted-foreground/80 transition-colors shrink-0"
      >
        <ArrowRight className="h-3 w-3" aria-hidden="true" />
      </button>

      {showSetDialog && (
        <NextMonthHoldDialog
          month={month}
          defaultAmount={toBudget > 0 ? toBudget : undefined}
          setOnly
          onClose={() => setShowSetDialog(false)}
        />
      )}
    </>
  );
}

/**
 * Amber free action rendered beside the envelope "Hold for next month" value
 * whenever a hold is active for that month.
 */
export function FreeHeldAmountButton({
  month,
  forNextMonth,
}: {
  month: string;
  forNextMonth: number;
}) {
  const { clearHold, isPending, error } = useNextMonthHold();
  const [showConfirm, setShowConfirm] = useState(false);

  if (forNextMonth === 0) return null;

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowConfirm(true);
  };

  const handleConfirmClear = async () => {
    try {
      await clearHold(month);
      setShowConfirm(false);
    } catch {
      // error is set by the hook and shown in the confirmation dialog.
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        title="Free held amount"
        aria-label="Free held amount"
        className="flex items-center justify-center w-5 h-5 rounded text-amber-600 hover:text-amber-700 dark:text-amber-400 dark:hover:text-amber-300 disabled:opacity-40 transition-colors shrink-0"
      >
        <Undo2 className="h-3 w-3" aria-hidden="true" />
      </button>

      {showConfirm && (
        <HoldClearConfirmDialog
          month={month}
          forNextMonth={forNextMonth}
          onConfirm={() => void handleConfirmClear()}
          onCancel={() => setShowConfirm(false)}
          isPending={isPending}
          error={error}
        />
      )}
    </>
  );
}
