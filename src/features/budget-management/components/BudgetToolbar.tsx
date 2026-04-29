"use client";

import { ChevronsLeft, ChevronsRight, ChevronLeft, ChevronRight, CalendarDays, Upload, Download, ChevronsDownUp, ChevronsUpDown, Eye, EyeOff, Keyboard } from "lucide-react";
import { addMonths, formatMonthLabel } from "@/lib/budget/monthMath";
import type { BudgetMode, CellView } from "../types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Format a YYYY-MM window as "Jan 26 – Dec 26". */
function formatWindowRange(start: string): string {
  const end = addMonths(start, 11);
  return `${formatMonthLabel(start)} – ${formatMonthLabel(end)}`;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MODE_LABELS: Record<BudgetMode, string> = {
  envelope: "Envelope",
  tracking: "Tracking",
  unidentified: "Unknown",
};

const MODE_COLORS: Record<BudgetMode, string> = {
  envelope: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  tracking: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  unidentified: "bg-muted text-muted-foreground",
};

const CELL_VIEW_LABELS: Record<CellView, string> = {
  budgeted: "Budget",
  spent: "Actuals",
  balance: "Balance",
};

// ─── Props ────────────────────────────────────────────────────────────────────

type Props = {
  budgetMode: BudgetMode;
  /** First month of the 12-month display window (YYYY-MM). */
  windowStart: string;
  onWindowChange: (start: string) => void;
  cellView: CellView;
  onCellViewChange: (view: CellView) => void;
  onExpandAll?: () => void;
  onCollapseAll?: () => void;
  showHidden?: boolean;
  onToggleShowHidden?: () => void;
  onExport?: () => void;
  onImport?: () => void;
  /** Open the keyboard-shortcuts cheatsheet modal. */
  onShowShortcuts?: () => void;
};

function Divider() {
  return <div className="w-px h-5 bg-border/60 mx-1 shrink-0" aria-hidden="true" />;
}

/**
 * Top toolbar for the Budget Management Workspace.
 *
 * Contains:
 * - Budget mode badge
 * - 12-month window navigator (±1 month, ±1 year with range label)
 * - Cell-view toggle (Budget / Spent / Balance)
 * - Action buttons (Bulk, Import, Export, Transfer, Hold)
 * - Save area (Discard, Save)
 */
export function BudgetToolbar({
  budgetMode,
  windowStart,
  onWindowChange,
  cellView,
  onCellViewChange,
  onExpandAll,
  onCollapseAll,
  showHidden,
  onToggleShowHidden,
  onExport,
  onImport,
  onShowShortcuts,
}: Props) {
  const rangeLabel = formatWindowRange(windowStart);

  return (
    <div
      className="flex flex-wrap items-center gap-x-1 gap-y-1.5 px-3 py-2 border-b border-border bg-background"
      role="toolbar"
      aria-label="Budget management toolbar"
    >
      {/* Mode badge */}
      <span
        className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium shrink-0 ${MODE_COLORS[budgetMode]}`}
        aria-label={`Budget mode: ${MODE_LABELS[budgetMode]}`}
      >
        {MODE_LABELS[budgetMode]}
      </span>

      <Divider />

      {/* 12-month window navigator */}
      <div
        className="flex items-center gap-0.5 shrink-0"
        role="group"
        aria-label="Month window navigation"
      >
        {/* ◀◀ Back 1 year */}
        <button
          type="button"
          onClick={() => onWindowChange(addMonths(windowStart, -12))}
          aria-label="Back 1 year"
          title="Back 1 year"
          className="flex items-center justify-center w-6 h-6 rounded text-muted-foreground hover:bg-muted transition-colors"
        >
          <ChevronsLeft className="h-3.5 w-3.5" />
        </button>

        {/* ◀ Back 1 month */}
        <button
          type="button"
          onClick={() => onWindowChange(addMonths(windowStart, -1))}
          aria-label="Back 1 month"
          title="Back 1 month"
          className="flex items-center justify-center w-6 h-6 rounded text-muted-foreground hover:bg-muted transition-colors"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>

        {/* Range label */}
        <span
          className="min-w-[130px] text-center text-xs font-semibold text-foreground select-none px-1"
          aria-live="polite"
          aria-label={`Displaying ${rangeLabel}`}
        >
          {rangeLabel}
        </span>

        {/* Forward 1 month ▶ */}
        <button
          type="button"
          onClick={() => onWindowChange(addMonths(windowStart, 1))}
          aria-label="Forward 1 month"
          title="Forward 1 month"
          className="flex items-center justify-center w-6 h-6 rounded text-muted-foreground hover:bg-muted transition-colors"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </button>

        {/* Forward 1 year ▶▶ */}
        <button
          type="button"
          onClick={() => onWindowChange(addMonths(windowStart, 12))}
          aria-label="Forward 1 year"
          title="Forward 1 year"
          className="flex items-center justify-center w-6 h-6 rounded text-muted-foreground hover:bg-muted transition-colors"
        >
          <ChevronsRight className="h-3.5 w-3.5" />
        </button>

        {/* Jump to current year */}
        <button
          type="button"
          onClick={() => {
            const currentYear = new Date().getFullYear();
            onWindowChange(`${currentYear}-01`);
          }}
          aria-label="Go to current year"
          title="Go to current year"
          className="flex items-center justify-center w-6 h-6 rounded text-muted-foreground hover:bg-muted transition-colors ml-0.5"
        >
          <CalendarDays className="h-3.5 w-3.5" />
        </button>
      </div>

      <Divider />

      {/* Cell-view toggle */}
      <div
        className="flex items-center rounded border border-border overflow-hidden shrink-0"
        role="group"
        aria-label="Cell display"
      >
        {(["budgeted", "spent", "balance"] as const).map((view, idx, arr) => (
          <button
            key={view}
            type="button"
            onClick={() => onCellViewChange(view)}
            aria-pressed={cellView === view}
            className={`px-2 py-1 text-[11px] font-medium transition-colors ${
              idx < arr.length - 1 ? "border-r border-border" : ""
            } ${
              cellView === view
                ? "bg-primary/10 text-foreground"
                : "text-muted-foreground hover:bg-muted/50"
            }`}
          >
            {CELL_VIEW_LABELS[view]}
          </button>
        ))}
      </div>

      {(onExpandAll || onCollapseAll || onToggleShowHidden) && <Divider />}

      {/* Expand / Collapse All + Show/Hide hidden */}
      {(onExpandAll || onCollapseAll || onToggleShowHidden) && (
        <div
          className="flex items-center gap-0.5 shrink-0"
          role="group"
          aria-label="Group visibility"
        >
          {onExpandAll && (
            <button
              type="button"
              onClick={onExpandAll}
              aria-label="Expand all groups"
              title="Expand all groups"
              className="inline-flex items-center gap-1 h-6 px-2 rounded text-[11px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              <ChevronsUpDown className="h-3.5 w-3.5" aria-hidden="true" />
              Expand
            </button>
          )}
          {onCollapseAll && (
            <button
              type="button"
              onClick={onCollapseAll}
              aria-label="Collapse all groups"
              title="Collapse all groups"
              className="inline-flex items-center gap-1 h-6 px-2 rounded text-[11px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              <ChevronsDownUp className="h-3.5 w-3.5" aria-hidden="true" />
              Collapse
            </button>
          )}
          {onToggleShowHidden && (
            <button
              type="button"
              onClick={onToggleShowHidden}
              aria-label={showHidden ? "Hide hidden categories" : "Show hidden categories"}
              title={showHidden ? "Hide hidden categories" : "Show hidden categories"}
              // Inverted: pressed state means "currently hiding hidden categories"
              // (showHidden=false). Default — hidden visible — is unpressed.
              aria-pressed={!showHidden}
              className={`inline-flex items-center gap-1 h-6 px-2 rounded text-[11px] font-medium transition-colors ${
                !showHidden
                  ? "text-foreground bg-muted"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              {showHidden ? (
                <>
                  <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
                  Hide hidden
                </>
              ) : (
                <>
                  <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                  Show hidden
                </>
              )}
            </button>
          )}
        </div>
      )}

      <div className="flex-1" />

      {/* Action buttons */}
      <div className="flex items-center gap-1 shrink-0">
        {(onImport || onExport) && <Divider />}

        {onImport && (
          <button
            type="button"
            onClick={onImport}
            aria-label="Import budget data from CSV"
            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded border border-border hover:bg-muted transition-colors"
          >
            <Download className="h-3 w-3" aria-hidden="true" />
            Import
          </button>
        )}

        {onExport && (
          <button
            type="button"
            onClick={onExport}
            aria-label="Export budget data to CSV"
            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded border border-border hover:bg-muted transition-colors"
          >
            <Upload className="h-3 w-3" aria-hidden="true" />
            Export
          </button>
        )}

        {onShowShortcuts && (
          <button
            type="button"
            onClick={onShowShortcuts}
            aria-label="Show keyboard shortcuts (?)"
            title="Keyboard shortcuts (?)"
            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded border border-border hover:bg-muted transition-colors"
          >
            <Keyboard className="h-3 w-3" aria-hidden="true" />
            Shortcuts
          </button>
        )}

      </div>
    </div>
  );
}
