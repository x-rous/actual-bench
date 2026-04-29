"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { EyeOff, Search, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  filterCategorySearchOptions,
  type CategorySearchOption,
} from "../lib/categorySearch";

const MAX_VISIBLE_RESULTS = 80;

type Props = {
  open: boolean;
  options: CategorySearchOption[];
  onOpenChange: (open: boolean) => void;
  onSelect: (option: CategorySearchOption) => void;
};

export function CategoryJumpDialog({
  open,
  options,
  onOpenChange,
  onSelect,
}: Props) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultRefs = useRef<Array<HTMLLIElement | null>>([]);

  const matches = useMemo(
    () => filterCategorySearchOptions(options, query),
    [options, query]
  );
  const visibleResults = useMemo(
    () => matches.slice(0, MAX_VISIBLE_RESULTS),
    [matches]
  );
  const activeResultIndex =
    visibleResults.length === 0
      ? -1
      : Math.min(activeIndex, visibleResults.length - 1);
  const activeResultId =
    activeResultIndex >= 0 ? `category-jump-option-${activeResultIndex}` : undefined;
  const hasQuery = query.trim().length > 0;
  const resultSummary = hasQuery
    ? matches.length > MAX_VISIBLE_RESULTS
      ? `Showing first ${MAX_VISIBLE_RESULTS} of ${matches.length} matches`
      : `${visibleResults.length} ${visibleResults.length === 1 ? "match" : "matches"}`
    : `${options.length} categories`;

  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  useEffect(() => {
    if (activeResultIndex < 0) return;
    resultRefs.current[activeResultIndex]?.scrollIntoView({ block: "nearest" });
  }, [activeResultIndex]);

  function choose(option: CategorySearchOption) {
    onSelect(option);
    onOpenChange(false);
  }

  function handleInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (visibleResults.length === 0) return;
      setActiveIndex((idx) => Math.min(visibleResults.length - 1, idx + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (visibleResults.length === 0) return;
      setActiveIndex((idx) => Math.max(0, idx - 1));
    } else if (e.key === "Home") {
      e.preventDefault();
      setActiveIndex(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setActiveIndex(Math.max(0, visibleResults.length - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const option = visibleResults[activeResultIndex];
      if (option) choose(option);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-xl gap-0 overflow-hidden p-0 sm:max-w-xl"
        finalFocus={false}
        initialFocus={inputRef}
      >
        <DialogHeader className="gap-1 border-b border-border px-4 py-3">
          <DialogTitle>Jump to Category</DialogTitle>
          <DialogDescription className="sr-only">
            Search categories by category or group name.
          </DialogDescription>
        </DialogHeader>

        <div className="border-b border-border px-4 py-3">
          <div className="flex h-9 items-center gap-2 rounded-md border border-input bg-background px-2 focus-within:ring-2 focus-within:ring-ring/40">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActiveIndex(0);
              }}
              onKeyDown={handleInputKeyDown}
              role="combobox"
              aria-expanded="true"
              aria-controls="category-jump-results"
              aria-activedescendant={activeResultId}
              aria-autocomplete="list"
              aria-haspopup="listbox"
              placeholder="Category or group"
              className="min-w-0 flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
            />
            {query && (
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  setActiveIndex(0);
                  inputRef.current?.focus();
                }}
                className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label="Clear search"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            )}
          </div>
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            {resultSummary}
          </p>
        </div>

        <div className="max-h-[min(24rem,60vh)] overflow-y-auto">
          {visibleResults.length === 0 ? (
            <p className="px-4 py-8 text-center text-xs text-muted-foreground">
              No categories found
            </p>
          ) : (
            <ul id="category-jump-results" role="listbox" className="py-1">
              {visibleResults.map((option, idx) => {
                const hidden = option.hidden || option.groupHidden;
                const active = idx === activeResultIndex;
                return (
                  <li
                    id={`category-jump-option-${idx}`}
                    key={option.categoryId}
                    ref={(node) => {
                      resultRefs.current[idx] = node;
                    }}
                    role="option"
                    aria-selected={active}
                    onMouseEnter={() => setActiveIndex(idx)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => choose(option)}
                    className={`grid cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-2 text-left text-xs ${
                      active ? "bg-accent text-accent-foreground" : "hover:bg-muted/60"
                    }`}
                  >
                    <span className="min-w-0">
                      <span
                        className={`block truncate font-medium ${
                          active ? "text-accent-foreground" : "text-foreground"
                        }`}
                      >
                        {option.name}
                      </span>
                      <span
                        className={`block truncate text-[11px] ${
                          active ? "text-accent-foreground/70" : "text-muted-foreground"
                        }`}
                      >
                        {option.groupName} · {option.isIncome ? "Income" : "Expense"}
                      </span>
                    </span>
                    {hidden && (
                      <span
                        className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] ${
                          active
                            ? "border-accent-foreground/25 text-accent-foreground/75"
                            : "border-border text-muted-foreground"
                        }`}
                      >
                        <EyeOff className="h-3 w-3" aria-hidden="true" />
                        Hidden
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
