"use client";

import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PillGroup } from "@/components/ui/pill-group";

export type ColorFilter = "all" | "has_color" | "no_color";

export const COLOR_OPTIONS: { value: ColorFilter; label: string }[] = [
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
            className="absolute right-1.5 text-muted-foreground hover:text-foreground"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>

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
