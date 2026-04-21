import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SchemaObjectSummary } from "../types";
import { groupSchemaObjects } from "../lib/schemaObjectGroups";

type SortMode = "name" | "rowCount";

type TableListProps = {
  objects: readonly SchemaObjectSummary[];
  selectedName: string | null;
  search: string;
  sortMode: SortMode;
  onSearchChange: (value: string) => void;
  onSortModeChange: (value: SortMode) => void;
  onSelect: (object: SchemaObjectSummary) => void;
};

function formatRowCount(value: number | null): string {
  return value === null ? "schema" : value.toLocaleString("en-US");
}

function objectTypeLabel(object: SchemaObjectSummary): string {
  if (object.type === "index" || object.type === "trigger") return object.type;
  return object.featured ? "featured view" : object.type;
}

function sortObjects(objects: readonly SchemaObjectSummary[], sortMode: SortMode) {
  return [...objects].sort((a, b) => {
    if (sortMode === "rowCount") {
      const aCount = a.rowCount ?? -1;
      const bCount = b.rowCount ?? -1;
      if (aCount !== bCount) return bCount - aCount;
    }
    return a.name.localeCompare(b.name);
  });
}

export function TableList({
  objects,
  selectedName,
  search,
  sortMode,
  onSearchChange,
  onSortModeChange,
  onSelect,
}: TableListProps) {
  const normalizedSearch = search.trim().toLowerCase();
  const filtered = objects.filter((object) =>
    object.name.toLowerCase().includes(normalizedSearch)
  );
  const grouped = groupSchemaObjects(sortObjects(filtered, sortMode));

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="space-y-3 border-b border-border pb-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search objects"
            className="h-8 w-full rounded-md border border-border bg-background pl-8 pr-2 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-ring focus:ring-1 focus:ring-ring"
          />
        </div>
        <div className="flex rounded-md border border-border p-0.5">
          <button
            type="button"
            onClick={() => onSortModeChange("name")}
            className={cn(
              "flex-1 rounded-sm px-2 py-1 text-xs font-medium transition-colors",
              sortMode === "name"
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            Name
          </button>
          <button
            type="button"
            onClick={() => onSortModeChange("rowCount")}
            className={cn(
              "flex-1 rounded-sm px-2 py-1 text-xs font-medium transition-colors",
              sortMode === "rowCount"
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            Rows
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto py-3">
        {grouped.length === 0 ? (
          <div className="px-2 py-6 text-sm text-muted-foreground">
            No objects match the current search.
          </div>
        ) : (
          <div className="space-y-5">
            {grouped.map((group) => (
              <section key={group.id} className="space-y-2">
                <div className="px-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  {group.label}
                </div>
                <div className="space-y-1">
                  {group.objects.map((object) => {
                    const selected = object.name === selectedName;
                    return (
                      <button
                        key={`${object.type}:${object.name}`}
                        type="button"
                        onClick={() => onSelect(object)}
                        className={cn(
                          "w-full rounded-md px-2 py-2 text-left transition-colors",
                          selected
                            ? "bg-primary/10 text-foreground"
                            : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                        )}
                      >
                        <div className="flex min-w-0 items-center justify-between gap-2">
                          <span className="min-w-0 truncate text-sm font-medium">
                            {object.name}
                          </span>
                          <span className="shrink-0 text-xs tabular-nums">
                            {formatRowCount(object.rowCount)}
                          </span>
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {objectTypeLabel(object)}
                          {(object.type === "index" || object.type === "trigger") &&
                            " - schema only"}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export type { SortMode as TableListSortMode };
