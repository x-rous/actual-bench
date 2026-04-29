"use client";

import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { useBudgetEditsStore } from "@/store/budgetEdits";
import { useMonthData } from "../hooks/useMonthData";
import { useAvailableMonths } from "../hooks/useAvailableMonths";
import { CellDetailsSection } from "./draft-panel/CellDetailsSection";
import { GroupDetailsSection } from "./draft-panel/GroupDetailsSection";
import { RowDetailsSection } from "./draft-panel/RowDetailsSection";
import { StagedChangesSection } from "./draft-panel/StagedChangesSection";
import { YearSummaryDataLoader } from "./draft-panel/YearSummary";

/**
 * Right-side draft panel for the Budget Management page.
 *
 * Routes between three modes based on `uiSelection` from the budget edits
 * store:
 *
 *   - cell selected   → `CellDetailsSection`
 *   - group selected  → `GroupDetailsSection`
 *   - nothing selected → year-summary view (`YearSummaryDataLoader`)
 *
 * Section 2 (`StagedChangesSection`) renders below whichever section was
 * chosen, whenever there are pending edits. The actual implementations live
 * in `components/draft-panel/`.
 *
 * Rendered by `AppShell` at the same layout slot as `DraftPanel` when the
 * pathname is `/budget-management`.
 */
export function BudgetDraftPanel() {
  const edits = useBudgetEditsStore((s) => s.edits);
  const { month: selectedMonth, categoryId: selectedCategoryId, groupId: selectedGroupId } =
    useBudgetEditsStore((s) => s.uiSelection);
  const rowSelection = useBudgetEditsStore((s) => s.rowSelection);
  const displayMonths = useBudgetEditsStore((s) => s.displayMonths);
  const { data: availableMonths } = useAvailableMonths();

  const totalCount = Object.keys(edits).length;
  const hasPendingEdits = totalCount > 0;

  // Fetch categories for the selected month (or first staged edit's month)
  // to resolve category names in StagedChangesSection.
  const lookupMonth =
    selectedMonth ?? Object.values(edits)[0]?.month ?? null;
  const { data: lookupMonthData } = useMonthData(lookupMonth);
  const allCategories = lookupMonthData
    ? Object.values(lookupMonthData.categoriesById)
    : [];

  // Routing: row selection takes precedence; otherwise fall back to cell or
  // group-cell selection; if nothing is selected, show the year summary.
  const showYearSummary =
    !rowSelection && !selectedCategoryId && !selectedGroupId;

  return (
    <aside className="flex w-[17rem] shrink-0 flex-col border-l border-border bg-background">
      <div className="flex items-center px-3 h-10 shrink-0">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Budget Details
        </span>
      </div>
      <Separator />

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {rowSelection ? (
          displayMonths.length > 0 ? (
            <RowDetailsSection
              row={rowSelection}
              displayMonths={displayMonths}
              availableMonths={availableMonths ?? []}
            />
          ) : (
            <div className="px-3 py-4 text-center text-[11px] text-muted-foreground">
              Loading…
            </div>
          )
        ) : showYearSummary ? (
          displayMonths.length > 0 ? (
            <YearSummaryDataLoader
              displayMonths={displayMonths}
              availableMonths={availableMonths ?? []}
            />
          ) : (
            <div className="px-3 py-4 text-center text-[11px] text-muted-foreground">
              Loading…
            </div>
          )
        ) : selectedGroupId ? (
          <GroupDetailsSection
            selectedMonth={selectedMonth}
            selectedGroupId={selectedGroupId}
            edits={edits}
          />
        ) : (
          <CellDetailsSection
            selectedMonth={selectedMonth}
            selectedCategoryId={selectedCategoryId}
            edits={edits}
          />
        )}

        {hasPendingEdits && (
          <>
            <Separator />
            <div className="flex items-center justify-between px-3 h-10 shrink-0">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Staged Changes
              </span>
              <Badge variant="outline" className="text-xs text-amber-600 border-amber-300">
                {totalCount} change{totalCount !== 1 ? "s" : ""}
              </Badge>
            </div>
            <Separator />
            <StagedChangesSection edits={edits} allCategories={allCategories} />
          </>
        )}
      </div>
    </aside>
  );
}
