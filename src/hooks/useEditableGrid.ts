"use client";

import { useEffect, useMemo, useRef } from "react";
import { useInlineEdit } from "@/hooks/useInlineEdit";

export type EditableGridCell<Col extends string> = {
  rowId: string;
  colId: Col;
};

type UseEditableGridOptions<Col extends string> = {
  rowIds: string[];
  columns: readonly Col[];
  canEditCell?: (cell: EditableGridCell<Col>) => boolean;
  onAddRowAtEnd?: () => void;
  /**
   * Bring a row into view when its cell is not in the DOM.
   *
   * Only virtualised tables need this. Selection moves by index over every row,
   * but a windowed table mounts a couple of dozen of them, so the cell the
   * keyboard just moved to may not exist yet to be focused.
   */
  onRevealRow?: (rowIndex: number) => void;
};

/**
 * Shared grid interaction model for inline-edit tables.
 *
 * Owns only client-side cell selection, editing state, focus restoration,
 * and keyboard navigation. Entity-specific persistence and validation stay in
 * the feature layer.
 */
export function useEditableGrid<Col extends string>({
  rowIds,
  columns,
  canEditCell,
  onAddRowAtEnd,
  onRevealRow,
}: UseEditableGridOptions<Col>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const {
    selectedCell,
    editingCell,
    editStartChar,
    selectCell: selectGridCell,
    startEdit,
    commitEdit,
    cancelEdit,
  } = useInlineEdit<EditableGridCell<Col>>();

  const rowIndexById = useMemo(() => {
    const next = new Map<string, number>();
    rowIds.forEach((id, index) => {
      next.set(id, index);
    });
    return next;
  }, [rowIds]);

  const isCellEditable = (cell: EditableGridCell<Col>) => canEditCell?.(cell) ?? true;

  // Read through a ref so callers need not memoise, and so a new callback
  // identity cannot re-run the focus effect and steal focus mid-edit. Declared
  // above that effect so this one commits first.
  const revealRowRef = useRef(onRevealRow);
  useEffect(() => {
    revealRowRef.current = onRevealRow;
  });

  useEffect(() => {
    if (!selectedCell || editingCell) return;

    const findCell = () =>
      containerRef.current?.querySelector<HTMLElement>(
        `[data-cell="${selectedCell.rowId}:${selectedCell.colId}"]`
      ) ?? null;

    const mounted = findCell();
    if (mounted) {
      mounted.focus({ preventScroll: false });
      return;
    }

    /*
     * The row is not rendered, so there is nothing to focus yet.
     *
     * In a virtualised table the selection can legitimately land outside the
     * window - an arrow key at the bottom edge, a Tab that wraps to the next
     * row. Without this the selection moved invisibly: no focus, no scroll,
     * and the user lost track of where they were. Ask the owner to scroll the
     * row in, then focus once React has committed the newly mounted rows.
     */
    const rowIndex = rowIndexById.get(selectedCell.rowId);
    if (rowIndex === undefined || !revealRowRef.current) return;
    revealRowRef.current(rowIndex);

    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => {
        findCell()?.focus({ preventScroll: false });
      });
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [editingCell, rowIndexById, selectedCell]);

  function selectCell(rowId: string, colId: Col) {
    selectGridCell({ rowId, colId });
  }

  function startEditing(rowId: string, colId: Col, startChar?: string) {
    const cell = { rowId, colId };
    if (!isCellEditable(cell)) return;
    startEdit(cell, startChar);
  }

  function commitCell(rowId: string, colId: Col) {
    commitEdit({ rowId, colId });
  }

  function cancelCell(rowId: string, colId: Col) {
    cancelEdit({ rowId, colId });
  }

  function moveFrom(rowId: string, colId: Col, rowDelta: number, colDelta: number) {
    const rowIndex = rowIndexById.get(rowId);
    if (rowIndex === undefined) return;

    const columnIndex = columns.indexOf(colId);
    if (columnIndex === -1) return;

    const nextRowIndex = rowIndex + rowDelta;
    const nextColumnIndex = Math.max(0, Math.min(columns.length - 1, columnIndex + colDelta));
    if (nextRowIndex < 0 || nextRowIndex >= rowIds.length) return;

    selectCell(rowIds[nextRowIndex], columns[nextColumnIndex]);
  }

  function tabFrom(rowId: string, colId: Col, shift: boolean): boolean {
    const rowIndex = rowIndexById.get(rowId);
    if (rowIndex === undefined) return false;

    const columnIndex = columns.indexOf(colId);
    if (columnIndex === -1) return false;

    const direction = shift ? -1 : 1;
    const nextColumnIndex = columnIndex + direction;

    if (nextColumnIndex >= 0 && nextColumnIndex < columns.length) {
      selectCell(rowId, columns[nextColumnIndex]);
      return true;
    }

    if (direction > 0 && rowIndex < rowIds.length - 1) {
      selectCell(rowIds[rowIndex + 1], columns[0]);
      return true;
    }

    if (direction > 0 && rowIndex === rowIds.length - 1) {
      if (onAddRowAtEnd) {
        onAddRowAtEnd();
        return true;
      }
      return false;
    }

    if (direction < 0 && rowIndex > 0) {
      selectCell(rowIds[rowIndex - 1], columns[columns.length - 1]);
      return true;
    }

    return false;
  }

  function handleGridKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    // Synthetic keydowns (autofill, some password managers) arrive without a
    // `key`, and the default branch below reads its length.
    if (!e.key) return;
    if (!selectedCell) return;
    if (editingCell?.rowId === selectedCell.rowId && editingCell?.colId === selectedCell.colId) return;
    if (!rowIndexById.has(selectedCell.rowId)) return;

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        moveFrom(selectedCell.rowId, selectedCell.colId, 1, 0);
        return;
      case "ArrowUp":
        e.preventDefault();
        moveFrom(selectedCell.rowId, selectedCell.colId, -1, 0);
        return;
      case "ArrowRight":
        e.preventDefault();
        moveFrom(selectedCell.rowId, selectedCell.colId, 0, 1);
        return;
      case "ArrowLeft":
        e.preventDefault();
        moveFrom(selectedCell.rowId, selectedCell.colId, 0, -1);
        return;
      case "Tab":
        if (tabFrom(selectedCell.rowId, selectedCell.colId, e.shiftKey)) {
          e.preventDefault();
        }
        return;
      case "Enter":
      case "F2":
        e.preventDefault();
        startEditing(selectedCell.rowId, selectedCell.colId);
        return;
      default:
        if (
          e.key.length === 1 &&
          !e.ctrlKey &&
          !e.metaKey &&
          !e.altKey
        ) {
          startEditing(selectedCell.rowId, selectedCell.colId, e.key);
        }
    }
  }

  return {
    containerRef,
    selectedCell,
    editingCell,
    editStartChar,
    selectCell,
    startEditing,
    commitCell,
    cancelCell,
    moveFrom,
    tabFrom,
    handleGridKeyDown,
  };
}
