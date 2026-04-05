"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { useHighlight } from "@/hooks/useHighlight";
import { useInlineEdit } from "@/hooks/useInlineEdit";
import { useTableSelection } from "@/hooks/useTableSelection";
import { NameInput } from "@/components/ui/editable-cell";
import type { DoneAction } from "@/components/ui/editable-cell";
import {
  Archive, ArchiveRestore, RotateCcw, Trash2, RefreshCw,
  ArrowUpDown, ArrowUp, ArrowDown, AlertTriangle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useStagedStore } from "@/store/staged";
import { generateId } from "@/lib/uuid";
import { FilterBar } from "./FilterBar";
import { BulkAddBar } from "./BulkAddBar";
import type { StatusFilter, BudgetFilter } from "./FilterBar";
import type { StagedEntity } from "@/types/staged";
import type { Account } from "@/types/entities";

// ─── Types ─────────────────────────────────────────────────────────────────────

const NAVIGABLE_COLS = ["name", "offBudget"] as const;
type NavigableCol = (typeof NAVIGABLE_COLS)[number];
type CellId = { rowId: string; colId: NavigableCol };
type AccountRow = StagedEntity<Account>;
type SortCol = "name" | "offBudget" | "closed";
type SortDir = "asc" | "desc";
type ConfirmState = { title: string; message: string; onConfirm: () => void };

// ─── Sort helpers ──────────────────────────────────────────────────────────────

function SortIndicator({ col, sortCol, sortDir }: { col: SortCol; sortCol: SortCol | null; sortDir: SortDir }) {
  if (sortCol !== col) return <ArrowUpDown className="ml-1 inline h-3 w-3 opacity-30" />;
  return sortDir === "asc"
    ? <ArrowUp className="ml-1 inline h-3 w-3" />
    : <ArrowDown className="ml-1 inline h-3 w-3" />;
}

// ─── AccountsTable ─────────────────────────────────────────────────────────────

