"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { Trash2, RotateCcw, RefreshCw, ArrowUpDown, ArrowUp, ArrowDown, Info } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { ConfirmState } from "@/components/ui/confirm-dialog";
import { UsageInspectorDrawer } from "@/features/usage-inspector/components/UsageInspectorDrawer";
import { cn } from "@/lib/utils";
import { useStagedStore } from "@/store/staged";
import { useTableSelection } from "@/hooks/useTableSelection";
import { useHighlight } from "@/hooks/useHighlight";
import { useInlineEdit } from "@/hooks/useInlineEdit";
import { NameInput } from "@/components/ui/editable-cell";
import type { DoneAction } from "@/components/ui/editable-cell";
import { generateId } from "@/lib/uuid";
import type { Tag } from "@/types/entities";
import { FilterBar } from "./FilterBar";
import type { ColorFilter } from "./FilterBar";

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_TAG_COLOR = "#E4D4FF";

const NAVIGABLE_COLS = ["name", "description"] as const;
type NavigableCol = (typeof NAVIGABLE_COLS)[number];
type CellId = { rowId: string; colId: NavigableCol };

/** Returns "#ffffff" or "#1a1a1a" for readable contrast against a hex background. */
function contrastText(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const toLinear = (c: number) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
  const L = 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
  return L > 0.179 ? "#1a1a1a" : "#ffffff";
}

// ─── Types ────────────────────────────────────────────────────────────────────


// ─── DescInput ────────────────────────────────────────────────────────────────

/** Like NameInput but allows empty values (description is optional). */
function DescInput({ initialValue, startChar, onDone }: {
  initialValue: string;
  startChar?: string;
  onDone: (value: string, action: DoneAction) => void;
}) {
  const [value, setValue] = useState(startChar != null ? startChar : initialValue);
  const inputRef = useRef<HTMLInputElement>(null);
  const doneCalledRef = useRef(false);

  useEffect(() => {
    inputRef.current?.focus();
    if (startChar == null) inputRef.current?.select();
  }, [startChar]);

  function commit(action: DoneAction) {
    if (doneCalledRef.current) return;
    doneCalledRef.current = true;
    onDone(value.trim(), action);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    switch (e.key) {
      case "Enter":     e.preventDefault(); commit("down"); break;
      case "Escape":    e.preventDefault(); commit("cancel"); break;
      case "Tab":       e.preventDefault(); commit(e.shiftKey ? "shiftTab" : "tab"); break;
      case "ArrowDown": e.preventDefault(); commit("down"); break;
      case "ArrowUp":   e.preventDefault(); commit("up"); break;
    }
  }

  return (
    <input
      ref={inputRef}
      className="w-full bg-transparent text-xs outline-none"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => commit("cancel")}
      onKeyDown={handleKeyDown}
    />
  );
}

// ─── BulkAddBar ───────────────────────────────────────────────────────────────

function BulkAddBar({ bulkCount, onBulkCountChange, onAdd }: {
  bulkCount: number; onBulkCountChange: (n: number) => void; onAdd: (n: number) => void;
}) {
  return (
    <div className="flex items-center gap-2 border-t border-border/30 px-3 py-1.5">
      <Button variant="ghost" size="xs" className="text-muted-foreground hover:text-foreground" onClick={() => onAdd(1)}>
        + Add row
      </Button>
      <span className="text-xs text-muted-foreground">or add</span>
      <input
        type="number" min={1} max={100} value={bulkCount}
        onChange={(e) => onBulkCountChange(Math.max(1, Math.min(100, Number(e.target.value))))}
        className="h-6 w-12 rounded border border-border bg-background px-1.5 text-center text-xs outline-none focus:ring-1 focus:ring-ring"
      />
      <span className="text-xs text-muted-foreground">rows</span>
      <Button variant="outline" size="xs" onClick={() => onAdd(bulkCount)}>Add</Button>
    </div>
  );
}

// ─── TagsTable ────────────────────────────────────────────────────────────────

