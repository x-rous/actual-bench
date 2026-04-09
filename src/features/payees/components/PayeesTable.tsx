"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useHighlight } from "@/hooks/useHighlight";
import { useInlineEdit } from "@/hooks/useInlineEdit";
import { useTableSelection } from "@/hooks/useTableSelection";
import { NameInput } from "@/components/ui/editable-cell";
import type { DoneAction } from "@/components/ui/editable-cell";
import {
  RotateCcw, Trash2, RefreshCw,
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
import type { StagedEntity } from "@/types/staged";
import type { Payee } from "@/types/entities";
import { FilterBar } from "./FilterBar";
import type { TypeFilter, RulesFilter, SortCol, SortDir } from "./FilterBar";

// ─── Types ─────────────────────────────────────────────────────────────────────

const NAVIGABLE_COLS = ["name"] as const;
type NavigableCol = (typeof NAVIGABLE_COLS)[number];
type CellId = { rowId: string; colId: NavigableCol };
type PayeeRow = StagedEntity<Payee>;
type ConfirmState = { title: string; message: string; onConfirm: () => void };
type MergeCandidate = { id: string; name: string };
type MergeState = { candidates: MergeCandidate[]; targetId: string };

// ─── Sort helpers ──────────────────────────────────────────────────────────────

function SortIndicator({ col, sortCol, sortDir }: { col: SortCol; sortCol: SortCol | null; sortDir: SortDir }) {
  if (sortCol !== col) return <ArrowUpDown className="ml-1 inline h-3 w-3 opacity-30" />;
  return sortDir === "asc"
    ? <ArrowUp className="ml-1 inline h-3 w-3" />
    : <ArrowDown className="ml-1 inline h-3 w-3" />;
}

// ─── BulkAddBar ────────────────────────────────────────────────────────────────

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

// ─── PayeesTable ───────────────────────────────────────────────────────────────

export function PayeesTable({ onCreateRule }: {
  onCreateRule?: (payeeId: string, payeeName: string) => void;
}) {
  // ── Filter / sort state ──────────────────────────────────────────────────────
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [rulesFilter, setRulesFilter] = useState<RulesFilter>("all");
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

  const [mergeDialog, setMergeDialog] = useState<MergeState | null>(null);

  const containerRef  = useRef<HTMLDivElement>(null);
  const router        = useRouter();
  const highlightedId = useHighlight();

  // ── Store subscriptions ──────────────────────────────────────────────────────
  const staged = useStagedStore((s) => s.payees);
  const stagedRules = useStagedStore((s) => s.rules);
  const stageNew = useStagedStore((s) => s.stageNew);
  const stageUpdate = useStagedStore((s) => s.stageUpdate);
  const stageDelete = useStagedStore((s) => s.stageDelete);
  const revertEntity = useStagedStore((s) => s.revertEntity);
  const clearSaveError = useStagedStore((s) => s.clearSaveError);
  const pushUndo = useStagedStore((s) => s.pushUndo);
  const stagePayeeMerge = useStagedStore((s) => s.stagePayeeMerge);

  // ── Rules reference count per payee ──────────────────────────────────────────
  const payeeRuleCount = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of Object.values(stagedRules)) {
      if (s.isDeleted) continue;
      for (const part of [...s.entity.conditions, ...s.entity.actions]) {
        if (part.field === "payee" || part.field === "imported_payee") {
          const ids = Array.isArray(part.value) ? part.value : [part.value];
          for (const id of ids) {
            if (typeof id === "string" && id) {
              counts.set(id, (counts.get(id) ?? 0) + 1);
            }
          }
        }
      }
    }
    return counts;
  }, [stagedRules]);

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
  // baseRows excludes the rules filter so that rules mutations don't invalidate
  // the sort/search/type-filter work when rulesFilter is "all" (the default).
  const baseRows: PayeeRow[] = useMemo(() => {
    const q = search.toLowerCase();
    const result: PayeeRow[] = [];
    for (const r of Object.values(staged) as PayeeRow[]) {
      if (q && !r.entity.name.toLowerCase().includes(q)) continue;
      if (typeFilter === "regular"  && r.entity.transferAccountId)  continue;
      if (typeFilter === "transfer" && !r.entity.transferAccountId) continue;
      result.push(r);
    }
    result.sort((a, b) => {
      // New (unsaved) rows always float to the top so they're immediately visible
      if (a.isNew !== b.isNew) return a.isNew ? -1 : 1;
      if (!sortCol) return 0;
      let av: string | boolean, bv: string | boolean;
      if (sortCol === "name") {
        av = a.entity.name.toLowerCase();
        bv = b.entity.name.toLowerCase();
      } else {
        // type: transfer payees sort as "true" (1), regular as "false" (0)
        av = !!a.entity.transferAccountId;
        bv = !!b.entity.transferAccountId;
      }
      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
    return result;
  }, [staged, search, typeFilter, sortCol, sortDir]);

  // Apply the rules filter as a second step so it only invalidates when
  // rulesFilter is active or payeeRuleCount changes.
  const rows: PayeeRow[] = useMemo(() => {
    if (rulesFilter === "all") return baseRows;
    return baseRows.filter((r) => {
      const rc = payeeRuleCount.get(r.entity.id) ?? 0;
      if (rulesFilter === "with_rules" && rc === 0) return false;
      if (rulesFilter === "no_rules"   && rc  >  0) return false;
      return true;
    });
  }, [baseRows, rulesFilter, payeeRuleCount]);

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
  // Only regular payees can be selected (transfer payees are system-managed)
  const selectableRows = useMemo(() => rows.filter((r) => !r.entity.transferAccountId), [rows]);
  const visibleSelectableIds = useMemo(() => new Set(selectableRows.map((r) => r.entity.id)), [selectableRows]);
  const allVisibleSelected = selectableRows.length > 0 && selectableRows.every((r) => selectedIds.has(r.entity.id));
  const someVisibleSelected = selectableRows.some((r) => selectedIds.has(r.entity.id));

  function toggleSelectAll() {
    _toggleSelectAll(visibleSelectableIds, allVisibleSelected);
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
    if (action !== "cancel") {
      const trimmed = value.trim();
      if (trimmed !== staged[rowId]?.entity.name) {
        pushUndo();
        stageUpdate("payees", rowId, { name: trimmed });
      }
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
    stageNew("payees", { id: firstId, name: "" });
    for (let i = 1; i < count; i++) {
      stageNew("payees", { id: generateId(), name: "" });
    }
    if (focusFirst) setTimeout(() => startEditing(firstId, "name"), 0);
  }

  // ── Bulk actions ─────────────────────────────────────────────────────────────
  function handleBulkDelete() {
    // Only delete regular payees (transfer payees are system-managed)
    const deletableIds = [...selectedIds].filter(
      (id) => staged[id] && !staged[id].entity.transferAccountId
    );
    const skipped = selectedIds.size - deletableIds.length;
    const newIds = deletableIds.filter((id) => staged[id]?.isNew);
    const serverIds = deletableIds.filter((id) => !staged[id]?.isNew);
    const count = deletableIds.length;

    if (count === 0) {
      clearSelection();
      return;
    }

    const referencedRules = deletableIds.reduce((sum, id) => sum + (payeeRuleCount.get(id) ?? 0), 0);

    let message = `${serverIds.length} will be staged for deletion and removed on Save.`;
    if (newIds.length > 0) {
      message += ` ${newIds.length} unsaved new row${newIds.length !== 1 ? "s" : ""} will be discarded immediately.`;
    }
    if (skipped > 0) {
      message += ` ${skipped} transfer payee${skipped !== 1 ? "s" : ""} skipped (system-managed).`;
    }
    if (referencedRules > 0) {
      message += ` Warning: ${referencedRules} rule reference${referencedRules !== 1 ? "s" : ""} will be affected.`;
    }

    setConfirmDialog({
      title: `Delete ${count} payee${count !== 1 ? "s" : ""}?`,
      message: message.trim(),
      onConfirm: () => {
        pushUndo();
        for (const id of deletableIds) stageDelete("payees", id);
        clearSelection();
      },
    });
  }

  function handleMerge() {
    // Iterate selectedIds in insertion order (click order) — first-clicked payee
    // is pre-selected as the target; the user can override in the dialog.
    const selectedRegular = [...selectedIds]
      .map((id) => staged[id])
      .filter((s): s is NonNullable<typeof s> =>
        !!s && !s.isDeleted && !s.isNew && !s.entity.transferAccountId
      );
    if (selectedRegular.length < 2) return;
    setMergeDialog({
      candidates: selectedRegular.map((r) => ({ id: r.entity.id, name: r.entity.name })),
      targetId:   selectedRegular[0].entity.id,
    });
  }

  function confirmMerge(state: MergeState) {
    const mergeIds = state.candidates.filter((c) => c.id !== state.targetId).map((c) => c.id);
    pushUndo();
    stagePayeeMerge(state.targetId, mergeIds);
    clearSelection();
    setMergeDialog(null);
  }

  // ── Paste from Excel / Sheets ─────────────────────────────────────────────────
  function handlePaste(e: React.ClipboardEvent<HTMLDivElement>) {
    if (editingCell) return;
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
      const name = cols[0]?.trim() ?? "";

      if (targetIdx < rows.length) {
        const target = rows[targetIdx];
        if (target.isDeleted || target.entity.transferAccountId) continue;
        if (name) stageUpdate("payees", target.entity.id, { name });
      } else if (!search) {
        if (!name) continue;
        stageNew("payees", { id: generateId(), name });
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
        if (!row.isDeleted && !row.entity.transferAccountId) startEditing(selectedCell.rowId, "name");
        break;
      default:
        if (
          e.key.length === 1 && !e.ctrlKey && !e.metaKey &&
          selectedCell.colId === "name" &&
          !row.isDeleted && !row.entity.transferAccountId
        ) {
          startEditing(selectedCell.rowId, "name", e.key);
        }
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────────
  const totalCount = Object.keys(staged).length;
  const activeSelectedCount = [...selectedIds].filter((id) => staged[id] && !staged[id].isDeleted).length;
  // Merge requires 2+ non-deleted regular (non-transfer) payees selected
  const mergeableCount = [...selectedIds].filter(
    (id) => staged[id] && !staged[id].isDeleted && !staged[id].entity.transferAccountId && !staged[id].isNew
  ).length;
  const canMerge = mergeableCount >= 2;

  return (
    <>
      <div ref={containerRef} className="flex min-h-0 flex-1 flex-col overflow-hidden outline-none" onKeyDown={handleKeyDown} onPaste={handlePaste} tabIndex={-1}>
        <FilterBar
          search={search} onSearchChange={setSearch}
          typeFilter={typeFilter} onTypeChange={setTypeFilter}
          rulesFilter={rulesFilter} onRulesFilterChange={setRulesFilter}
          filteredCount={rows.length} totalCount={totalCount}
          selectedCount={activeSelectedCount} canMerge={canMerge}
          onMerge={handleMerge}
          onBulkDelete={handleBulkDelete}
          onDeselect={() => clearSelection()}
        />

        <div className="min-h-0 flex-1 overflow-auto">
        {rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
            <span>{search || typeFilter !== "all" || rulesFilter !== "all" ? "No payees match the current filters." : "No payees yet."}</span>
            {(search || typeFilter !== "all" || rulesFilter !== "all") && (
              <button
                className="text-xs underline hover:text-foreground"
                onClick={() => { setSearch(""); setTypeFilter("all"); setRulesFilter("all"); }}
              >
                Clear filters
              </button>
            )}
          </div>
        ) : (
          <table className="w-full border-collapse text-sm">
              <thead className="sticky top-0 z-10 bg-background">
                <tr className="border-b border-border">
                  {/* Select all (only selectable/regular rows) */}
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
                      Payee Name
                      <SortIndicator col="name" sortCol={sortCol} sortDir={sortDir} />
                    </span>
                  </th>

                  <th
                    className="w-28 cursor-pointer select-none px-2 py-1.5 text-left hover:bg-muted/30"
                    onClick={() => toggleSort("type")}
                  >
                    <span className="flex items-center text-xs font-medium text-muted-foreground">
                      Type
                      <SortIndicator col="type" sortCol={sortCol} sortDir={sortDir} />
                    </span>
                  </th>

                  <th className="w-44 px-2 py-1.5 text-left text-xs font-medium text-muted-foreground">
                    Rules
                  </th>

                  <th className="w-24 p-0" />
                </tr>
              </thead>

              <tbody>
                {rows.map((row) => {
                  const { entity, isNew, isUpdated, isDeleted, saveError } = row;
                  const isTransfer = !!entity.transferAccountId;
                  const isDuplicate = !isDeleted && duplicateNames.has(entity.name.trim().toLowerCase());
                  const nameSelected = selectedCell?.rowId === entity.id && selectedCell?.colId === "name";
                  const nameEditing  = editingCell?.rowId  === entity.id && editingCell?.colId  === "name";
                  const isRowSelected = !isTransfer && selectedIds.has(entity.id);

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
                      {/* Checkbox — transfer payees are not selectable */}
                      <td className="w-9 px-3 py-0.5">
                        {!isTransfer && (
                          <input
                            type="checkbox"
                            checked={isRowSelected}
                            onChange={(e) => toggleSelectRow(entity.id, e.target.checked)}
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

                      {/* Name */}
                      <td
                        data-cell={`${entity.id}:name`}
                        tabIndex={nameSelected ? 0 : -1}
                        className={cn(
                          "cursor-default px-2 py-0.5 outline-none",
                          nameSelected && !nameEditing && "bg-primary/10 ring-1 ring-inset ring-primary/50",
                          nameEditing && "ring-1 ring-inset ring-primary",
                          isTransfer && "cursor-default",
                        )}
                        onClick={() => {
                          if (nameSelected && !isDeleted && !isTransfer) {
                            startEditing(entity.id, "name");
                          } else {
                            selectCell(entity.id, "name");
                          }
                        }}
                        onFocus={() => { if (!editingCell) selectCell(entity.id, "name"); }}
                      >
                        {nameEditing && !isTransfer ? (
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

                      {/* Type */}
                      <td className="w-28 px-2 py-0.5">
                        <Badge
                          variant={isTransfer ? "secondary" : "outline"}
                          className="text-xs font-normal"
                        >
                          {isTransfer ? "Transfer" : "Regular"}
                        </Badge>
                      </td>

                      {/* Rules count */}
                      <td className="w-44 px-2 py-0.5">
                        {(() => {
                          const count = payeeRuleCount.get(entity.id) ?? 0;
                          const label = count === 0
                            ? "create rule"
                            : count === 1
                              ? "1 associated rule"
                              : `${count} associated rules`;
                          return !isDeleted
                            ? (
                              <button
                                className="inline-flex items-center rounded bg-purple-100 px-1.5 py-0.5 text-xs font-medium text-purple-700 hover:bg-purple-200 dark:bg-purple-900/40 dark:text-purple-300 dark:hover:bg-purple-900/60"
                                onClick={() => count > 0
                                  ? router.push(`/rules?payeeId=${entity.id}`)
                                  : onCreateRule ? onCreateRule(entity.id, entity.name) : router.push("/rules?new=1")}
                                title={count > 0 ? "View rules for this payee" : "Create a rule for this payee"}
                              >
                                {label}
                              </button>
                            )
                            : null;
                        })()}
                      </td>

                      {/* Row actions */}
                      <td className="w-24 px-1 py-0.5">
                        <div className="flex items-center justify-end gap-0.5 opacity-0 transition-opacity group-hover/row:opacity-100">
                          {saveError ? (
                            <Button
                              variant="ghost" size="icon-xs"
                              title="Clear error and retry"
                              onClick={() => clearSaveError("payees", entity.id)}
                            >
                              <RefreshCw />
                            </Button>
                          ) : isDeleted ? (
                            <Button variant="ghost" size="icon-xs" title="Undo delete" onClick={() => revertEntity("payees", entity.id)}>
                              <RotateCcw />
                            </Button>
                          ) : isTransfer ? null : (
                            <>
                              <Button
                                variant="ghost" size="icon-xs" title="Delete"
                                className="text-destructive hover:text-destructive"
                                onClick={() => {
                                  const ruleCount = payeeRuleCount.get(entity.id) ?? 0;
                                  if (ruleCount > 0) {
                                    setConfirmDialog({
                                      title: `Delete "${entity.name}"?`,
                                      message: `This payee is referenced by ${ruleCount} rule${ruleCount !== 1 ? "s" : ""}. Deleting it may break those rules.`,
                                      onConfirm: () => { pushUndo(); stageDelete("payees", entity.id); },
                                    });
                                  } else {
                                    pushUndo();
                                    stageDelete("payees", entity.id);
                                  }
                                }}
                              >
                                <Trash2 />
                              </Button>
                              {(isNew || isUpdated) && (
                                <Button variant="ghost" size="icon-xs" title="Revert" onClick={() => revertEntity("payees", entity.id)}>
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

      {/* Merge dialog */}
      <Dialog open={mergeDialog !== null} onOpenChange={(open) => { if (!open) setMergeDialog(null); }}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Merge payees</DialogTitle>
            <DialogDescription>
              Select the payee to keep. The others will be merged into it and removed.
              All transactions and rules will be updated automatically.
              This change is staged and can be undone until you save.
            </DialogDescription>
          </DialogHeader>

          {mergeDialog && (
            <div className="flex flex-col gap-1 py-1">
              {mergeDialog.candidates.map((c, i) => {
                const isTarget = c.id === mergeDialog.targetId;
                return (
                  <label
                    key={c.id}
                    className={cn(
                      "flex cursor-pointer items-center gap-2.5 rounded-md border px-3 py-2 text-sm transition-colors",
                      isTarget
                        ? "border-primary bg-primary/5 font-medium"
                        : "border-border hover:bg-muted/40"
                    )}
                  >
                    <input
                      type="radio"
                      name="merge-target"
                      value={c.id}
                      checked={isTarget}
                      onChange={() => setMergeDialog({ ...mergeDialog, targetId: c.id })}
                      className="accent-primary"
                    />
                    <span className="flex-1 truncate">{c.name || <em className="text-muted-foreground">empty name</em>}</span>
                    {i === 0 && !isTarget && (
                      <span className="text-[10px] text-muted-foreground">first selected</span>
                    )}
                    {isTarget && (
                      <span className="text-[10px] font-medium text-primary">keep</span>
                    )}
                  </label>
                );
              })}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setMergeDialog(null)}>Cancel</Button>
            <Button
              variant="default"
              onClick={() => { if (mergeDialog) confirmMerge(mergeDialog); }}
            >
              Merge
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
