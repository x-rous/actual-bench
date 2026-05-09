"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { useBudgetEditsStore } from "@/store/budgetEdits";
import { useConnectionStore, selectActiveInstance } from "@/store/connection";
import { useQueryClient } from "@tanstack/react-query";
import { budgetMonthDataQueryOptions } from "../lib/monthDataQuery";
import { StagedChangesSection, countLogicalEdits } from "./draft-panel/StagedChangesSection";
import type { LoadedCategory, LoadedMonthState } from "../types";

/**
 * Modal dialog showing all staged budget changes, grouped by month.
 * Transfer pairs are rendered as a single linked row.
 *
 * Category names are resolved from the TanStack Query cache — no new network
 * requests; the grid has already warmed the relevant month entries.
 */
export function StagedChangesDialog({ onClose }: { onClose: () => void }) {
  const edits = useBudgetEditsStore((s) => s.edits);
  const displayMonths = useBudgetEditsStore((s) => s.displayMonths);
  const connection = useConnectionStore(selectActiveInstance);
  const queryClient = useQueryClient();
  const overlayRef = useRef<HTMLDivElement>(null);

  const totalChanges = countLogicalEdits(edits);

  // Resolve category metadata from the cache. We only need one loaded month —
  // the category set is the same across all months in a budget.
  const allCategories: LoadedCategory[] = (() => {
    for (const month of displayMonths) {
      if (!connection) break;
      const cached = queryClient.getQueryData<LoadedMonthState>(
        budgetMonthDataQueryOptions(connection, month).queryKey
      );
      if (cached) return Object.values(cached.categoriesById);
    }
    return [];
  })();

  // Close on Escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-start justify-end bg-black/30"
      onClick={(e) => {
        if (e.target === overlayRef.current) onClose();
      }}
    >
      {/* Panel anchored to the right side, aligned with the details panel */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Staged changes"
        className="relative flex flex-col bg-background border-l border-border shadow-xl h-full w-[17rem] shrink-0"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-3 shrink-0 h-[2.7rem] border-b border-border">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Staged Changes
          </span>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-medium text-amber-600 dark:text-amber-400">
              {totalChanges} pending
            </span>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close staged changes"
              className="flex items-center justify-center w-5 h-5 rounded text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          <StagedChangesSection edits={edits} allCategories={allCategories} />
        </div>
      </div>
    </div>
  );
}
