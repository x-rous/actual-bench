"use client";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/**
 * O1: a feature the period-by-period calculation cannot represent. The switch
 * happens only on "Switch to day-by-day"; Cancel leaves the feature off and
 * the simulation unchanged. Never silent.
 */
export function DayByDayPrompt({ reason, onSwitch, onCancel }: { reason: string | null; onSwitch: () => void; onCancel: () => void }) {
  return (
    <Dialog open={reason !== null} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>This feature needs day-by-day interest calculation</DialogTitle>
          <DialogDescription>
            {reason} Switching changes how interest is worked out: it accrues each day and is still charged with each repayment. Every other setting stays as it is, and nothing is saved until you save the loan.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={onSwitch}>Switch to day-by-day</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
