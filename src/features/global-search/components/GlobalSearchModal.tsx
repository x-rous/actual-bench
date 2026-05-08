"use client";

import { useState, useMemo, useCallback } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { useShallow } from "zustand/shallow";
import { useStagedStore } from "@/store/staged";
import { usePreloadEntities } from "@/hooks/useAllEntities";
import { useGlobalSearchStore } from "../store/useGlobalSearchStore";
import { searchEntities } from "../lib/searchEntities";
import { SearchResultGroup } from "./SearchResultGroup";
import type { SearchResult } from "../types";

export function GlobalSearchModal() {
  const isOpen = useGlobalSearchStore((s) => s.isOpen);

  // Trigger entity loading when the modal opens. On pages where AppShell skips
  // preloading (e.g. /overview), this ensures search results are available.
  // TanStack Query deduplicates the fetches on pages that already loaded entities.
  usePreloadEntities(isOpen);

  if (!isOpen) return null;

  return <GlobalSearchModalContent />;
}

function GlobalSearchModalContent() {
  const close = useGlobalSearchStore((s) => s.close);
  const router = useRouter();

  const [query, setQuery] = useState("");
  const [focusedIndex, setFocusedIndex] = useState(0);

  const slices = useStagedStore(
    useShallow((s) => ({
      accounts: s.accounts,
      payees: s.payees,
      categoryGroups: s.categoryGroups,
      categories: s.categories,
      rules: s.rules,
      schedules: s.schedules,
      tags: s.tags,
    }))
  );

  const groups = useMemo(
    () => searchEntities(query, slices),
    [query, slices]
  );

  const flatResults = useMemo(
    () => groups.flatMap((g) => g.results),
    [groups]
  );

  const handleSelect = useCallback(
    (result: SearchResult) => {
      close();
      router.push(result.href);
    },
    [close, router]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
        return;
      }
      if (flatResults.length === 0) return;

      if (e.key === "ArrowDown" || (e.key === "Tab" && !e.shiftKey)) {
        e.preventDefault();
        setFocusedIndex((i) => Math.min(i + 1, flatResults.length - 1));
      } else if (e.key === "ArrowUp" || (e.key === "Tab" && e.shiftKey)) {
        e.preventDefault();
        setFocusedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const result = flatResults[focusedIndex];
        if (result) handleSelect(result);
      }
    },
    [flatResults, focusedIndex, close, handleSelect]
  );

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) close();
    },
    [close]
  );

  const groupStartIndices = useMemo(() => {
    const indices: number[] = [];
    let offset = 0;
    for (const g of groups) {
      indices.push(offset);
      offset += g.results.length;
    }
    return indices;
  }, [groups]);

  const activedescendant =
    focusedIndex >= 0 && flatResults[focusedIndex]
      ? `search-result-${flatResults[focusedIndex]!.id}`
      : undefined;

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex justify-center bg-black/30"
      style={{ paddingTop: "12vh" }}
      onClick={handleBackdropClick}
      aria-hidden="false"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Global search"
        className="flex h-fit w-full max-w-xl flex-col overflow-hidden rounded-xl border border-border bg-background shadow-2xl ring-1 ring-foreground/10"
        style={{ maxHeight: "70vh" }}
      >
        {/* Search input */}
        <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            // autoFocus fires when the portal mounts (i.e. when isOpen becomes true).
            // The component unmounts on close so state and focus reset automatically.
            autoFocus
            type="text"
            role="combobox"
            aria-expanded={groups.length > 0}
            aria-haspopup="listbox"
            aria-autocomplete="list"
            aria-controls="global-search-results"
            aria-activedescendant={activedescendant}
            placeholder="Search payees, categories, accounts, rules…"
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setFocusedIndex(0);
            }}
            onKeyDown={handleKeyDown}
          />
          <kbd className="pointer-events-none rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
            Esc
          </kbd>
        </div>

        {/* Results */}
        <div
          id="global-search-results"
          role="listbox"
          aria-label="Search results"
          className="overflow-y-auto"
        >
          {query.trim().length === 0 && (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              Type to search across all entities
            </p>
          )}

          {query.trim().length > 0 && groups.length === 0 && (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              No results for &ldquo;{query}&rdquo;
            </p>
          )}

          {groups.map((group, i) => (
            <SearchResultGroup
              key={group.entityType}
              group={group}
              focusedIndex={focusedIndex}
              groupStartIndex={groupStartIndices[i] ?? 0}
              onSelect={handleSelect}
            />
          ))}

          {groups.length > 0 && (
            <div className="border-t border-border px-3 py-1.5">
              <p className="text-[10px] text-muted-foreground">
                ↑↓ navigate · Enter select · Esc close
              </p>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
