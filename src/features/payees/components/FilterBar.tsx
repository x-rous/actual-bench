"use client";

import { Button } from "@/components/ui/button";
import { PillGroup } from "@/components/ui/pill-group";
import { SearchInput } from "@/components/ui/search-input";

export type TypeFilter = "all" | "regular" | "transfer";
export type RulesFilter = "all" | "with_rules" | "no_rules";
export type SortCol = "name" | "type";
export type SortDir = "asc" | "desc";

export const TYPE_OPTIONS: { value: TypeFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "regular", label: "Regular" },
  { value: "transfer", label: "Transfer" },
];

export const RULES_OPTIONS: { value: RulesFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "with_rules", label: "Has Rules" },
  { value: "no_rules", label: "No Rules" },
];

export function FilterBar({
  search, onSearchChange,
  typeFilter, onTypeChange,
  rulesFilter, onRulesFilterChange,
  filteredCount, totalCount,
  selectedCount, canMerge,
  onBulkDelete, onMerge, onDeselect,
}: {
  search: string; onSearchChange: (v: string) => void;
  typeFilter: TypeFilter; onTypeChange: (v: TypeFilter) => void;
  rulesFilter: RulesFilter; onRulesFilterChange: (v: RulesFilter) => void;
  filteredCount: number; totalCount: number;
  selectedCount: number; canMerge: boolean;
  onBulkDelete: () => void;
  onMerge: () => void;
  onDeselect: () => void;
}) {
  const hasFilters = search || typeFilter !== "all" || rulesFilter !== "all";

  if (selectedCount > 0) {
    return (
      <div className="flex flex-wrap items-center gap-2 border-b border-border/40 bg-primary/5 px-2 py-1.5">
        <span className="text-xs font-medium text-primary">{selectedCount} selected</span>
        {canMerge && (
          <Button size="xs" variant="outline" onClick={onMerge}>Merge</Button>
        )}
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
        aria-label="Search payees"
      />

      <PillGroup options={TYPE_OPTIONS} value={typeFilter} onChange={onTypeChange} />
      <PillGroup options={RULES_OPTIONS} value={rulesFilter} onChange={onRulesFilterChange} />

      {hasFilters && (
        <button
          onClick={() => { onSearchChange(""); onTypeChange("all"); onRulesFilterChange("all"); }}
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
