"use client";

import { useState } from "react";

/**
 * Manages the selectedIds Set shared across table components.
 *
 * The hook owns the state; the table is responsible for computing its own
 * allVisibleSelected / someVisibleSelected using the returned selectedIds,
 * since what counts as "selectable" differs per table (e.g. PayeesTable
 * excludes transfer payees).
 */
export function useTableSelection() {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  /**
   * Toggle a single row.
   * - checked=true  → add
   * - checked=false → remove
   * - checked=undefined → toggle
   */
  function toggleSelect(id: string, checked?: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const shouldAdd = checked ?? !prev.has(id);
      if (shouldAdd) next.add(id); else next.delete(id);
      return next;
    });
  }

  /**
   * Select or deselect all ids in the iterable.
   * Pass allSelected=true to deselect (remove), false to select (add).
   */
  function toggleSelectAll(ids: Iterable<string>, allSelected: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        for (const id of ids) next.delete(id);
      } else {
        for (const id of ids) next.add(id);
      }
      return next;
    });
  }

  function clearSelection() {
    setSelectedIds(new Set());
  }

  return { selectedIds, toggleSelect, toggleSelectAll, clearSelection };
}
