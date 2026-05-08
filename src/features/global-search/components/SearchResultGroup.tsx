"use client";

import {
  User,
  Tag,
  Landmark,
  ListFilter,
  CalendarClock,
  Hash,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { SearchResult, SearchResultGroup as SearchResultGroupType, SearchEntityType } from "../types";

const ENTITY_ICONS: Record<SearchEntityType, React.ComponentType<{ className?: string }>> = {
  payee: User,
  category: Tag,
  account: Landmark,
  rule: ListFilter,
  schedule: CalendarClock,
  tag: Hash,
};

type Props = {
  group: SearchResultGroupType;
  focusedIndex: number;
  groupStartIndex: number;
  onSelect: (result: SearchResult) => void;
};

export function SearchResultGroup({
  group,
  focusedIndex,
  groupStartIndex,
  onSelect,
}: Props) {
  const Icon = ENTITY_ICONS[group.entityType];

  return (
    <div role="group" aria-label={group.groupLabel}>
      <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground select-none">
        {group.groupLabel}
      </div>
      {group.results.map((result, i) => {
        const globalIndex = groupStartIndex + i;
        const isFocused = focusedIndex === globalIndex;
        return (
          <button
            key={result.id}
            id={`search-result-${result.id}`}
            role="option"
            aria-selected={isFocused}
            type="button"
            onClick={() => onSelect(result)}
            className={cn(
              "flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors",
              isFocused
                ? "bg-accent text-accent-foreground"
                : "hover:bg-accent/50 hover:text-accent-foreground"
            )}
          >
            <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm">{result.label}</span>
              {result.sublabel && (
                <span className="block truncate text-xs text-muted-foreground">
                  {result.sublabel}
                </span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}
