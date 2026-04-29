"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatMinor } from "../lib/format";
import { buildBudgetSaveReviewSummary } from "../lib/budgetSaveReview";
import type { BudgetCellKey, StagedBudgetEdit } from "../types";

type Props = {
  edits: Record<BudgetCellKey, StagedBudgetEdit>;
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
  onCancel,
  onConfirm,
}: Props) {
  const [skipReviewNextTime, setSkipReviewNextTime] = useState(false);
  const summary = useMemo(
    () => buildBudgetSaveReviewSummary(edits),
    [edits]
  );
  const monthRows = useMemo(
    () =>
      summary.months.map((month) => ({
        month: month.month,
        label: month.label,
        changeCount: month.entries.length,
        totalDelta: month.totalDelta,
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
                {summary.editCount}
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
                <th className="w-16 px-2 py-1.5 text-right font-medium">Edits</th>
                <th className="w-24 px-2 py-1.5 text-right font-medium">Net</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {monthRows.map((row) => (
                <tr key={row.month}>
                  <td className="truncate px-2 py-1.5 font-medium text-foreground">
                    {row.label}
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
          <label className="flex min-w-0 flex-1 items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={skipReviewNextTime}
              onChange={(e) => setSkipReviewNextTime(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-border"
            />
            Skip review next time
          </label>
          <div className="flex shrink-0 items-center gap-2">
            <Button variant="outline" onClick={onCancel}>
              Cancel
            </Button>
            <Button
              onClick={() => onConfirm(skipReviewNextTime)}
              disabled={summary.editCount === 0}
            >
              Save {summary.editCount} change{summary.editCount !== 1 ? "s" : ""}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
