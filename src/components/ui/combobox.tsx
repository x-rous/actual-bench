"use client";

import { useState, useEffect, useRef } from "react";
import { Search, Check, ChevronsUpDown, X } from "lucide-react";
import { cn } from "@/lib/utils";

// ─── useComboboxState ─────────────────────────────────────────────────────────

export type ComboboxStateResult = {
  open: boolean;
  openDropdown: () => void;
  closeDropdown: () => void;
  search: string;
  setSearch: React.Dispatch<React.SetStateAction<string>>;
  containerRef: React.RefObject<HTMLDivElement | null>;
  searchRef: React.RefObject<HTMLInputElement | null>;
};

export function useComboboxState(): ComboboxStateResult {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  function openDropdown() {
    setSearch("");
    setOpen(true);
    requestAnimationFrame(() => searchRef.current?.focus());
  }

  function closeDropdown() {
    setOpen(false);
  }

  return { open, openDropdown, closeDropdown, search, setSearch, containerRef, searchRef };
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type ComboboxOption = { id: string; name: string; isGroupHeader?: true; hidden?: boolean };

/**
 * Filters a grouped options list (containing group headers + selectable items)
 * against a search term:
 * - A match on a group name includes all its children.
 * - A match on an option name includes that option (plus its nearest preceding group header).
 * - Groups with no matching children are hidden.
 * - If search is empty, returns the full list unchanged.
 */
export function filterGroupedOptions(
  options: ComboboxOption[],
  search: string
): ComboboxOption[] {
  const term = search.trim().toLowerCase();
  if (!term) return options;

  const result: ComboboxOption[] = [];
  let groupMatches = false;
  let pendingGroup: ComboboxOption | null = null;

  for (const opt of options) {
    if (opt.isGroupHeader) {
      groupMatches = opt.name.toLowerCase().includes(term);
      pendingGroup = opt;
      continue;
    }
    if (groupMatches) {
      // Group name matched — include all children
      if (pendingGroup) { result.push(pendingGroup); pendingGroup = null; }
      result.push(opt);
    } else if (opt.name.toLowerCase().includes(term)) {
      // Child matched — include it with its nearest group header
      if (pendingGroup) { result.push(pendingGroup); pendingGroup = null; }
      result.push(opt);
    }
  }

  return result;
}

// ─── SearchableCombobox (single-select) ───────────────────────────────────────

export function SearchableCombobox({
  options,
  value,
  onChange,
  placeholder = "— select —",
}: {
  options: ComboboxOption[];
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const { open, openDropdown, closeDropdown, search, setSearch, containerRef, searchRef } =
    useComboboxState();

  const selectedLabel = options.find((o) => !o.isGroupHeader && o.id === value)?.name ?? "";
  const filtered = filterGroupedOptions(options, search);

  function select(id: string) {
    onChange(id);
    closeDropdown();
  }

  return (
    <div ref={containerRef} className="relative flex-1">
      <button
        type="button"
        onClick={() => (open ? closeDropdown() : openDropdown())}
        className={cn(
          "flex h-8 w-full items-center justify-between rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-2 focus:ring-ring/50",
          !selectedLabel && "text-muted-foreground"
        )}
      >
        <span className="truncate">{selectedLabel || placeholder}</span>
        <ChevronsUpDown className="ml-1 h-3 w-3 shrink-0 text-muted-foreground" />
      </button>

      {open && (
        <div className="absolute top-full left-0 z-50 mt-1 w-full min-w-[180px] rounded-md border border-border bg-popover shadow-md">
          <div className="flex items-center gap-1.5 border-b border-border px-2 py-1.5">
            <Search className="h-3 w-3 shrink-0 text-muted-foreground" />
            <input
              ref={searchRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search…"
              className="h-5 flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground focus:outline-none"
            />
          </div>
          <ul className="max-h-48 overflow-y-auto py-1">
            <li>
              <button
                type="button"
                onClick={() => select("")}
                className="flex w-full items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              >
                <Check className={cn("h-3 w-3 shrink-0", value === "" ? "opacity-100" : "opacity-0")} />
                — none —
              </button>
            </li>
            {filtered.filter((o) => !o.isGroupHeader).length === 0 ? (
              <li className="px-3 py-2 text-xs text-muted-foreground italic">No results</li>
            ) : (
              filtered.map((o) =>
                o.isGroupHeader ? (
                  <li
                    key={`group-${o.id}`}
                    className={cn(
                      "px-2 pt-2 pb-0.5 text-[10px] font-semibold uppercase tracking-wide select-none pointer-events-none",
                      o.hidden ? "text-muted-foreground/60" : "text-muted-foreground"
                    )}
                  >
                    {o.name}
                  </li>
                ) : (
                  <li key={o.id}>
                    <button
                      type="button"
                      onClick={() => select(o.id)}
                      className={cn(
                        "flex w-full items-center gap-2 pl-4 pr-2 py-1.5 text-xs hover:bg-accent hover:text-accent-foreground",
                        o.hidden ? "text-foreground/60" : "text-foreground"
                      )}
                    >
                      <Check
                        className={cn("h-3 w-3 shrink-0", value === o.id ? "opacity-100" : "opacity-0")}
                      />
                      <span className="truncate">{o.name}</span>
                    </button>
                  </li>
                )
              )
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

// ─── MultiSearchableCombobox (multi-select) ───────────────────────────────────

export function MultiSearchableCombobox({
  options,
  values,
  onChange,
  placeholder = "— select —",
}: {
  options: ComboboxOption[];
  values: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
}) {
  const { open, openDropdown, closeDropdown, search, setSearch, containerRef, searchRef } =
    useComboboxState();

  const filtered = filterGroupedOptions(options, search);

  const selectedOptions = options.filter((o) => !o.isGroupHeader && values.includes(o.id));

  function toggle(id: string) {
    onChange(values.includes(id) ? values.filter((v) => v !== id) : [...values, id]);
  }

  function remove(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    onChange(values.filter((v) => v !== id));
  }

  return (
    <div ref={containerRef} className="relative flex-1">
      <div
        role="button"
        tabIndex={0}
        onClick={() => (open ? closeDropdown() : openDropdown())}
        onKeyDown={(e) => e.key === "Enter" && (open ? closeDropdown() : openDropdown())}
        className="flex min-h-8 w-full cursor-pointer flex-wrap items-center gap-1 rounded-md border border-input bg-background px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-ring/50"
      >
        {selectedOptions.length === 0 ? (
          <span className="text-muted-foreground">{placeholder}</span>
        ) : (
          selectedOptions.map((o) => (
            <span
              key={o.id}
              className="flex items-center gap-1 rounded bg-accent px-2 py-1 text-xs font-medium text-accent-foreground"
            >
              {o.name}
              <button
                type="button"
                onClick={(e) => remove(o.id, e)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))
        )}
        <ChevronsUpDown className="ml-auto h-3 w-3 shrink-0 text-muted-foreground" />
      </div>

      {open && (
        <div className="absolute top-full left-0 z-50 mt-1 w-full min-w-[180px] rounded-md border border-border bg-popover shadow-md">
          <div className="flex items-center gap-1.5 border-b border-border px-2 py-1.5">
            <Search className="h-3 w-3 shrink-0 text-muted-foreground" />
            <input
              ref={searchRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search…"
              className="h-5 flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground focus:outline-none"
            />
          </div>
          <ul className="max-h-48 overflow-y-auto py-1">
            {filtered.filter((o) => !o.isGroupHeader).length === 0 ? (
              <li className="px-3 py-2 text-xs text-muted-foreground italic">No results</li>
            ) : (
              filtered.map((o) =>
                o.isGroupHeader ? (
                  <li
                    key={`group-${o.id}`}
                    className={cn(
                      "px-2 pt-2 pb-0.5 text-[10px] font-semibold uppercase tracking-wide select-none pointer-events-none",
                      o.hidden ? "text-muted-foreground/60" : "text-muted-foreground"
                    )}
                  >
                    {o.name}
                  </li>
                ) : (
                  <li key={o.id}>
                    <button
                      type="button"
                      onClick={() => toggle(o.id)}
                      className={cn(
                        "flex w-full items-center gap-2 pl-4 pr-2 py-1.5 text-xs hover:bg-accent hover:text-accent-foreground",
                        o.hidden ? "text-foreground/60" : "text-foreground"
                      )}
                    >
                      <Check
                        className={cn(
                          "h-3 w-3 shrink-0",
                          values.includes(o.id) ? "opacity-100" : "opacity-0"
                        )}
                      />
                      <span className="truncate">{o.name}</span>
                    </button>
                  </li>
                )
              )
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