export function TagsTable() {
  const highlightedId = useHighlight();

  // ── Store subscriptions ───────────────────────────────────────────────────
  const stagedTags     = useStagedStore((s) => s.tags);
  const stageNew       = useStagedStore((s) => s.stageNew);
  const stageUpdate    = useStagedStore((s) => s.stageUpdate);
  const stageDelete    = useStagedStore((s) => s.stageDelete);
  const revertEntity   = useStagedStore((s) => s.revertEntity);
  const clearSaveError = useStagedStore((s) => s.clearSaveError);
  const pushUndo       = useStagedStore((s) => s.pushUndo);

  // ── Filter + bulk-add state ───────────────────────────────────────────────
  const [search, setSearch]           = useState("");
  const [colorFilter, setColorFilter] = useState<ColorFilter>("all");
  const [sortNameDir, setSortNameDir] = useState<"asc" | "desc" | null>(null);
  const [bulkCount, setBulkCount]     = useState(5);

  // ── Inline-edit state ─────────────────────────────────────────────────────
  const {
    selectedCell, editingCell, editStartChar,
    selectCell: _selectCell, startEdit, commitEdit,
  } = useInlineEdit<CellId>();

  // ── Selection state ───────────────────────────────────────────────────────
  const { selectedIds, toggleSelect, toggleSelectAll: _toggleSelectAll, clearSelection } = useTableSelection();
  const [confirmDialog, setConfirmDialog] = useState<ConfirmState | null>(null);
  const [inspectId, setInspectId] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);

  // ── Focus management ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!selectedCell || editingCell) return;
    containerRef.current
      ?.querySelector<HTMLElement>(`[data-cell="${selectedCell.rowId}:${selectedCell.colId}"]`)
      ?.focus({ preventScroll: false });
  }, [selectedCell, editingCell]);

  // ── Derived rows ──────────────────────────────────────────────────────────
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return Object.values(stagedTags)
      .filter((s) => {
        if (q && !s.entity.name.toLowerCase().includes(q) && !(s.entity.description?.toLowerCase().includes(q) ?? false)) return false;
        if (colorFilter === "has_color" && !s.entity.color) return false;
        if (colorFilter === "no_color"  &&  s.entity.color) return false;
        return true;
      })
      .sort((a, b) => {
        if (sortNameDir) {
          return sortNameDir === "asc"
            ? a.entity.name.toLowerCase().localeCompare(b.entity.name.toLowerCase())
            : b.entity.name.toLowerCase().localeCompare(a.entity.name.toLowerCase());
        }
        if (a.isNew !== b.isNew) return a.isNew ? -1 : 1;
        return a.entity.name.localeCompare(b.entity.name);
      });
  }, [stagedTags, search, colorFilter, sortNameDir]);

  const nameCountMap = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of Object.values(stagedTags)) {
      if (s.isDeleted) continue;
      const n = s.entity.name.trim().toLowerCase();
      if (n) counts.set(n, (counts.get(n) ?? 0) + 1);
    }
    return counts;
  }, [stagedTags]);

  // ── Select-all helpers ────────────────────────────────────────────────────
  const visibleIds          = useMemo(() => new Set(rows.filter((r) => !r.isDeleted).map((r) => r.entity.id)), [rows]);
  const allVisibleSelected  = visibleIds.size > 0 && [...visibleIds].every((id) => selectedIds.has(id));
  const someVisibleSelected = [...visibleIds].some((id) => selectedIds.has(id));

  function toggleSelectAll() {
    _toggleSelectAll(visibleIds, allVisibleSelected);
  }

  // ── Navigation helpers ────────────────────────────────────────────────────
  function selectCell(rowId: string, colId: NavigableCol) {
    _selectCell({ rowId, colId });
  }

  function moveFrom(rowId: string, colId: NavigableCol, rowDelta: number, colDelta: number) {
    const ri = rows.findIndex((r) => r.entity.id === rowId);
    const ci = NAVIGABLE_COLS.indexOf(colId);
    const nr = ri + rowDelta;
    const nc = Math.max(0, Math.min(NAVIGABLE_COLS.length - 1, ci + colDelta));
    if (nr < 0 || nr >= rows.length) return;
    selectCell(rows[nr].entity.id, NAVIGABLE_COLS[nc]);
  }

  function tabFrom(rowId: string, colId: NavigableCol, shift: boolean) {
    const ri = rows.findIndex((r) => r.entity.id === rowId);
    const ci = NAVIGABLE_COLS.indexOf(colId);
    const d  = shift ? -1 : 1;
    const nc = ci + d;
    if (nc >= 0 && nc < NAVIGABLE_COLS.length) {
      selectCell(rowId, NAVIGABLE_COLS[nc]);
    } else if (d > 0 && ri < rows.length - 1) {
      selectCell(rows[ri + 1].entity.id, NAVIGABLE_COLS[0]);
    } else if (d > 0 && ri === rows.length - 1 && !search) {
      addRows(1, true);
    } else if (d < 0 && ri > 0) {
      selectCell(rows[ri - 1].entity.id, NAVIGABLE_COLS[NAVIGABLE_COLS.length - 1]);
    }
  }

  // ── Editing helpers ───────────────────────────────────────────────────────
  function startEditing(rowId: string, colId: NavigableCol, startChar?: string) {
    startEdit({ rowId, colId }, startChar);
  }

  function handleNameDone(rowId: string, value: string, action: DoneAction) {
    if (action !== "cancel") {
      const trimmed = value.trim().replace(/ /g, "");
      const current = stagedTags[rowId]?.entity;
      if (trimmed && current) {
        const candidateKey = trimmed.toLowerCase();
        const currentKey   = current.name.trim().toLowerCase();
        // Build a count that excludes this row's current name so renaming to
        // the same value doesn't trigger a false collision.
        const countWithoutSelf = (nameCountMap.get(candidateKey) ?? 0) - (candidateKey === currentKey ? 1 : 0);
        if (countWithoutSelf >= 1) {
          toast.error(`A tag named "${trimmed}" already exists.`);
          commitEdit({ rowId, colId: "name" });
          return;
        }
        if (trimmed !== current.name) {
          pushUndo();
          stageUpdate("tags", rowId, { name: trimmed });
        }
      }
    }
    commitEdit({ rowId, colId: "name" });
    if (action === "down")          moveFrom(rowId, "name", 1, 0);
    else if (action === "up")       moveFrom(rowId, "name", -1, 0);
    else if (action === "tab")      tabFrom(rowId, "name", false);
    else if (action === "shiftTab") tabFrom(rowId, "name", true);
  }

  function handleDescDone(rowId: string, value: string, action: DoneAction) {
    if (action !== "cancel") {
      const trimmed = value.trim();
      const current = stagedTags[rowId]?.entity;
      if (current && trimmed !== (current.description ?? "")) {
        pushUndo();
        stageUpdate("tags", rowId, { description: trimmed || undefined });
      }
    }
    commitEdit({ rowId, colId: "description" });
    if (action === "down")          moveFrom(rowId, "description", 1, 0);
    else if (action === "up")       moveFrom(rowId, "description", -1, 0);
    else if (action === "tab")      tabFrom(rowId, "description", false);
    else if (action === "shiftTab") tabFrom(rowId, "description", true);
  }

  // ── Bulk add ──────────────────────────────────────────────────────────────
  function addRows(count: number, focusFirst = false) {
    pushUndo();
    const firstId = generateId();
    stageNew("tags", { id: firstId, name: "" });
    for (let i = 1; i < count; i++) {
      stageNew("tags", { id: generateId(), name: "" });
    }
    if (focusFirst) setTimeout(() => startEditing(firstId, "name"), 0);
  }

  // ── Color ─────────────────────────────────────────────────────────────────
  function handleColorChange(id: string, color: string) {
    pushUndo();
    stageUpdate("tags", id, { color });
  }

  function handleColorClear(id: string) {
    pushUndo();
    stageUpdate("tags", id, { color: undefined });
  }

  // ── Single delete ─────────────────────────────────────────────────────────
  function requestDelete(tag: Tag, isNew: boolean) {
    if (isNew) {
      pushUndo();
      stageDelete("tags", tag.id);
      return;
    }
    setConfirmDialog({
      title: "Delete tag?",
      message: `"${tag.name}" will be permanently deleted on Save.`,
      onConfirm: () => { pushUndo(); stageDelete("tags", tag.id); },
    });
  }

  // ── Bulk delete ───────────────────────────────────────────────────────────
  function handleBulkDelete() {
    const ids = [...selectedIds].filter((id) => stagedTags[id] && !stagedTags[id].isDeleted);
    if (ids.length === 0) { clearSelection(); return; }

    const newIds    = ids.filter((id) =>  stagedTags[id]?.isNew);
    const serverIds = ids.filter((id) => !stagedTags[id]?.isNew);

    let message = "";
    if (serverIds.length > 0) message += `${serverIds.length} will be staged for deletion and removed on Save.`;
    if (newIds.length > 0)    message += ` ${newIds.length} unsaved new row${newIds.length !== 1 ? "s" : ""} will be discarded immediately.`;

    setConfirmDialog({
      title: `Delete ${ids.length} tag${ids.length !== 1 ? "s" : ""}?`,
      message: message.trim(),
      onConfirm: () => {
        pushUndo();
        for (const id of ids) stageDelete("tags", id);
        clearSelection();
      },
    });
  }

  // ── Keyboard handler ──────────────────────────────────────────────────────
  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (!selectedCell) return;
    if (editingCell?.rowId === selectedCell.rowId && editingCell?.colId === selectedCell.colId) return;
    const row = rows.find((r) => r.entity.id === selectedCell.rowId);
    if (!row) return;

    switch (e.key) {
      case "ArrowDown":  e.preventDefault(); moveFrom(selectedCell.rowId, selectedCell.colId, 1, 0); break;
      case "ArrowUp":    e.preventDefault(); moveFrom(selectedCell.rowId, selectedCell.colId, -1, 0); break;
      case "ArrowRight": e.preventDefault(); moveFrom(selectedCell.rowId, selectedCell.colId, 0, 1); break;
      case "ArrowLeft":  e.preventDefault(); moveFrom(selectedCell.rowId, selectedCell.colId, 0, -1); break;
      case "Tab": e.preventDefault(); tabFrom(selectedCell.rowId, selectedCell.colId, e.shiftKey); break;
      case "Enter": case "F2":
        e.preventDefault();
        if (!row.isDeleted) startEditing(selectedCell.rowId, selectedCell.colId);
        break;
      default:
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !row.isDeleted) {
          startEditing(selectedCell.rowId, selectedCell.colId, e.key);
        }
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  const totalCount     = Object.values(stagedTags).filter((s) => !s.isDeleted).length;
  const activeSelected = [...selectedIds].filter((id) => stagedTags[id] && !stagedTags[id].isDeleted).length;

  return (
    <>
      <div
        ref={containerRef}
        className="flex min-h-0 flex-1 flex-col overflow-hidden outline-none"
        onKeyDown={handleKeyDown}
        tabIndex={-1}
      >
        <FilterBar
          search={search} onSearchChange={setSearch}
          colorFilter={colorFilter} onColorFilterChange={setColorFilter}
          filteredCount={rows.filter((r) => !r.isDeleted).length}
          totalCount={totalCount}
          selectedCount={activeSelected}
          onBulkDelete={handleBulkDelete}
          onDeselect={clearSelection}
        />

        <div className="min-h-0 flex-1 overflow-auto">
        {rows.length === 0 ? (
          <div className="flex flex-1 items-center justify-center py-16 text-sm text-muted-foreground">
            {search || colorFilter !== "all"
              ? "No tags match the current filters."
              : "No tags yet. Click \"Add Tag\" to create one."}
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead className="sticky top-0 z-10 bg-background">
              <tr className="border-b border-border bg-muted/30 text-muted-foreground">
                <th className="w-9 px-3 py-1.5">
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    ref={(el) => { if (el) el.indeterminate = someVisibleSelected && !allVisibleSelected; }}
                    onChange={toggleSelectAll}
                    className="h-3.5 w-3.5 cursor-pointer rounded accent-primary"
                  />
                </th>
                <th className="w-1 p-0" />
                <th className="w-10 px-2 py-1.5 text-left text-xs font-medium">Color</th>
                <th
                  className="w-[300px] px-2 py-1.5 text-left"
                  aria-sort={sortNameDir === "asc" ? "ascending" : sortNameDir === "desc" ? "descending" : "none"}
                >
                  <button
                    className="flex select-none items-center text-xs font-medium text-muted-foreground hover:text-foreground"
                    onClick={() => setSortNameDir((d) => d === null ? "asc" : d === "asc" ? "desc" : null)}
                    aria-label={`Sort by name${sortNameDir === "asc" ? ", ascending" : sortNameDir === "desc" ? ", descending" : ""}`}
                  >
                    Name
                    {sortNameDir === null
                      ? <ArrowUpDown className="ml-1 inline h-3 w-3 opacity-30" />
                      : sortNameDir === "asc"
                        ? <ArrowUp className="ml-1 inline h-3 w-3" />
                        : <ArrowDown className="ml-1 inline h-3 w-3" />}
                  </button>
                </th>
                <th className="px-2 py-1.5 text-left text-xs font-medium">Description</th>
                <th className="w-16 p-0" />
              </tr>
            </thead>
            <tbody>
              {rows.map(({ entity, isNew, isUpdated, isDeleted, saveError }) => {
                const isDuplicate   = !isDeleted && (nameCountMap.get(entity.name.trim().toLowerCase()) ?? 0) > 1;
                const nameSelected  = selectedCell?.rowId === entity.id && selectedCell?.colId === "name";
                const nameEditing   = editingCell?.rowId  === entity.id && editingCell?.colId  === "name";
                const descSelected  = selectedCell?.rowId === entity.id && selectedCell?.colId === "description";
                const descEditing   = editingCell?.rowId  === entity.id && editingCell?.colId  === "description";
                const isRowSelected = !isDeleted && selectedIds.has(entity.id);

                return (
                  <tr
                    key={entity.id}
                    data-row-id={entity.id}
                    className={cn(
                      "group/row border-b border-border/30 border-l-2 border-l-transparent transition-colors",
                      highlightedId === entity.id && "bg-primary/20 ring-2 ring-inset ring-primary/40",
                      highlightedId !== entity.id && isRowSelected && "bg-primary/10",
                      highlightedId !== entity.id && !isRowSelected && saveError && "bg-destructive/5 border-l-destructive",
                      highlightedId !== entity.id && !isRowSelected && !saveError && isDeleted && "opacity-50 border-l-muted-foreground/30",
                      highlightedId !== entity.id && !isRowSelected && !saveError && !isDeleted && isNew && "bg-green-50/30 dark:bg-green-950/10 border-l-green-500",
                      highlightedId !== entity.id && !isRowSelected && !saveError && !isDeleted && !isNew && isUpdated && "bg-amber-50/30 dark:bg-amber-950/10 border-l-amber-400",
                    )}
                  >
                    {/* Checkbox */}
                    <td className="w-9 px-3 py-0.5">
                      {!isDeleted && (
                        <input
                          type="checkbox"
                          checked={isRowSelected}
                          onChange={(e) => toggleSelect(entity.id, e.target.checked)}
                          onClick={(e) => e.stopPropagation()}
                          className="h-3.5 w-3.5 cursor-pointer rounded accent-primary"
                        />
                      )}
                    </td>

                    {/* State indicator */}
                    <td className="w-1 p-0 pl-0.5">
                      <div
                        title={saveError}
                        className={cn(
                          "h-4 w-0.5 rounded-full",
                          saveError && "bg-destructive",
                          !saveError && isDeleted && "bg-muted-foreground/30",
                          !saveError && !isDeleted && isNew && "bg-green-500",
                          !saveError && !isDeleted && !isNew && isUpdated && "bg-amber-400",
                        )}
                      />
                    </td>

                    {/* Color swatch */}
                    <td className="w-10 px-2 py-0.5">
                      {!isDeleted && (
                        <div className="flex items-center gap-1">
                          <label className="relative flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center">
                            <input
                              type="color"
                              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                              value={entity.color ?? DEFAULT_TAG_COLOR}
                              onChange={(e) => handleColorChange(entity.id, e.target.value)}
                            />
                            <span
                              className={cn(
                                "h-4 w-4 rounded-full transition-transform hover:scale-110",
                                entity.color ? "border border-border/50" : "border border-dashed border-border/60"
                              )}
                              style={{ backgroundColor: entity.color ?? DEFAULT_TAG_COLOR }}
                            />
                          </label>
                          {entity.color && (
                            <button
                              className="opacity-0 group-hover/row:opacity-60 hover:!opacity-100 text-muted-foreground transition-opacity"
                              onClick={() => handleColorClear(entity.id)}
                              title="Clear color"
                            >
                              ×
                            </button>
                          )}
                        </div>
                      )}
                    </td>

                    {/* Name — useInlineEdit + NameInput */}
                    <td
                      data-cell={`${entity.id}:name`}
                      tabIndex={nameSelected ? 0 : -1}
                      className={cn(
                        "cursor-default px-2 py-0.5 outline-none",
                        nameSelected && !nameEditing && "bg-primary/10 ring-1 ring-inset ring-primary/50",
                        nameEditing && "ring-1 ring-inset ring-primary",
                      )}
                      onClick={() => {
                        if (!isDeleted) {
                          if (nameSelected) startEditing(entity.id, "name");
                          else selectCell(entity.id, "name");
                        }
                      }}
                      onFocus={() => { if (!editingCell) selectCell(entity.id, "name"); }}
                    >
                      {nameEditing && !isDeleted ? (
                        <NameInput
                          initialValue={entity.name}
                          startChar={editStartChar}
                          onDone={(val, action) => handleNameDone(entity.id, val, action)}
                          className="text-xs"
                        />
                      ) : (() => {
                        const effectiveColor = entity.color ?? DEFAULT_TAG_COLOR;
                        return (
                          <span
                            className={cn(
                              "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium",
                              isDeleted && "opacity-60",
                              isDuplicate && "ring-2 ring-amber-400",
                            )}
                            style={{ backgroundColor: effectiveColor, color: contrastText(effectiveColor) }}
                          >
                            {entity.name
                              ? `#${entity.name}`
                              : <span className="italic opacity-60">unnamed</span>}
                          </span>
                        );
                      })()}
                    </td>

                    {/* Description — useInlineEdit + DescInput */}
                    <td
                      data-cell={`${entity.id}:description`}
                      tabIndex={descSelected ? 0 : -1}
                      className={cn(
                        "cursor-default px-2 py-0.5 text-muted-foreground outline-none",
                        descSelected && !descEditing && "bg-primary/10 ring-1 ring-inset ring-primary/50",
                        descEditing && "ring-1 ring-inset ring-primary",
                      )}
                      onClick={() => {
                        if (!isDeleted) {
                          if (descSelected) startEditing(entity.id, "description");
                          else selectCell(entity.id, "description");
                        }
                      }}
                      onFocus={() => { if (!editingCell) selectCell(entity.id, "description"); }}
                    >
                      {descEditing && !isDeleted ? (
                        <DescInput
                          initialValue={entity.description ?? ""}
                          startChar={editStartChar}
                          onDone={(val, action) => handleDescDone(entity.id, val, action)}
                        />
                      ) : (
                        <span className="block truncate">
                          {entity.description || <span className="italic text-muted-foreground/50">—</span>}
                        </span>
                      )}
                    </td>

                    {/* Actions */}
                    <td className="w-16 px-1 py-0.5">
                      <div className="flex items-center justify-end gap-0.5 opacity-0 transition-opacity group-hover/row:opacity-100">
                        {saveError ? (
                          <Button
                            variant="ghost" size="icon-xs"
                            title="Clear error and retry"
                            onClick={() => clearSaveError("tags", entity.id)}
                          >
                            <RefreshCw />
                          </Button>
                        ) : isDeleted ? (
                          <Button variant="ghost" size="icon-xs" title="Undo delete" onClick={() => revertEntity("tags", entity.id)}>
                            <RotateCcw />
                          </Button>
                        ) : (
                          <>
                            <Button variant="ghost" size="icon-xs" title="Inspect usage" aria-label="Inspect usage"
                              onClick={() => setInspectId(entity.id)}>
                              <Info />
                            </Button>
                            <Button
                              variant="ghost" size="icon-xs"
                              className="text-destructive hover:text-destructive"
                              title="Delete tag"
                              onClick={() => requestDelete(entity, isNew)}
                            >
                              <Trash2 />
                            </Button>
                            {(isNew || isUpdated) && (
                              <Button variant="ghost" size="icon-xs" title="Revert" onClick={() => revertEntity("tags", entity.id)}>
                                <RotateCcw />
                              </Button>
                            )}
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        </div>

        <BulkAddBar bulkCount={bulkCount} onBulkCountChange={setBulkCount} onAdd={(n) => addRows(n, true)} />
      </div>

      <ConfirmDialog
        open={confirmDialog !== null}
        onOpenChange={(open) => { if (!open) setConfirmDialog(null); }}
        state={confirmDialog}
      />

      <UsageInspectorDrawer
        entityId={inspectId}
        entityType="tag"
        open={!!inspectId}
        onOpenChange={(open) => { if (!open) setInspectId(null); }}
      />
    </>
  );
}
