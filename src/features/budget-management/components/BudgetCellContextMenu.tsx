"use client";

import { useEffect, useRef } from "react";
import { RefreshCw, ArrowRightLeft, Copy, CopyPlus, Percent, ZapOff, Calendar, TrendingUp, Activity } from "lucide-react";
import type { BudgetMode } from "../types";
import type { BulkActionType } from "../hooks/useBulkAction";

type Props = {
  x: number;
  y: number;
  carryover: boolean;
  budgetMode: BudgetMode;
  categoryBalance: number;
  /**
   * What the menu will act on. Cell scope keeps the per-cell items; a group row
   * or a month column is a set of cells and nothing else, so Rollover and
   * Transfer - which are per-category-month - are hidden there rather than
   * silently applying to something unexpected.
   */
  scope: "cell" | "group" | "month";
  /** Plain-language description of the target, e.g. "Groceries - Mar 2026". */
  scopeLabel?: string;
  /** How many cells the bulk actions would touch. Omitted for cell scope. */
  scopeCellCount?: number;
  onToggleCarryover: () => void;
  onOpenTransfer: () => void;
  /** Called with the action type — BudgetWorkspace decides immediate vs. dialog. */
  onBulkAction: (action: BulkActionType) => void;
  onClose: () => void;
};

type BulkItem = {
  action: BulkActionType;
  label: string;
  icon: React.ReactNode;
  needsInput: boolean;
};

/**
 * Sectioned so the two kinds of average are not mistaken for each other: one
 * repeats what was *planned* in past months, the other budgets what was
 * actually *spent or received*. Those answer different questions and a flat
 * list of six near-identical labels hides that.
 */
type BulkSection = { heading: string; items: BulkItem[] };

const BULK_SECTIONS: BulkSection[] = [
  {
    heading: "Copy from another month",
    items: [
      { action: "copy-previous-month", label: "Copy previous month", icon: <Copy className="h-3 w-3" />, needsInput: false },
      { action: "copy-prior-year-same-month", label: "Copy prior year same month", icon: <CopyPlus className="h-3 w-3" />, needsInput: false },
      { action: "copy-prior-year-same-month-pct", label: "Copy prior year with %…", icon: <CopyPlus className="h-3 w-3" />, needsInput: true },
      { action: "copy-from-month", label: "Copy specific month…", icon: <Calendar className="h-3 w-3" />, needsInput: true },
    ],
  },
  {
    heading: "Set a value",
    items: [
      { action: "set-to-zero", label: "Set to zero", icon: <ZapOff className="h-3 w-3" />, needsInput: false },
      { action: "set-fixed", label: "Set to fixed amount…", icon: <Percent className="h-3 w-3" />, needsInput: true },
      { action: "apply-percentage", label: "Apply % change…", icon: <Percent className="h-3 w-3" />, needsInput: true },
    ],
  },
  {
    heading: "Average past budgets",
    items: [
      { action: "avg-3-months", label: "Avg. 3-month budget", icon: <TrendingUp className="h-3 w-3" />, needsInput: false },
      { action: "avg-6-months", label: "Avg. 6-month budget", icon: <TrendingUp className="h-3 w-3" />, needsInput: false },
      { action: "avg-12-months", label: "Avg. 12-month budget", icon: <TrendingUp className="h-3 w-3" />, needsInput: false },
    ],
  },
  {
    heading: "Average past actuals",
    items: [
      { action: "avg-3-months-actuals", label: "Avg. 3-month actual", icon: <Activity className="h-3 w-3" />, needsInput: false },
      { action: "avg-6-months-actuals", label: "Avg. 6-month actual", icon: <Activity className="h-3 w-3" />, needsInput: false },
      { action: "avg-12-months-actuals", label: "Avg. 12-month actual", icon: <Activity className="h-3 w-3" />, needsInput: false },
    ],
  },
];

export function BudgetCellContextMenu({
  x,
  y,
  carryover,
  budgetMode,
  categoryBalance,
  scope,
  scopeLabel,
  scopeCellCount,
  onToggleCarryover,
  onOpenTransfer,
  onBulkAction,
  onClose,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", handleDown);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleDown);
      document.removeEventListener("keydown", handleKey);
    };
  }, [onClose]);

  const style: React.CSSProperties = { position: "fixed", top: y, left: x, zIndex: 50 };

  return (
    <div
      ref={ref}
      role="menu"
      aria-label={
        scope === "cell"
          ? "Cell actions"
          : scopeLabel
            ? `Budget actions for ${scopeLabel}`
            : "Budget actions"
      }
      style={style}
      className="bg-popover border border-border rounded-lg shadow-xl py-1 min-w-[210px] text-xs"
      onClick={(e) => e.stopPropagation()}
    >
      {/* Scope banner — only when acting on something other than one cell, so
          it is always obvious what a group or column action will change. */}
      {scope !== "cell" && scopeLabel && (
        <>
          <div className="px-3 py-1.5">
            <p className="text-[11px] font-semibold text-foreground truncate">{scopeLabel}</p>
            {scopeCellCount !== undefined && (
              <p className="text-[10px] text-muted-foreground">
                {scopeCellCount} cell{scopeCellCount !== 1 ? "s" : ""}
              </p>
            )}
          </div>
          <div className="h-px bg-border/50" />
        </>
      )}

      {/* Cell-level actions */}
      {scope === "cell" && budgetMode === "tracking" && (
        <button
          role="menuitem"
          type="button"
          className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-muted transition-colors"
          onClick={() => { onToggleCarryover(); onClose(); }}
        >
          <RefreshCw className="h-3 w-3 text-muted-foreground shrink-0" />
          <span>{carryover ? "Disable Rollover" : "Enable Rollover"}</span>
          <span className="ml-auto text-[10px] text-muted-foreground">(this month+)</span>
        </button>
      )}
      {scope === "cell" && budgetMode === "envelope" && (
        <button
          role="menuitem"
          type="button"
          className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-muted transition-colors"
          onClick={() => { onOpenTransfer(); onClose(); }}
        >
          <ArrowRightLeft className="h-3 w-3 text-muted-foreground shrink-0" />
          {categoryBalance < 0 ? "Cover Overspending" : "Transfer to Another Category"}
        </button>
      )}

      {/* Bulk actions */}
      {scope === "cell" && (budgetMode === "tracking" || budgetMode === "envelope") && (
        <div className="h-px bg-border/50 my-1" />
      )}
      {BULK_SECTIONS.map((section, sectionIndex) => (
        <div
          key={section.heading}
          role="group"
          aria-labelledby={`bulk-section-${sectionIndex}`}
        >
          {sectionIndex > 0 && <div role="separator" className="h-px bg-border/50 my-1" />}
          <p
            id={`bulk-section-${sectionIndex}`}
            className="px-3 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground select-none"
          >
            {section.heading}
          </p>
          {section.items.map(({ action, label, icon }) => (
            <button
              key={action}
              role="menuitem"
              type="button"
              className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-muted transition-colors"
              onClick={() => { onBulkAction(action); onClose(); }}
            >
              <span className="text-muted-foreground shrink-0">{icon}</span>
              {label}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
