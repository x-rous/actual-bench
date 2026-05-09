"use client";

import { useEffect, useRef } from "react";
import { RefreshCw, ArrowRightLeft, Copy, Percent, ZapOff, Calendar, TrendingUp } from "lucide-react";
import type { BudgetMode } from "../types";
import type { BulkActionType } from "../hooks/useBulkAction";

type Props = {
  x: number;
  y: number;
  carryover: boolean;
  budgetMode: BudgetMode;
  categoryBalance: number;
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

const BULK_ITEMS: BulkItem[] = [
  { action: "copy-previous-month", label: "Copy previous month",     icon: <Copy className="h-3 w-3" />,       needsInput: false },
  { action: "copy-from-month",     label: "Copy specific month…",    icon: <Calendar className="h-3 w-3" />,   needsInput: true  },
  { action: "set-to-zero",         label: "Set to zero",             icon: <ZapOff className="h-3 w-3" />,    needsInput: false },
  { action: "set-fixed",           label: "Set to fixed amount…",    icon: <Percent className="h-3 w-3" />,   needsInput: true  },
  { action: "apply-percentage",    label: "Apply % change…",         icon: <Percent className="h-3 w-3" />,   needsInput: true  },
  { action: "avg-3-months",        label: "Avg. 3-month budget",     icon: <TrendingUp className="h-3 w-3" />, needsInput: false },
  { action: "avg-6-months",        label: "Avg. 6-month budget",     icon: <TrendingUp className="h-3 w-3" />, needsInput: false },
  { action: "avg-12-months",       label: "Avg. 12-month budget",    icon: <TrendingUp className="h-3 w-3" />, needsInput: false },
];

export function BudgetCellContextMenu({
  x,
  y,
  carryover,
  budgetMode,
  categoryBalance,
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
      aria-label="Cell actions"
      style={style}
      className="bg-popover border border-border rounded-lg shadow-xl py-1 min-w-[210px] text-xs"
      onClick={(e) => e.stopPropagation()}
    >
      {/* Cell-level actions */}
      {budgetMode === "tracking" && (
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
      {budgetMode === "envelope" && (
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
      {(budgetMode === "tracking" || budgetMode === "envelope") && (
        <div className="h-px bg-border/50 my-1" />
      )}
      <p className="px-3 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground select-none">
        Set Budget
      </p>
      {BULK_ITEMS.map(({ action, label, icon }) => (
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
  );
}
