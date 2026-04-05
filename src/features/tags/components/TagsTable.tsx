"use client";

import { useState, useRef, useCallback, useMemo } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useStagedStore } from "@/store/staged";
import { useTableSelection } from "@/hooks/useTableSelection";
import type { Tag } from "@/types/entities";
import { FilterBar } from "./FilterBar";
import type { ColorFilter } from "./FilterBar";

const DEFAULT_TAG_COLOR = "#E4D4FF";

/** Returns "#ffffff" or "#1a1a1a" for readable contrast against a hex background. */
function contrastText(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const toLinear = (c: number) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
  const L = 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
  return L > 0.179 ? "#1a1a1a" : "#ffffff";
}

type ConfirmState = { title: string; message: string; onConfirm: () => void };
type EditingCell = { id: string; col: "name" | "description" } | null;

interface TagsTableProps {
  highlightedId?: string | null;
}

export function TagsTable({ highlightedId }: TagsTableProps) {
  const stagedTags  = useStagedStore((s) => s.tags);
  const stageUpdate = useStagedStore((s) => s.stageUpdate);
  const stageDelete = useStagedStore((s) => s.stageDelete);
  const pushUndo    = useStagedStore((s) => s.pushUndo);

  // ── Filter state ─────────────────────────────────────────────────────────────
  const [search, setSearch]           = useState("");
  const [colorFilter, setColorFilter] = useState<ColorFilter>("all");

  // ── Inline editing state ──────────────────────────────────────────────────────
  const [editingCell, setEditingCell] = useState<EditingCell>(null);
  const [editValue, setEditValue]     = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // ── Selection state ───────────────────────────────────────────────────────────
  const { selectedIds, toggleSelect, toggleSelectAll: _toggleSelectAll, clearSelection } = useTableSelection();
  const [confirmDialog, setConfirmDialog] = useState<ConfirmState | null>(null);

  // ── Derived rows ──────────────────────────────────────────────────────────────

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return Object.values(stagedTags)
      .filter((s) => {
        if (q && !s.entity.name.toLowerCase().includes(q)) return false;
        if (colorFilter === "has_color" && !s.entity.color) return false;
        if (colorFilter === "no_color"  &&  s.entity.color) return false;
        return true;
      })
      .sort((a, b) => {
        if (a.isNew !== b.isNew) return a.isNew ? -1 : 1;
        return a.entity.name.localeCompare(b.entity.name);
      });
  }, [stagedTags, search, colorFilter]);

  const duplicateNames = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of Object.values(stagedTags)) {
      if (s.isDeleted) continue;
      const n = s.entity.name.trim().toLowerCase();
      if (n) counts.set(n, (counts.get(n) ?? 0) + 1);
    }
    return new Set([...counts.entries()].filter(([, c]) => c > 1).map(([n]) => n));
  }, [stagedTags]);

  // ── Select-all helpers ────────────────────────────────────────────────────────

  const visibleIds        = useMemo(() => new Set(rows.filter((r) => !r.isDeleted).map((r) => r.entity.id)), [rows]);
  const allVisibleSelected = visibleIds.size > 0 && [...visibleIds].every((id) => selectedIds.has(id));
  const someVisibleSelected = [...visibleIds].some((id) => selectedIds.has(id));

  function toggleSelectAll() {
    _toggleSelectAll(visibleIds, allVisibleSelected);
  }

  // ── Inline editing ────────────────────────────────────────────────────────────

  const startEditing = useCallback((id: string, col: "name" | "description", current: string) => {
    setEditingCell({ id, col });
    setEditValue(current);
    setTimeout(() => inputRef.current?.select(), 0);
  }, []);

  const commitEditing = useCallback(() => {
    if (!editingCell) return;
    const { id, col } = editingCell;
    const trimmed = editValue.trim();
    const current = stagedTags[id]?.entity;

    if (col === "name") {
      if (!trimmed) {
        toast.error("Tag name cannot be empty.");
        setEditingCell(null);
        return;
      }
      const isDuplicate = Object.values(stagedTags).some(
        (s) => !s.isDeleted && s.entity.id !== id && s.entity.name.trim().toLowerCase() === trimmed.toLowerCase()
      );
      if (isDuplicate) {
        toast.error(`A tag named "${trimmed}" already exists.`);
        setEditingCell(null);
        return;
      }
    }

    if (current && trimmed !== (current[col] ?? "")) {
      pushUndo();
      stageUpdate("tags", id, { [col]: trimmed || undefined });
    }
    setEditingCell(null);
  }, [editingCell, editValue, stagedTags, pushUndo, stageUpdate]);

  const cancelEditing = useCallback(() => setEditingCell(null), []);

  function handleCellKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") { e.preventDefault(); commitEditing(); }
    if (e.key === "Escape") { e.preventDefault(); cancelEditing(); }
  }

  // ── Color ─────────────────────────────────────────────────────────────────────

  function handleColorChange(id: string, color: string) {
    pushUndo();
    stageUpdate("tags", id, { color });
  }

  function handleColorClear(id: string) {
    pushUndo();
    stageUpdate("tags", id, { color: undefined });
  }

  // ── Single delete ─────────────────────────────────────────────────────────────

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

  // ── Bulk delete ───────────────────────────────────────────────────────────────

  function handleBulkDelete() {
    const ids = [...selectedIds].filter((id) => stagedTags[id] && !stagedTags[id].isDeleted);
    if (ids.length === 0) { clearSelection(); return; }

    const newIds    = ids.filter((id) => stagedTags[id]?.isNew);
    const serverIds = ids.filter((id) => !stagedTags[id]?.isNew);

    let message = `${ids.length} tag${ids.length !== 1 ? "s" : ""} will be deleted.`;
    if (serverIds.length > 0) message = `${serverIds.length} will be staged for deletion and removed on Save.`;
    if (newIds.length > 0) message += ` ${newIds.length} unsaved new row${newIds.length !== 1 ? "s" : ""} will be discarded immediately.`;

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

  // ── Render ────────────────────────────────────────────────────────────────────

  const totalCount    = Object.values(stagedTags).filter((s) => !s.isDeleted).length;
  const activeSelected = [...selectedIds].filter((id) => stagedTags[id] && !stagedTags[id].isDeleted).length;

  return (
    <>
      <div className="flex flex-col">
        <FilterBar
          search={search} onSearchChange={setSearch}
          colorFilter={colorFilter} onColorFilterChange={setColorFilter}
          filteredCount={rows.filter((r) => !r.isDeleted).length}
          totalCount={totalCount}
          selectedCount={activeSelected}
          onBulkDelete={handleBulkDelete}
          onDeselect={clearSelection}
        />

        {rows.length === 0 ? (
          <div className="flex flex-1 items-center justify-center py-16 text-sm text-muted-foreground">
            {search || colorFilter !== "all"
              ? "No tags match the current filters."
              : "No tags yet. Click \"Add Tag\" to create one."}
          </div>
        ) : (
          <div className="w-full overflow-auto">
            <table className="w-full text-sm">
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
                  <th className="w-[300px] px-2 py-1.5 text-left text-xs font-medium">Name</th>
                  <th className="px-2 py-1.5 text-left text-xs font-medium">Description</th>
                  <th className="w-12 p-0" />
                </tr>
              </thead>
              <tbody>
                {rows.map(({ entity, isNew, isUpdated, isDeleted, saveError }) => {
                  const isDuplicate    = !isDeleted && duplicateNames.has(entity.name.trim().toLowerCase());
                  const isEditingName  = editingCell?.id === entity.id && editingCell.col === "name";
                  const isEditingDesc  = editingCell?.id === entity.id && editingCell.col === "description";
                  const isRowSelected  = !isDeleted && selectedIds.has(entity.id);

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

                      {/* Name */}
                      <td
                        className={cn(
                          "cursor-default px-2 py-0.5",
                          !isDeleted && !isEditingName && "hover:bg-muted/40",
                        )}
                        onClick={() => !isDeleted && !isEditingName && startEditing(entity.id, "name", entity.name)}
                      >
                        {isEditingName ? (
                          <input
                            ref={inputRef}
                            className="w-full bg-transparent outline-none ring-1 ring-primary rounded px-1 -mx-1"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value.replace(/ /g, ""))}
                            onBlur={commitEditing}
                            onKeyDown={handleCellKeyDown}
                            autoFocus
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

                      {/* Description */}
                      <td
                        className={cn(
                          "cursor-default px-2 py-0.5 text-muted-foreground",
                          !isDeleted && !isEditingDesc && "hover:bg-muted/40",
                        )}
                        onClick={() => !isDeleted && !isEditingDesc && startEditing(entity.id, "description", entity.description ?? "")}
                      >
                        {isEditingDesc ? (
                          <input
                            ref={editingCell?.col === "description" ? inputRef : undefined}
                            className="w-full bg-transparent outline-none ring-1 ring-primary rounded px-1 -mx-1 text-foreground"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onBlur={commitEditing}
                            onKeyDown={handleCellKeyDown}
                            autoFocus
                          />
                        ) : (
                          <span className="truncate block">
                            {entity.description || <span className="italic text-muted-foreground/50">—</span>}
                          </span>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="w-12 px-1 py-0.5">
                        {!isDeleted && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 opacity-0 group-hover/row:opacity-100 text-muted-foreground hover:text-destructive transition-opacity"
                            onClick={() => requestDelete(entity, isNew)}
                            title="Delete tag"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Confirm delete dialog */}
      <Dialog open={confirmDialog !== null} onOpenChange={(open) => { if (!open) setConfirmDialog(null); }}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>{confirmDialog?.title}</DialogTitle>
            <DialogDescription>{confirmDialog?.message}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDialog(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => { confirmDialog?.onConfirm(); setConfirmDialog(null); }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
