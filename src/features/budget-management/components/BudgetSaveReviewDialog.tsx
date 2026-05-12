"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatMinor } from "../lib/format";
import { buildBudgetSaveReviewSummary } from "../lib/budgetSaveReview";
import type { BudgetCellKey, StagedBudgetEdit, StagedHold } from "../types";

type Props = {
  edits: Record<BudgetCellKey, StagedBudgetEdit>;
  holds?: Record<string, StagedHold>;
  onCancel: () => void;
  onConfirm: (skipReviewNextTime: boolean) => void;
};

function formatDeltaAmount(delta: number): string {
  if (delta === 0) return "0.00";
  const sign = delta > 0 ? "+" : "-";
  return `${sign}${formatMinor(Math.abs(delta))}`;
}

export function BudgetSaveReviewDialog({
  edits,
  holds = {},
  onCancel,
  onConfirm,
}: Props) {
  const [skipReviewNextTime, setSkipReviewNextTime] = useState(false);
  const summary = useMemo(
    () => buildBudgetSaveReviewSummary(edits, {}, holds),
    [edits, holds]
  );
  const totalCount = summary.editCount + summary.holdCount;

  const monthRows = useMemo(
    () =>
      summary.months.map((month) => ({
        month: month.month,
        label: month.label,
        changeCount: month.entries.length + (month.hold ? 1 : 0),
        totalDelta: month.totalDelta,
        hold: month.hold,
      })),
    [summary.months]
  );

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onCancel(); }}>
      <DialogContent
        showCloseButton={false}
        className="max-w-lg gap-3 p-0 sm:max-w-lg max-h-[92vh]"
      >
        <DialogHeader className="gap-1 px-4 pt-4">
          <DialogTitle>Review save summary</DialogTitle>
          <DialogDescription className="text-xs">
            Confirm the staged budget totals before sending changes to the server.
          </DialogDescription>
        </DialogHeader>

        <div className="px-4">
          <div className="grid grid-cols-3 overflow-hidden rounded-md border border-border text-xs">
            <div className="border-r border-border px-2 py-2">
              <p className="text-[10px] uppercase text-muted-foreground">Changes</p>
              <p className="font-semibold text-foreground tabular-nums">
                {totalCount}
              </p>
            </div>
            <div className="border-r border-border px-2 py-2">
              <p className="text-[10px] uppercase text-muted-foreground">Months</p>
              <p className="font-semibold text-foreground tabular-nums">
                {summary.monthCount}
              </p>
            </div>
            <div className="border-r border-border px-2 py-2">
              <p className="text-[10px] uppercase text-muted-foreground">Net</p>
              <p
                className={`font-semibold tabular-nums ${
                  summary.totalDelta >= 0
                    ? "text-emerald-700 dark:text-emerald-400"
                    : "text-destructive"
                }`}
              >
                {formatDeltaAmount(summary.totalDelta)}
              </p>
            </div>
          </div>
        </div>

        <div className="mx-4 rounded-md border border-border">
          <table className="w-full table-fixed text-xs">
            <thead className="bg-muted text-[10px] uppercase text-muted-foreground">
              <tr>
                <th className="px-2 py-1.5 text-left font-medium">Month</th>
                <th className="w-16 px-2 py-1.5 text-right font-medium">Changes</th>
                <th className="w-24 px-2 py-1.5 text-right font-medium">Net</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {monthRows.map((row) => (
                <tr key={row.month}>
                  <td className="px-2 py-1.5 font-medium text-foreground">
                    <div className="truncate">{row.label}</div>
                    {row.hold && (
                      <div className="text-[10px] font-normal text-muted-foreground mt-0.5">
                        Hold:{" "}
                        {row.hold.nextAmount === 0 ? (
                          <span className="line-through">{formatMinor(row.hold.previousAmount)}</span>
                        ) : (
                          formatMinor(row.hold.nextAmount)
                        )}
                      </div>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">
                    {row.changeCount}
                  </td>
                  <td
                    className={`px-2 py-1.5 text-right font-medium tabular-nums ${
                      row.totalDelta >= 0
                        ? "text-emerald-700 dark:text-emerald-400"
                        : "text-destructive"
                    }`}
                  >
                    {formatDeltaAmount(row.totalDelta)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex items-center gap-3 border-t border-border px-4 py-3">
          <div className="flex min-w-0 flex-1 items-center gap-2 text-xs text-muted-foreground">
            <Checkbox
              aria-labelledby="skip-budget-save-review-label"
              checked={skipReviewNextTime}
              onCheckedChange={(checked) => setSkipReviewNextTime(Boolean(checked))}
            />
            <label
              id="skip-budget-save-review-label"
              className="cursor-pointer"
              onClick={() => setSkipReviewNextTime((checked) => !checked)}
            >
              Skip review next time
            </label>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button variant="outline" onClick={onCancel}>
              Cancel
            </Button>
            <Button
              onClick={() => onConfirm(skipReviewNextTime)}
              disabled={totalCount === 0}
            >
              Save {totalCount} change{totalCount !== 1 ? "s" : ""}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
