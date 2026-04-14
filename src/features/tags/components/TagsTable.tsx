"use client";

import { useState, useMemo } from "react";
import { ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";
import { toast } from "sonner";
import type { ConfirmState } from "@/components/ui/confirm-dialog";
import { TableBulkAddBar } from "@/components/ui/table-bulk-add-bar";
import { useStagedStore } from "@/store/staged";
import { useTableSelection } from "@/hooks/useTableSelection";
import { useHighlight } from "@/hooks/useHighlight";
import { useEditableGrid } from "@/hooks/useEditableGrid";
import type { DoneAction } from "@/components/ui/editable-cell";
import { generateId } from "@/lib/uuid";
import type { Tag } from "@/types/entities";
import { FilterBar } from "./FilterBar";
import { TagsTableRow } from "./TagsTableRow";
import type { ColorFilter } from "./FilterBar";

// ─── Constants ────────────────────────────────────────────────────────────────

const NAVIGABLE_COLS = ["name", "description"] as const;
type NavigableCol = (typeof NAVIGABLE_COLS)[number];

// ─── TagsTable ────────────────────────────────────────────────────────────────

export function TagsTable({
  onConfirmDialogChange,
  onInspectIdChange,
}: {
  onConfirmDialogChange: (state: ConfirmState | null) => void;
  onInspectIdChange: (id: string | null) => void;
}) {
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
  // ── Selection state ───────────────────────────────────────────────────────
  const { selectedIds, toggleSelect, toggleSelectAll: _toggleSelectAll, clearSelection } = useTableSelection();

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

  const rowIds = useMemo(() => rows.map((row) => row.entity.id), [rows]);

  const {
    containerRef,
    selectedCell,
    editingCell,
    editStartChar,
    selectCell,
    startEditing,
    commitCell,
    moveFrom,
    tabFrom,
    handleGridKeyDown,
  } = useEditableGrid<NavigableCol>({
    rowIds,
    columns: NAVIGABLE_COLS,
    canEditCell: (cell) => !!stagedTags[cell.rowId] && !stagedTags[cell.rowId].isDeleted,
    onAddRowAtEnd: search ? undefined : () => addRows(1, true),
  });

  // ── Select-all helpers ────────────────────────────────────────────────────
  const visibleIds          = useMemo(() => new Set(rows.filter((r) => !r.isDeleted).map((r) => r.entity.id)), [rows]);
  const allVisibleSelected  = visibleIds.size > 0 && [...visibleIds].every((id) => selectedIds.has(id));
  const someVisibleSelected = [...visibleIds].some((id) => selectedIds.has(id));

  function toggleSelectAll() {
    _toggleSelectAll(visibleIds, allVisibleSelected);
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
          commitCell(rowId, "name");
          return;
        }
        if (trimmed !== current.name) {
          pushUndo();
          stageUpdate("tags", rowId, { name: trimmed });
        }
      }
    }
    commitCell(rowId, "name");
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
    commitCell(rowId, "description");
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
    onConfirmDialogChange({
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

    onConfirmDialogChange({
      title: `Delete ${ids.length} tag${ids.length !== 1 ? "s" : ""}?`,
      message: message.trim(),
      onConfirm: () => {
        pushUndo();
        for (const id of ids) stageDelete("tags", id);
        clearSelection();
      },
    });
  }

  // ── Render ────────────────────────────────────────────────────────────────
  const totalCount     = Object.values(stagedTags).filter((s) => !s.isDeleted).length;
  const activeSelected = [...selectedIds].filter((id) => stagedTags[id] && !stagedTags[id].isDeleted).length;

  return (
    <>
      <div
        ref={containerRef}
        className="flex min-h-0 flex-1 flex-col overflow-hidden outline-none"
        onKeyDown={handleGridKeyDown}
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
              {rows.map((row) => {
                const { entity, isDeleted } = row;
                const isNameEditing = editingCell?.rowId === entity.id && editingCell.colId === "name";
                const isDescEditing = editingCell?.rowId === entity.id && editingCell.colId === "description";
                return (
                  <TagsTableRow
                    key={entity.id}
                    row={row}
                    highlightedId={highlightedId}
                    isRowSelected={!isDeleted && selectedIds.has(entity.id)}
                    isDuplicate={!isDeleted && (nameCountMap.get(entity.name.trim().toLowerCase()) ?? 0) > 1}
                    isNameSelected={selectedCell?.rowId === entity.id && selectedCell.colId === "name"}
                    isNameEditing={isNameEditing}
                    isDescSelected={selectedCell?.rowId === entity.id && selectedCell.colId === "description"}
                    isDescEditing={isDescEditing}
                    nameEditStartChar={isNameEditing ? editStartChar : undefined}
                    descEditStartChar={isDescEditing ? editStartChar : undefined}
                    onToggleSelect={toggleSelect}
                    onSelectCell={selectCell}
                    onStartEditing={startEditing}
                    onDoneName={handleNameDone}
                    onDoneDescription={handleDescDone}
                    onChangeColor={handleColorChange}
                    onClearColor={handleColorClear}
                    onClearSaveError={(id) => clearSaveError("tags", id)}
                    onRevert={(id) => revertEntity("tags", id)}
                    onInspect={onInspectIdChange}
                    onDelete={requestDelete}
                    isAnotherCellEditing={!!editingCell}
                  />
                );
              })}
            </tbody>
          </table>
        )}
        </div>

        <TableBulkAddBar bulkCount={bulkCount} onBulkCountChange={setBulkCount} onAdd={(n) => addRows(n, true)} />
      </div>
    </>
  );
}
