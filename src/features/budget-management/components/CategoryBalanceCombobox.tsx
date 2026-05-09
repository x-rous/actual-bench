"use client";

import { useState, useRef, useEffect, useId } from "react";
import { formatCurrency } from "../lib/format";

export type CategoryWithBalance = {
  id: string;
  name: string;
  groupId: string;
  groupName: string;
  effectiveBalance: number;
};

type Props = {
  categories: CategoryWithBalance[];
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
  id?: string;
};

export function CategoryBalanceCombobox({
  categories,
  value,
  onChange,
  placeholder = "Search categories…",
  id,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const generatedId = useId();
  const inputId = id ?? generatedId;

  const selectedCat = categories.find((c) => c.id === value);

  // Build filtered grouped list
  const filtered = query
    ? categories.filter((c) => c.name.toLowerCase().includes(query.toLowerCase()))
    : categories;

  // Group into ordered sections
  const groupOrder: string[] = [];
  const groupMap = new Map<string, CategoryWithBalance[]>();
  for (const cat of filtered) {
    if (!groupMap.has(cat.groupId)) {
      groupOrder.push(cat.groupId);
      groupMap.set(cat.groupId, []);
    }
    groupMap.get(cat.groupId)!.push(cat);
  }

  // Flat selectable list for keyboard navigation
  const flatSelectable = filtered;

  useEffect(() => {
    setActiveIndex(-1);
  }, [query]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setActiveIndex(-1);
    }
  }, [open]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "Enter") {
        setOpen(true);
        e.preventDefault();
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, flatSelectable.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const active = flatSelectable[activeIndex];
      if (active) {
        onChange(active.id);
        setOpen(false);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  const displayValue = open ? query : (selectedCat?.name ?? "");

  return (
    <div ref={containerRef} className="relative">
      <input
        ref={inputRef}
        id={inputId}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        autoComplete="off"
        value={displayValue}
        placeholder={placeholder}
        className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background focus:outline-none focus:ring-1 focus:ring-ring"
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onChange={(e) => {
          setQuery(e.target.value);
          if (!open) setOpen(true);
        }}
        onKeyDown={handleInputKeyDown}
      />

      {open && (
        <div className="absolute z-50 mt-1 w-full bg-popover border border-border rounded-md shadow-lg max-h-56 overflow-y-auto">
          {groupOrder.length === 0 ? (
            <div className="px-3 py-2 text-xs text-muted-foreground">
              No matching categories
            </div>
          ) : (
            <ul ref={listRef} role="listbox">
              {groupOrder.map((groupId) => {
                const cats = groupMap.get(groupId) ?? [];
                const groupName = cats[0]?.groupName ?? groupId;
                return (
                  <li key={groupId}>
                    <div className="px-3 pt-1.5 pb-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground select-none">
                      {groupName}
                    </div>
                    <ul>
                      {cats.map((cat) => {
                        const idx = flatSelectable.indexOf(cat);
                        const isActive = idx === activeIndex;
                        const isSelected = cat.id === value;
                        const balClass =
                          cat.effectiveBalance > 0
                            ? "text-emerald-700 dark:text-emerald-400"
                            : cat.effectiveBalance < 0
                            ? "text-destructive"
                            : "text-muted-foreground";
                        return (
                          <li
                            key={cat.id}
                            role="option"
                            aria-selected={isSelected}
                            className={`flex items-center justify-between gap-2 px-4 py-1.5 text-xs cursor-pointer ${
                              isActive ? "bg-muted" : "hover:bg-muted/60"
                            } ${isSelected ? "font-medium" : ""}`}
                            onMouseEnter={() => setActiveIndex(idx)}
                            onMouseDown={(e) => {
                              e.preventDefault();
                              onChange(cat.id);
                              setOpen(false);
                            }}
                          >
                            <span className="truncate">{cat.name}</span>
                            <span className={`tabular-nums shrink-0 ${balClass}`}>
                              {formatCurrency(cat.effectiveBalance)}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
