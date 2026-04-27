"use client";

import { useState } from "react";
import { ArrowRight, Undo2 } from "lucide-react";
import { useNextMonthHold } from "../../hooks/useNextMonthHold";
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
}: {
  month: string;
  forNextMonth: number;
  onConfirm: () => void;
  onCancel: () => void;
  isPending: boolean;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Confirm free hold"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
    >
      <div className="bg-background border border-border rounded-lg shadow-xl w-full max-w-xs mx-4 p-4">
        <p className="text-sm font-medium text-foreground mb-0.5">
          Free the hold for <span className="font-mono">{month}</span>?
        </p>
        <p className="text-xs text-muted-foreground mb-3">
          Currently holding{" "}
          <span className="font-semibold tabular-nums text-foreground">
            {(forNextMonth / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}
          </span>
        </p>
        <p className="text-xs bg-amber-50 dark:bg-amber-950/20 text-amber-700 dark:text-amber-400 rounded px-2.5 py-1.5 mb-4">
          This action takes effect immediately and does not go through the save panel.
        </p>
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
 * The chevron toggle button rendered inside the envelope mode "To Budget"
 * summary cell. Click → opens either the set-hold dialog or the clear-hold
 * confirmation depending on whether a hold is currently active for `month`.
 */
export function HoldToggleButton({
  month,
  forNextMonth,
  toBudget,
}: {
  month: string;
  forNextMonth: number;
  toBudget: number;
}) {
  const holdActive = forNextMonth !== 0;
  const { clearHold, isPending } = useNextMonthHold();
  const [showSetDialog, setShowSetDialog] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (holdActive) {
      setShowConfirm(true);
    } else {
      setShowSetDialog(true);
    }
  };

  const handleConfirmClear = async () => {
    await clearHold(month);
    setShowConfirm(false);
  };

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        title={
          holdActive
            ? `Held: ${(forNextMonth / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })} — click to free`
            : "Hold funds for next month"
        }
        className={`group flex items-center justify-center w-5 h-5 rounded transition-colors shrink-0 ${
          holdActive
            ? "text-blue-500 dark:text-blue-400 hover:text-orange-500 dark:hover:text-orange-400"
            : "text-muted-foreground/30 hover:text-muted-foreground/70"
        }`}
      >
        {holdActive ? (
          <>
            <ArrowRight className="h-3 w-3 group-hover:hidden" aria-hidden="true" />
            <Undo2 className="h-3 w-3 hidden group-hover:block" aria-hidden="true" />
          </>
        ) : (
          <ArrowRight className="h-3 w-3" aria-hidden="true" />
        )}
      </button>

      {showSetDialog && (
        <NextMonthHoldDialog
          month={month}
          defaultAmount={toBudget > 0 ? toBudget : undefined}
          setOnly
          onClose={() => setShowSetDialog(false)}
        />
      )}

      {showConfirm && (
        <HoldClearConfirmDialog
          month={month}
          forNextMonth={forNextMonth}
          onConfirm={() => void handleConfirmClear()}
          onCancel={() => setShowConfirm(false)}
          isPending={isPending}
        />
      )}
    </>
  );
}
