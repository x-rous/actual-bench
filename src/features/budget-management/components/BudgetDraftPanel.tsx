"use client";

import { cn } from "@/lib/utils";
import { useState } from "react";
import { PendingPanelFrame } from "@/components/layout/PendingPanelFrame";
import { Badge } from "@/components/ui/badge";
import { useBudgetEditsStore } from "@/store/budgetEdits";
import { countLogicalEdits } from "./draft-panel/StagedChangesSection";
import { StagedChangesDialog } from "./StagedChangesDialog";
import { BudgetDetailsPanel } from "./details/BudgetDetailsPanel";

/**
 * Right-side draft panel for the Budget Management page.
 *
 * Rendered by `AppShell` at the same layout slot as `DraftPanel` when the
 * pathname is `/budget-management`.
 */
export function BudgetDraftPanel() {
  const edits = useBudgetEditsStore((s) => s.edits);
  const holds = useBudgetEditsStore((s) => s.holds);
  const [dialogOpen, setDialogOpen] = useState(false);

  const changeCount = countLogicalEdits(edits, holds);
  const errorCount = [...Object.values(edits), ...Object.values(holds)].filter(edit => edit.saveError).length;

  return (
    <PendingPanelFrame data-budget-details-panel title="Budget details" displayTitle="Budget" count={changeCount} errors={errorCount} collapsible={false} width="w-72" badge={
        changeCount > 0 ? (
          <Badge
            render={<button type="button" />}
            variant={errorCount ? "destructive" : "outline"}
            className={cn("h-5 shrink-0 cursor-pointer px-1.5 text-[10px] tabular-nums", !errorCount && "text-amber-600 border-amber-300 dark:text-amber-400 dark:border-amber-700 hover:bg-amber-50 dark:hover:bg-amber-950/20")}
            onClick={() => setDialogOpen(true)}
            aria-label={`${changeCount} staged change${changeCount !== 1 ? "s" : ""} - click to review`}
            title="Review staged changes"
          >
            {errorCount ? `! ${errorCount}` : changeCount}
          </Badge>
        ) : null
      }>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <BudgetDetailsPanel />
      </div>

      {dialogOpen && (
        <StagedChangesDialog onClose={() => setDialogOpen(false)} />
      )}
    </PendingPanelFrame>
  );
}
