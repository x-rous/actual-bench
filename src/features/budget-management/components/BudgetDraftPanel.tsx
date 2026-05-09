"use client";

import { useState } from "react";
import { Separator } from "@/components/ui/separator";
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
  const [dialogOpen, setDialogOpen] = useState(false);

  const changeCount = countLogicalEdits(edits);

  return (
    <aside
      className="flex w-[17rem] shrink-0 flex-col border-l border-border bg-background"
      data-budget-details-panel>
      <div className="flex items-center justify-between px-3 shrink-0 h-[2.7rem]">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Budget Details
        </span>
        {changeCount > 0 && (
          <Badge
            render={<button type="button" />}
            variant="outline"
            className="text-amber-600 border-amber-300 dark:text-amber-400 dark:border-amber-700 cursor-pointer hover:bg-amber-50 dark:hover:bg-amber-950/20"
            onClick={() => setDialogOpen(true)}
            aria-label={`${changeCount} staged change${changeCount !== 1 ? "s" : ""} — click to review`}
            title="Review staged changes"
          >
            {changeCount} {changeCount === 1 ? "change" : "changes"}
          </Badge>
        )}
      </div>
      <Separator />

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <BudgetDetailsPanel />
      </div>

      {dialogOpen && (
        <StagedChangesDialog onClose={() => setDialogOpen(false)} />
      )}
    </aside>
  );
}
