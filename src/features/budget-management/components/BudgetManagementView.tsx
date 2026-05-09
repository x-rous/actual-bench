"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { addMonths } from "@/lib/budget/monthMath";
import type { CellView } from "../types";
import { useBudgetMode } from "../hooks/useBudgetMode";
import { useAvailableMonths } from "../hooks/useAvailableMonths";
import { useMonthData } from "../hooks/useMonthData";
import { useBudgetEditsStore } from "@/store/budgetEdits";
import { useStagedStore, selectHasChanges } from "@/store/staged";
import { BudgetToolbar } from "./BudgetToolbar";
import { BudgetWorkspace } from "./BudgetWorkspace";
import { BudgetExportDialog } from "./BudgetExportDialog";
import { BudgetImportDialog } from "./BudgetImportDialog";
import { StagedCategoryTransferDialog } from "./StagedCategoryTransferDialog";
import { KeyboardShortcutsHelp } from "./KeyboardShortcutsHelp";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Compute 12 consecutive months from a start month string. */
function compute12Months(windowStart: string): string[] {
  return Array.from({ length: 12 }, (_, i) => addMonths(windowStart, i));
}

/** Default window start: January of the current year. */
function defaultWindowStart(): string {
  return `${new Date().getFullYear()}-01`;
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Top-level page shell for the Budget Management Workspace.
 *
 * Owns the 12-month window state and wires the navigation guard that
 * prevents accidental navigation away with unsaved staged changes.
 * Always displays exactly 12 consecutive months; the toolbar navigates
 * forward/backward by 1 month or 1 year.
 */
export function BudgetManagementView() {
  const { data: budgetMode, isLoading: modeLoading, error: modeError } = useBudgetMode();
  const { data: availableMonths, isLoading: monthsLoading, error: monthsError } = useAvailableMonths();
  const hasPendingEdits = useBudgetEditsStore((s) => s.hasPendingEdits);
  const edits = useBudgetEditsStore((s) => s.edits);
  const setDisplayMonths = useBudgetEditsStore((s) => s.setDisplayMonths);
  const hasEntityChanges = useStagedStore(selectHasChanges);
  const discardEntityChanges = useStagedStore((s) => s.discardAll);

  // The window start is the first of the 12 displayed months.
  // Defaults to January of the current year; user can navigate freely.
  const [windowStart, setWindowStart] = useState<string>(defaultWindowStart);
  const activeMonths = useMemo(() => compute12Months(windowStart), [windowStart]);
  const hasBudgetPendingEdits = Object.keys(edits).length > 0;
  const hasPushedNavigationGuard = useRef(false);

  // Keep display window in store so BudgetDraftPanel can show period details without props.
  useEffect(() => {
    setDisplayMonths(activeMonths);
  }, [activeMonths, setDisplayMonths]);

  const [cellView, setCellView] = useState<CellView>("budgeted");
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [transferState, setTransferState] = useState<{
    categoryId: string;
    month: string;
    mode: "cover" | "transfer";
  } | null>(null);
  const [shortcutsHelpOpen, setShortcutsHelpOpen] = useState(false);

  // Collapse state lifted here so BudgetToolbar can trigger expand/collapse all.
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(
    () => new Set()
  );
  const [showHidden, setShowHidden] = useState(true);

  const handleToggleGroupCollapse = useCallback((groupId: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  }, []);

  const handleExpandAll = useCallback(() => {
    setCollapsedGroups(new Set());
  }, []);

  // Navigation guard: warn before unload (tab close / refresh)
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!hasPendingEdits()) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasPendingEdits]);

  // Navigation guard: intercept browser back/forward when staged changes exist.
  useEffect(() => {
    if (!hasBudgetPendingEdits) {
      // BM-20: when pending edits clear without a popstate (e.g. user clicked
      // Save or discarded explicitly), consume the placeholder we previously
      // pushed so it doesn't linger as a duplicate entry in browser history.
      // The popstate "confirmed" branch below also clears the ref before its
      // own back() call, so we won't double-back here.
      if (hasPushedNavigationGuard.current) {
        hasPushedNavigationGuard.current = false;
        window.history.back();
      }
      return;
    }

    if (!hasPushedNavigationGuard.current) {
      window.history.pushState(null, "", window.location.href);
      hasPushedNavigationGuard.current = true;
    }

    const handlePopState = () => {
      if (!hasPendingEdits()) return;
      const confirmed = window.confirm(
        "You have unsaved budget changes. Leave this page and discard them?"
      );
      if (!confirmed) {
        window.history.pushState(null, "", window.location.href);
        hasPushedNavigationGuard.current = true;
        return;
      }

      useBudgetEditsStore.getState().discardAll();
      discardEntityChanges();
      hasPushedNavigationGuard.current = false;
      window.history.back();
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [discardEntityChanges, hasBudgetPendingEdits, hasPendingEdits]);

  const handleOpenExport = () => setExportDialogOpen(true);
  const handleCloseExport = () => setExportDialogOpen(false);
  const handleOpenImport = () => setImportDialogOpen(true);
  const handleCloseImport = () => setImportDialogOpen(false);
  const handleOpenTransfer = (
    categoryId: string,
    month: string,
    mode: "cover" | "transfer"
  ) => setTransferState({ categoryId, month, mode });
  const handleCloseTransfer = () => setTransferState(null);

  // When the import dialog imports months outside the current window,
  // move the window start to include them.
  const handleExtendRange = (months: string[]) => {
    if (months.length === 0) return;
    const sorted = [...months].sort();
    const firstImported = sorted[0]!;
    const windowEnd = addMonths(windowStart, 11);
    if (firstImported < windowStart || firstImported > windowEnd) {
      setWindowStart(firstImported.slice(0, 7));
    }
  };

  // Load the first existing month in the visible window for export/import
  // dialogs. A visible year can include leading months before the budget was
  // created; querying those months returns the API's expected 404.
  const firstAvailableActiveMonth =
    activeMonths.find((month) => availableMonths?.includes(month)) ?? null;
  const { data: firstMonthData } = useMonthData(firstAvailableActiveMonth);
  const groups = firstMonthData
    ? firstMonthData.groupOrder.map((id) => firstMonthData.groupsById[id]!).filter(Boolean)
    : [];
  const categoriesById = firstMonthData?.categoriesById ?? {};
  const categories = firstMonthData
    ? Object.values(firstMonthData.categoriesById)
    : [];

  const handleCollapseAll = useCallback(() => {
    setCollapsedGroups(new Set(firstMonthData?.groupOrder ?? []));
  }, [firstMonthData]);

  // ── Tier 3 keyboard shortcut handlers ────────────────────────────────────
  const handleCycleCellView = useCallback(() => {
    setCellView((v) => (v === "budgeted" ? "spent" : v === "spent" ? "balance" : "budgeted"));
  }, []);

  const handleToggleShowHidden = useCallback(() => {
    setShowHidden((v) => !v);
  }, []);

  const handlePanMonthsPrev = useCallback(() => {
    setWindowStart((s) => addMonths(s, -1));
  }, []);

  const handlePanMonthsNext = useCallback(() => {
    setWindowStart((s) => addMonths(s, 1));
  }, []);

  const isLoading = modeLoading || monthsLoading;
  const hasError = !!modeError || !!monthsError;

  if (isLoading) {
    return (
      <div className="flex flex-col h-full" aria-busy="true" aria-label="Loading budget management…">
        <div className="h-12 bg-muted/30 animate-pulse rounded m-4" />
        <div className="flex-1 bg-muted/10 animate-pulse rounded m-4" />
      </div>
    );
  }

  if (hasError) {
    return (
      <div className="flex items-center justify-center h-full p-8 text-destructive" role="alert">
        Failed to load budget management data. Please check your connection and try again.
      </div>
    );
  }

  // Entry guard: unsaved entity changes must be resolved before entering the budget page.
  if (hasEntityChanges) {
    return (
      <div className="flex flex-col h-full items-center justify-center p-8 gap-4">
        <div className="max-w-sm text-center space-y-2">
          <p className="font-semibold text-sm">Unsaved changes on another page</p>
          <p className="text-sm text-muted-foreground">
            Please save or discard your pending changes using the top bar before
            accessing Budget Management.
          </p>
          <button
            type="button"
            onClick={discardEntityChanges}
            className="mt-2 px-4 py-1.5 text-sm rounded border border-border hover:bg-muted transition-colors text-destructive"
          >
            Discard changes and continue
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <BudgetToolbar
        budgetMode={budgetMode ?? "unidentified"}
        windowStart={windowStart}
        onWindowChange={setWindowStart}
        cellView={cellView}
        onCellViewChange={setCellView}
        onExpandAll={handleExpandAll}
        onCollapseAll={handleCollapseAll}
        showHidden={showHidden}
        onToggleShowHidden={handleToggleShowHidden}
        onExport={handleOpenExport}
        onImport={handleOpenImport}
        onShowShortcuts={() => setShortcutsHelpOpen(true)}
      />

      <BudgetWorkspace
        budgetMode={budgetMode ?? "unidentified"}
        cellView={cellView}
        activeMonths={activeMonths}
        availableMonths={availableMonths ?? []}
        onCycleCellView={handleCycleCellView}
        onToggleShowHidden={handleToggleShowHidden}
        onExpandAll={handleExpandAll}
        onCollapseAll={handleCollapseAll}
        onPanMonthsPrev={handlePanMonthsPrev}
        onPanMonthsNext={handlePanMonthsNext}
        onOpenShortcutsHelp={() => setShortcutsHelpOpen(true)}
        collapsedGroups={collapsedGroups}
        onToggleCollapse={handleToggleGroupCollapse}
        showHidden={showHidden}
        onOpenTransfer={budgetMode === "envelope" ? handleOpenTransfer : undefined}
      />

      {exportDialogOpen && (
        <BudgetExportDialog
          availableMonths={availableMonths ?? []}
          activeMonths={activeMonths}
          groups={groups}
          categoriesById={categoriesById}
          stagedEdits={edits}
          onClose={handleCloseExport}
        />
      )}

      {importDialogOpen && (
        <BudgetImportDialog
          availableMonths={availableMonths ?? []}
          activeMonths={activeMonths}
          categories={categories}
          groups={groups}
          categoriesById={categoriesById}
          onClose={handleCloseImport}
          onExtendRange={handleExtendRange}
        />
      )}

      {transferState && (
        <StagedCategoryTransferDialog
          month={transferState.month}
          clickedCategoryId={transferState.categoryId}
          mode={transferState.mode}
          onClose={handleCloseTransfer}
        />
      )}

      <KeyboardShortcutsHelp
        open={shortcutsHelpOpen}
        onOpenChange={setShortcutsHelpOpen}
      />

    </div>
  );
}