export function AccountsTable() {
  const highlightedId = useHighlight();

  // ── Filter / sort state ──────────────────────────────────────────────────────
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [budgetFilter, setBudgetFilter] = useState<BudgetFilter>("all");
  const [sortCol, setSortCol] = useState<SortCol | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  // ── Cell selection + editing state ───────────────────────────────────────────
  const {
    selectedCell, editingCell, editStartChar,
    selectCell: _selectCell, startEdit, commitEdit,
  } = useInlineEdit<CellId>();
  const [bulkCount, setBulkCount] = useState(5);

  // ── Multi-select state ───────────────────────────────────────────────────────
  const { selectedIds, toggleSelect: toggleSelectRow, toggleSelectAll: _toggleSelectAll, clearSelection } = useTableSelection();
  const [confirmDialog, setConfirmDialog] = useState<ConfirmState | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);

  // ── Store subscriptions ──────────────────────────────────────────────────────
  const staged = useStagedStore((s) => s.accounts);
  const stageNew = useStagedStore((s) => s.stageNew);
  const stageUpdate = useStagedStore((s) => s.stageUpdate);
  const stageDelete = useStagedStore((s) => s.stageDelete);
  const revertEntity = useStagedStore((s) => s.revertEntity);
  const clearSaveError = useStagedStore((s) => s.clearSaveError);
  const pushUndo = useStagedStore((s) => s.pushUndo);

  // ── Duplicate name detection ─────────────────────────────────────────────────
  const duplicateNames = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of Object.values(staged)) {
      if (s.isDeleted) continue;
      const key = s.entity.name.trim().toLowerCase();
      if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const dupes = new Set<string>();
    for (const [name, count] of counts) {
      if (count > 1) dupes.add(name);
    }
    return dupes;
  }, [staged]);

  // ── Derived rows: filter → sort ──────────────────────────────────────────────
  const rows: AccountRow[] = useMemo(() => {
    const q = search.toLowerCase();
    const result: AccountRow[] = [];
    for (const r of Object.values(staged) as AccountRow[]) {
      if (q && !r.entity.name.toLowerCase().includes(q)) continue;
      if (statusFilter === "open"   && r.entity.closed)     continue;
      if (statusFilter === "closed" && !r.entity.closed)    continue;
      if (budgetFilter === "on"  && r.entity.offBudget)  continue;
      if (budgetFilter === "off" && !r.entity.offBudget) continue;
      result.push(r);
    }

    if (sortCol) {
      result.sort((a, b) => {
        let av: string | boolean, bv: string | boolean;
        if (sortCol === "name") { av = a.entity.name.toLowerCase(); bv = b.entity.name.toLowerCase(); }
        else if (sortCol === "offBudget") { av = a.entity.offBudget; bv = b.entity.offBudget; }
        else { av = a.entity.closed; bv = b.entity.closed; }
        if (av < bv) return sortDir === "asc" ? -1 : 1;
        if (av > bv) return sortDir === "asc" ? 1 : -1;
        return 0;
      });
    }
    return result;
  }, [staged, search, statusFilter, budgetFilter, sortCol, sortDir]);

  function toggleSort(col: SortCol) {
    if (sortCol === col) {
      if (sortDir === "asc") { setSortDir("desc"); }
      else { setSortCol(null); setSortDir("asc"); }
    } else {
      setSortCol(col);
      setSortDir("asc");
    }
  }

  // ── Multi-select helpers ─────────────────────────────────────────────────────
  const visibleIds = useMemo(() => new Set(rows.map((r) => r.entity.id)), [rows]);
  const allVisibleSelected = rows.length > 0 && rows.every((r) => selectedIds.has(r.entity.id));
  const someVisibleSelected = rows.some((r) => selectedIds.has(r.entity.id));

  function toggleSelectAll() {
    _toggleSelectAll(visibleIds, allVisibleSelected);
  }

  // ── Focus management ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!selectedCell || editingCell) return;
    containerRef.current
      ?.querySelector<HTMLElement>(`[data-cell="${selectedCell.rowId}:${selectedCell.colId}"]`)
      ?.focus({ preventScroll: false });
  }, [selectedCell, editingCell]);

  // ── Navigation helpers ───────────────────────────────────────────────────────
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
    const d = shift ? -1 : 1;
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

  // ── Editing helpers ──────────────────────────────────────────────────────────
  function startEditing(rowId: string, colId: NavigableCol, startChar?: string) {
    startEdit({ rowId, colId }, startChar);
  }

  function handleNameDone(rowId: string, value: string, action: DoneAction) {
    if (action !== "cancel" && value !== staged[rowId]?.entity.name) {
      pushUndo();
      stageUpdate("accounts", rowId, { name: value });
    }
    commitEdit({ rowId, colId: "name" });
    if (action === "down") moveFrom(rowId, "name", 1, 0);
    else if (action === "up") moveFrom(rowId, "name", -1, 0);
    else if (action === "tab") tabFrom(rowId, "name", false);
    else if (action === "shiftTab") tabFrom(rowId, "name", true);
  }

  // ── Bulk add ─────────────────────────────────────────────────────────────────
  function addRows(count: number, focusFirst = false) {
    pushUndo();
    const firstId = generateId();
    stageNew("accounts", { id: firstId, name: "", offBudget: false, closed: false });
    for (let i = 1; i < count; i++) {
      stageNew("accounts", { id: generateId(), name: "", offBudget: false, closed: false });
    }
    if (focusFirst) setTimeout(() => startEditing(firstId, "name"), 0);
  }

  // ── Bulk actions ─────────────────────────────────────────────────────────────
  function handleBulkDelete() {
    const ids = [...selectedIds].filter((id) => staged[id] && !staged[id].isNew);
    const newIds = [...selectedIds].filter((id) => staged[id]?.isNew);
    const count = selectedIds.size;
    setConfirmDialog({
      title: `Delete ${count} account${count !== 1 ? "s" : ""}?`,
      message: `${ids.length} will be staged for deletion and removed on Save. ${newIds.length > 0 ? `${newIds.length} unsaved new row${newIds.length !== 1 ? "s" : ""} will be discarded immediately.` : ""}`.trim(),
      onConfirm: () => {
        pushUndo();
        for (const id of selectedIds) stageDelete("accounts", id);
        clearSelection();
      },
    });
  }

  function handleBulkClose() {
    pushUndo();
    for (const id of selectedIds) {
      if (staged[id] && !staged[id].isDeleted) stageUpdate("accounts", id, { closed: true });
    }
  }

  function handleBulkReopen() {
    pushUndo();
    for (const id of selectedIds) {
      if (staged[id] && !staged[id].isDeleted) stageUpdate("accounts", id, { closed: false });
    }
  }

  function handleFillDown() {
    if (!selectedCell || selectedIds.size < 2) return;
    const colId = selectedCell.colId;
    const selectedInOrder = rows.filter((r) => selectedIds.has(r.entity.id));
    if (selectedInOrder.length < 2) return;
    const source = selectedInOrder[0];
    pushUndo();
    for (const row of selectedInOrder.slice(1)) {
      if (row.isDeleted) continue;
      if (colId === "name") stageUpdate("accounts", row.entity.id, { name: source.entity.name });
      else if (colId === "offBudget") stageUpdate("accounts", row.entity.id, { offBudget: source.entity.offBudget });
    }
  }

  // ── Paste from Excel / Sheets ─────────────────────────────────────────────────
  function handlePaste(e: React.ClipboardEvent<HTMLDivElement>) {
    if (editingCell) return; // let the input field handle it
    const text = e.clipboardData.getData("text/plain");
    if (!text.trim()) return;

    const pastedRows = text
      .split(/\r?\n/)
      .filter((l) => l.trim() !== "")
      .map((l) => l.split("\t"));
    if (pastedRows.length === 0) return;

    const startIdx = selectedCell
      ? rows.findIndex((r) => r.entity.id === selectedCell.rowId)
      : 0;
    if (startIdx === -1) return;

    e.preventDefault();
    pushUndo();

    for (let i = 0; i < pastedRows.length; i++) {
      const cols = pastedRows[i];
      const targetIdx = startIdx + i;

      if (targetIdx < rows.length) {
        const target = rows[targetIdx];
        if (target.isDeleted) continue;
        const patch: Partial<Account> = {};
        const name = cols[0]?.trim() ?? "";
        if (name) patch.name = name;
        if (cols[1] !== undefined) {
          const v = cols[1].trim().toLowerCase();
          patch.offBudget = v === "true" || v === "1" || v === "yes" || v === "off budget" || v === "off";
        }
        if (Object.keys(patch).length > 0) stageUpdate("accounts", target.entity.id, patch);
      } else if (!search) {
        const name = cols[0]?.trim() ?? "";
        if (!name) continue;
        const v = cols[1]?.trim().toLowerCase() ?? "";
        stageNew("accounts", {
          id: generateId(),
          name,
          offBudget: v === "true" || v === "1" || v === "yes" || v === "off budget" || v === "off",
          closed: false,
        });
      }
    }
  }

  // ── Keyboard handler ─────────────────────────────────────────────────────────
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
        if (selectedCell.colId === "name" && !row.isDeleted) startEditing(selectedCell.rowId, "name");
        break;
      case " ":
        if (selectedCell.colId === "offBudget" && !row.isDeleted) {
          e.preventDefault();
          pushUndo();
          stageUpdate("accounts", row.entity.id, { offBudget: !row.entity.offBudget });
        }
        break;
      default:
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && selectedCell.colId === "name" && !row.isDeleted) {
          startEditing(selectedCell.rowId, "name", e.key);
        }
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────────
  const totalCount = Object.keys(staged).length;
  const canFillDown = selectedIds.size >= 2 && selectedCell !== null;
  const activeSelectedCount = [...selectedIds].filter((id) => staged[id] && !staged[id].isDeleted).length;

  return (
    <>
      <div ref={containerRef} className="flex flex-col outline-none" onKeyDown={handleKeyDown} onPaste={handlePaste} tabIndex={-1}>
        <FilterBar
          search={search} onSearchChange={setSearch}
          statusFilter={statusFilter} onStatusChange={setStatusFilter}
          budgetFilter={budgetFilter} onBudgetChange={setBudgetFilter}
          filteredCount={rows.length} totalCount={totalCount}
          selectedCount={activeSelectedCount} canFillDown={canFillDown}
          onFillDown={handleFillDown}
          onBulkClose={handleBulkClose}
          onBulkReopen={handleBulkReopen}
          onBulkDelete={handleBulkDelete}
          onDeselect={() => clearSelection()}
        />

        {rows.length === 0 ? (
          <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
            {search || statusFilter !== "all" || budgetFilter !== "all"
              ? "No accounts match the current filters."
              : "No accounts yet."}
          </div>
        ) : (
          <table className="w-full border-collapse text-sm">
              <thead className="sticky top-0 z-10 bg-background">
                <tr className="border-b border-border">
                  {/* Select all */}
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

                  <th
                    className="cursor-pointer select-none px-2 py-1.5 text-left hover:bg-muted/30"
                    onClick={() => toggleSort("name")}
                  >
                    <span className="flex items-center text-xs font-medium text-muted-foreground">
                      Account Name
                      <SortIndicator col="name" sortCol={sortCol} sortDir={sortDir} />
                    </span>
                  </th>

                  <th
                    className="w-32 cursor-pointer select-none px-2 py-1.5 text-left hover:bg-muted/30"
                    onClick={() => toggleSort("offBudget")}
                  >
                    <span className="flex items-center text-xs font-medium text-muted-foreground">
                      Budget
                      <SortIndicator col="offBudget" sortCol={sortCol} sortDir={sortDir} />
                    </span>
                  </th>

                  <th
                    className="w-24 cursor-pointer select-none px-2 py-1.5 text-left hover:bg-muted/30"
                    onClick={() => toggleSort("closed")}
                  >
                    <span className="flex items-center text-xs font-medium text-muted-foreground">
                      Status
                      <SortIndicator col="closed" sortCol={sortCol} sortDir={sortDir} />
                    </span>
                  </th>

                  <th className="w-24 p-0" />
                </tr>
              </thead>

              <tbody>
                {rows.map((row) => {
                  const { entity, isNew, isUpdated, isDeleted, saveError } = row;
                  const isDuplicate = !isDeleted && duplicateNames.has(entity.name.trim().toLowerCase());
                  const nameSelected   = selectedCell?.rowId === entity.id && selectedCell?.colId === "name";
                  const budgetSelected = selectedCell?.rowId === entity.id && selectedCell?.colId === "offBudget";
                  const nameEditing    = editingCell?.rowId  === entity.id && editingCell?.colId  === "name";
                  const isRowSelected  = selectedIds.has(entity.id);

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
                        <input
                          type="checkbox"
                          checked={isRowSelected}
                          onChange={(e) => toggleSelectRow(entity.id, e.target.checked)}
                          onClick={(e) => e.stopPropagation()}
                          className="h-3.5 w-3.5 cursor-pointer rounded accent-primary"
                        />
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

                      {/* Name */}
                      <td
                        data-cell={`${entity.id}:name`}
                        tabIndex={nameSelected ? 0 : -1}
                        className={cn(
                          "cursor-default px-2 py-0.5 outline-none",
                          nameSelected && !nameEditing && "bg-primary/10 ring-1 ring-inset ring-primary/50",
                          nameEditing && "ring-1 ring-inset ring-primary",
                        )}
                        onClick={() => nameSelected && !isDeleted ? startEditing(entity.id, "name") : selectCell(entity.id, "name")}
                        onFocus={() => { if (!editingCell) selectCell(entity.id, "name"); }}
                      >
                        {nameEditing ? (
                          <NameInput
                            initialValue={entity.name}
                            startChar={editStartChar}
                            onDone={(val, action) => handleNameDone(entity.id, val, action)}
                          />
                        ) : (
                          <div className="flex flex-col">
                            <span className={cn(
                              "flex items-center gap-1 leading-6",
                              isDeleted && "line-through",
                              !entity.name && "text-xs italic text-muted-foreground/60",
                            )}>
                              {entity.name || "empty name"}
                              {isDuplicate && (
                                <AlertTriangle className="h-3 w-3 shrink-0 text-amber-500" aria-label="Duplicate name" />
                              )}
                            </span>
                            {saveError && (
                              <span className="text-xs text-destructive leading-tight pb-0.5">
                                {saveError}
                              </span>
                            )}
                          </div>
                        )}
                      </td>

                      {/* Budget toggle */}
                      <td
                        data-cell={`${entity.id}:offBudget`}
                        tabIndex={budgetSelected ? 0 : -1}
                        className={cn(
                          "w-32 cursor-default px-2 py-0.5 outline-none",
                          budgetSelected && "bg-primary/10 ring-1 ring-inset ring-primary/50",
                        )}
                        onClick={() => {
                          if (budgetSelected && !isDeleted) {
                            pushUndo();
                            stageUpdate("accounts", entity.id, { offBudget: !entity.offBudget });
                          } else {
                            selectCell(entity.id, "offBudget");
                          }
                        }}
                        onFocus={() => { if (!editingCell) selectCell(entity.id, "offBudget"); }}
                      >
                        <Badge variant={entity.offBudget ? "secondary" : "default"} className="text-xs font-normal">
                          {entity.offBudget ? "Off Budget" : "On Budget"}
                        </Badge>
                      </td>

                      {/* Status */}
                      <td className="w-24 px-2 py-0.5">
                        <Badge variant={entity.closed ? "status-inactive" : "status-active"} className="text-xs font-normal">
                          {entity.closed ? "Closed" : "Open"}
                        </Badge>
                      </td>

                      {/* Row actions */}
                      <td className="w-24 px-1 py-0.5">
                        <div className="flex items-center justify-end gap-0.5 opacity-0 transition-opacity group-hover/row:opacity-100">
                          {saveError ? (
                            <Button
                              variant="ghost" size="icon-xs"
                              title="Clear error and retry"
                              onClick={() => clearSaveError("accounts", entity.id)}
                            >
                              <RefreshCw />
                            </Button>
                          ) : isDeleted ? (
                            <Button variant="ghost" size="icon-xs" title="Undo delete" onClick={() => revertEntity("accounts", entity.id)}>
                              <RotateCcw />
                            </Button>
                          ) : (
                            <>
                              <Button variant="ghost" size="icon-xs" title={entity.closed ? "Reopen" : "Close"}
                                onClick={() => { pushUndo(); stageUpdate("accounts", entity.id, { closed: !entity.closed }); }}>
                                {entity.closed ? <ArchiveRestore /> : <Archive />}
                              </Button>
                              <Button variant="ghost" size="icon-xs" title="Delete"
                                className="text-destructive hover:text-destructive"
                                onClick={() => { pushUndo(); stageDelete("accounts", entity.id); }}>
                                <Trash2 />
                              </Button>
                              {(isNew || isUpdated) && (
                                <Button variant="ghost" size="icon-xs" title="Revert" onClick={() => revertEntity("accounts", entity.id)}>
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

        <BulkAddBar bulkCount={bulkCount} onBulkCountChange={setBulkCount} onAdd={(n) => addRows(n, true)} />
      </div>

      {/* Confirm dialog */}
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
