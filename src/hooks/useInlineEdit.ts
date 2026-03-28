"use client";

import { useState } from "react";

/**
 * Manages the three-state inline-edit cell machine shared across table components:
 * selected → editing → committed/cancelled → selected.
 *
 * Generic over the cell identifier type C so the hook works with both
 * `{ rowId, colId }` (Accounts/Payees) and `{ kind, id }` (Categories) shapes.
 *
 * The hook owns only UI state. Persisting the new value to the staged store
 * remains the caller's responsibility and must happen before calling commitEdit.
 */
export function useInlineEdit<C>() {
  const [selectedCell, setSelectedCell] = useState<C | null>(null);
  const [editingCell, setEditingCell] = useState<C | null>(null);
  const [editStartChar, setEditStartChar] = useState<string | undefined>(undefined);

  /** Move selection to cell without opening the editor. */
  function selectCell(cell: C) {
    setEditingCell(null);
    setEditStartChar(undefined);
    setSelectedCell(cell);
  }

  /** Open the editor for cell, optionally pre-filling with startChar. */
  function startEdit(cell: C, startChar?: string) {
    setSelectedCell(cell);
    setEditingCell(cell);
    setEditStartChar(startChar);
  }

  /**
   * Close the editor and restore selection to cell.
   * Call this after the new value has already been persisted to the store.
   */
  function commitEdit(cell: C) {
    setEditingCell(null);
    setEditStartChar(undefined);
    setSelectedCell(cell);
  }

  /** Close the editor without persisting (revert). Selection stays on cell. */
  function cancelEdit(cell: C) {
    setEditingCell(null);
    setEditStartChar(undefined);
    setSelectedCell(cell);
  }

  return {
    selectedCell,
    editingCell,
    editStartChar,
    selectCell,
    startEdit,
    commitEdit,
    cancelEdit,
  };
}
