"use client";

import { Button } from "@/components/ui/button";
import { PillGroup } from "@/components/ui/pill-group";
import { SearchInput } from "@/components/ui/search-input";

export type ColorFilter = "all" | "has_color" | "no_color";

const COLOR_OPTIONS: { value: ColorFilter; label: string }[] = [
  { value: "all",       label: "All" },
  { value: "has_color", label: "Has Color" },
  { value: "no_color",  label: "No Color" },
];

export function FilterBar({
  search, onSearchChange,
  colorFilter, onColorFilterChange,
  filteredCount, totalCount,
  selectedCount,
  onBulkDelete, onDeselect,
}: {
  search: string; onSearchChange: (v: string) => void;
  colorFilter: ColorFilter; onColorFilterChange: (v: ColorFilter) => void;
  filteredCount: number; totalCount: number;
  selectedCount: number;
  onBulkDelete: () => void;
  onDeselect: () => void;
}) {
  const hasFilters = search || colorFilter !== "all";

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
        aria-label="Search tags"
      />

      <PillGroup options={COLOR_OPTIONS} value={colorFilter} onChange={onColorFilterChange} />

      {hasFilters && (
        <button
          onClick={() => { onSearchChange(""); onColorFilterChange("all"); }}
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
