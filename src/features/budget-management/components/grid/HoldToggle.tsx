"use client";

import { useState } from "react";
import { ArrowRight, Undo2 } from "lucide-react";
import { useBudgetEditsStore } from "@/store/budgetEdits";
import { NextMonthHoldDialog } from "../NextMonthHoldDialog";

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
          currentForNextMonth={forNextMonth}
          setOnly
          onClose={() => setShowSetDialog(false)}
        />
      )}
    </>
  );
}

/**
 * Amber free action rendered beside the envelope "Hold for next month" value
 * whenever a hold is active for that month. Staging a clear is reversible via
 * undo, so no confirmation dialog is needed.
 */
export function FreeHeldAmountButton({
  month,
  forNextMonth,
}: {
  month: string;
  forNextMonth: number;
}) {
  const stageHold = useBudgetEditsStore((s) => s.stageHold);
  const holds = useBudgetEditsStore((s) => s.holds);

  if (forNextMonth === 0) return null;

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    // previousAmount: use the server's original value. If a staged hold exists,
    // its previousAmount IS the server's original. Otherwise the effective
    // forNextMonth equals the server value directly (no hold staged yet).
    const previousAmount = holds[month]?.previousAmount ?? forNextMonth;
    stageHold({ month, nextAmount: 0, previousAmount });
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      title="Free held amount"
      aria-label="Free held amount"
      className="flex items-center justify-center w-5 h-5 rounded text-amber-600 hover:text-amber-700 dark:text-amber-400 dark:hover:text-amber-300 transition-colors shrink-0"
    >
      <Undo2 className="h-3 w-3" aria-hidden="true" />
    </button>
  );
}
