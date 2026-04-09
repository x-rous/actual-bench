"use client";

import { Search, X, Merge } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PillGroup } from "@/components/ui/pill-group";
import { cn } from "@/lib/utils";
import { STAGE_LABELS } from "../utils/ruleFields";

export type StageFilter = "all" | "pre" | "default" | "post";
export type ActionTypeFilter = "all" | "category" | "payee" | "account" | "cleared" | "notes";

export const ACTION_TYPE_OPTIONS: { value: ActionTypeFilter; label: string }[] = [
  { value: "all",      label: "All" },
  { value: "category", label: "Sets Category" },
  { value: "payee",    label: "Sets Payee" },
  { value: "account",  label: "Sets Account" },
  { value: "cleared",  label: "Sets Cleared" },
  { value: "notes",    label: "Sets Notes" },
];

export function FilterBar({
  search, onSearchChange,
  stageFilter, onStageFilterChange,
  actionTypeFilter, onActionTypeFilterChange,
  payeeId, payeeName,
  categoryId, categoryName,
  accountId, accountName,
  onClearPayee, onClearCategory, onClearAccount,
  rowCount, totalVisible,
  selectedCount,
  onDeleteSelected, onMerge, onDeselect,
}: {
  search: string; onSearchChange: (v: string) => void;
  stageFilter: StageFilter; onStageFilterChange: (v: StageFilter) => void;
  actionTypeFilter: ActionTypeFilter; onActionTypeFilterChange: (v: ActionTypeFilter) => void;
  payeeId?: string | null; payeeName?: string;
  categoryId?: string | null; categoryName?: string;
  accountId?: string | null; accountName?: string;
  onClearPayee: () => void;
  onClearCategory: () => void;
  onClearAccount: () => void;
  rowCount: number; totalVisible: number;
  selectedCount: number;
  onDeleteSelected: () => void;
  onMerge: () => void;
  onDeselect: () => void;
}) {
  if (selectedCount >= 1) {
    return (
      <div className="flex flex-wrap items-center gap-2 border-b border-border/40 bg-primary/5 px-2 py-1.5">
        <span className="text-xs font-medium text-primary">
          {selectedCount} selected
        </span>
        <Button size="xs" variant="destructive" onClick={onDeleteSelected}>
          Delete
        </Button>
        {selectedCount >= 2 && (
          <Button size="xs" className="h-6 text-xs" onClick={onMerge}>
            <Merge className="h-3.5 w-3.5 mr-1.5" />
            Merge Selected
          </Button>
        )}
        <button
          onClick={onDeselect}
          className="ml-auto text-xs text-muted-foreground hover:text-foreground"
        >
          Clear selection
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap shrink-0 items-center gap-2 border-b border-border/40 bg-muted/10 px-2 py-1.5">
      <div className="relative flex items-center">
        <Search className="absolute left-1.5 h-3.5 w-3.5 text-muted-foreground" />
        <input
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search…"
          className="h-6 w-44 rounded border border-border bg-background pl-6 pr-6 text-xs outline-none focus:ring-1 focus:ring-ring"
        />
        {search && (
          <button
            onClick={() => onSearchChange("")}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>

      <div className="flex gap-px rounded border border-border bg-muted/40 p-px">
        {(["all", "pre", "default", "post"] as const).map((f) => (
          <button
            key={f}
            onClick={() => onStageFilterChange(f)}
            className={cn(
              "rounded px-2 py-0.5 text-xs transition-colors",
              stageFilter === f
                ? "bg-background font-medium shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {f === "all" ? "All" : STAGE_LABELS[f]}
          </button>
        ))}
      </div>

      <PillGroup options={ACTION_TYPE_OPTIONS} value={actionTypeFilter} onChange={onActionTypeFilterChange} />

      {payeeId && (
        <div className="flex items-center gap-1.5 rounded-md border border-primary/30 bg-primary/5 px-2 py-0.5 text-xs text-primary">
          <span>
            Payee: <span className="font-medium">{payeeName ?? payeeId}</span>
          </span>
          <button
            onClick={onClearPayee}
            className="text-primary/60 hover:text-primary"
            title="Clear payee filter"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}

      {categoryId && (
        <div className="flex items-center gap-1.5 rounded-md border border-primary/30 bg-primary/5 px-2 py-0.5 text-xs text-primary">
          <span>
            Category: <span className="font-medium">{categoryName ?? categoryId}</span>
          </span>
          <button
            onClick={onClearCategory}
            className="text-primary/60 hover:text-primary"
            title="Clear category filter"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}

      {accountId && (
        <div className="flex items-center gap-1.5 rounded-md border border-primary/30 bg-primary/5 px-2 py-0.5 text-xs text-primary">
          <span>
            Account: <span className="font-medium">{accountName ?? accountId}</span>
          </span>
          <button
            onClick={onClearAccount}
            className="text-primary/60 hover:text-primary"
            title="Clear account filter"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}

      <span className="ml-auto text-xs text-muted-foreground whitespace-nowrap">
        {rowCount} of {totalVisible}
      </span>
    </div>
  );
}
