"use client";

import { ChevronsDownUp, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PillGroup } from "@/components/ui/pill-group";
import { SearchInput } from "@/components/ui/search-input";

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
  allCollapsed,
  onToggleCollapseAll,
  selectedCount,
  onBulkDelete, onDeselect,
}: {
  search: string; onSearchChange: (v: string) => void;
  visibilityFilter: VisibilityFilter; onVisibilityChange: (v: VisibilityFilter) => void;
  typeFilter: TypeFilter; onTypeChange: (v: TypeFilter) => void;
  rulesFilter: RulesFilter; onRulesFilterChange: (v: RulesFilter) => void;
  filteredCount: number; totalCount: number;
  allCollapsed: boolean;
  onToggleCollapseAll: () => void;
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
      <SearchInput
        value={search}
        onValueChange={onSearchChange}
        aria-label="Search categories"
      />

      <PillGroup options={VISIBILITY_OPTIONS} value={visibilityFilter} onChange={onVisibilityChange} />
      <PillGroup options={TYPE_OPTIONS} value={typeFilter} onChange={onTypeChange} />
      <PillGroup options={RULES_OPTIONS} value={rulesFilter} onChange={onRulesFilterChange} />

      <div className="flex items-center gap-1">
        <Button
          size="xs"
          variant="ghost"
          onClick={onToggleCollapseAll}
          aria-label={allCollapsed ? "Expand all groups" : "Collapse all groups"}
        >
          {allCollapsed ? (
            <>
              <ChevronsUpDown />
              Expand All
            </>
          ) : (
            <>
              <ChevronsDownUp />
              Collapse All
            </>
          )}
        </Button>
      </div>

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
