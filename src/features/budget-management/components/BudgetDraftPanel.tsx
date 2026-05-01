"use client";

import { Separator } from "@/components/ui/separator";
import { BudgetDetailsPanel } from "./details/BudgetDetailsPanel";

/**
 * Right-side draft panel for the Budget Management page.
 *
 * Rendered by `AppShell` at the same layout slot as `DraftPanel` when the
 * pathname is `/budget-management`.
 */
export function BudgetDraftPanel() {
  return (
    <aside
      className="flex w-[17rem] shrink-0 flex-col border-l border-border bg-background"
      data-budget-details-panel
    >
      <div className="flex items-center px-3 h-10 shrink-0">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Budget Details
        </span>
      </div>
      <Separator />

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <BudgetDetailsPanel />
      </div>
    </aside>
  );
}
