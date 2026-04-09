"use client";

import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PillGroup } from "@/components/ui/pill-group";

export type VisibilityFilter = "all" | "visible" | "hidden";
export type TypeFilter = "all" | "income" | "expense";
export type RulesFilter = "all" | "with_rules" | "no_rules";
export type SortDir = "asc" | "desc";

export const VISIBILITY_OPTIONS: { value: VisibilityFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "visible", label: "Visible" },
  { value: "hidden", label: "Hidden" },
];

export const TYPE_OPTIONS: { value: TypeFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "income", label: "Income" },
  { value: "expense", label: "Expense" },
];

export const RULES_OPTIONS: { value: RulesFilter; label: string }[] = [
  { value: "all",        label: "All" },
  { value: "with_rules", label: "Has Rules" },
  { value: "no_rules",   label: "No Rules" },
];

export function FilterBar({
  search, onSearchChange,
  visibilityFilter, onVisibilityChange,
  typeFilter, onTypeChange,
  rulesFilter, onRulesFilterChange,
  filteredCount, totalCount,
  selectedCount,
  onBulkDelete, onDeselect,
}: {
  search: string; onSearchChange: (v: string) => void;
  visibilityFilter: VisibilityFilter; onVisibilityChange: (v: VisibilityFilter) => void;
  typeFilter: TypeFilter; onTypeChange: (v: TypeFilter) => void;
  rulesFilter: RulesFilter; onRulesFilterChange: (v: RulesFilter) => void;
  filteredCount: number; totalCount: number;
  selectedCount: number;
  onBulkDelete: () => void;
  onDeselect: () => void;
}) {
  const hasFilters = search || visibilityFilter !== "all" || typeFilter !== "all" || rulesFilter !== "all";

  if (selectedCount > 0) {
    return (
      <div className="flex flex-wrap items-center gap-2 border-b border-border/40 bg-primary/5 px-2 py-1.5">
        <span className="text-xs font-medium text-primary">{selectedCount} selected</span>
        <Button size="xs" variant="destructive" onClick={onBulkDelete}>Delete</Button>
        <button onClick={onDeselect} className="ml-auto text-xs text-muted-foreground hover:text-foreground">
          Clear selection
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border/40 bg-muted/10 px-2 py-1.5">
      <div className="relative flex items-center">
        <Search className="absolute left-1.5 h-3.5 w-3.5 text-muted-foreground" />
        <input
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search…"
          className="h-6 w-44 rounded border border-border bg-background pl-6 pr-6 text-xs outline-none focus:ring-1 focus:ring-ring"
        />
        {search && (
          <button onClick={() => onSearchChange("")} className="absolute right-1.5 text-muted-foreground hover:text-foreground">
            <X className="h-3 w-3" />
          </button>
        )}
      </div>

      <PillGroup options={VISIBILITY_OPTIONS} value={visibilityFilter} onChange={onVisibilityChange} />
      <PillGroup options={TYPE_OPTIONS} value={typeFilter} onChange={onTypeChange} />
      <PillGroup options={RULES_OPTIONS} value={rulesFilter} onChange={onRulesFilterChange} />

      {hasFilters && (
        <button
          onClick={() => { onSearchChange(""); onVisibilityChange("all"); onTypeChange("all"); onRulesFilterChange("all"); }}
          className="text-xs text-muted-foreground underline hover:text-foreground"
        >
          Clear
        </button>
      )}

      <span className="ml-auto text-xs text-muted-foreground">
        {filteredCount === totalCount ? `${totalCount} rows` : `${filteredCount} of ${totalCount}`}
      </span>
    </div>
  );
}
