"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useHighlight } from "@/hooks/useHighlight";
import { useInlineEdit } from "@/hooks/useInlineEdit";
import { useTableSelection } from "@/hooks/useTableSelection";
import { useTransactionCountsForIds } from "@/hooks/useTransactionCountsForIds";
import { NameInput } from "@/components/ui/editable-cell";
import type { DoneAction } from "@/components/ui/editable-cell";
import {
  Archive, ArchiveRestore, RotateCcw, Trash2, RefreshCw,
  ArrowUpDown, ArrowUp, ArrowDown, AlertTriangle, Info,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { ConfirmState } from "@/components/ui/confirm-dialog";
import { cn } from "@/lib/utils";
import { useStagedStore } from "@/store/staged";
import { generateId } from "@/lib/uuid";
import { useAccountBalances } from "../hooks/useAccountBalances";
import { buildRuleReferenceMap } from "@/lib/referenceCheck";
import {
  buildAccountCloseWarning,
  buildAccountDeleteWarning,
  buildAccountBulkCloseWarning,
  buildAccountBulkDeleteWarning,
} from "@/lib/usageWarnings";
import { UsageInspectorDrawer } from "@/features/usage-inspector/components/UsageInspectorDrawer";
import { FilterBar } from "./FilterBar";
import { BulkAddBar } from "./BulkAddBar";
import type { StatusFilter, BudgetFilter, RulesFilter } from "./FilterBar";
import type { StagedEntity } from "@/types/staged";
import type { Account } from "@/types/entities";

// ─── Delete intent ────────────────────────────────────────────────────────────

type DeleteIntent = {
  /** Server-side IDs for $oneof tx-count query. */
  ids: string[];
  title: string;
  destructiveLabel?: string;
  onConfirm: () => void;
} & (
  | { kind: "close";      label: string; balance: number }
  | { kind: "delete";     label: string; balance: number; ruleCount: number }
  | { kind: "bulkClose";  count: number; nonZeroBalanceCount: number }
  | { kind: "bulkDelete"; serverCount: number; newCount: number; nonZeroBalanceCount: number; ruleCount: number }
);

// ─── Types ─────────────────────────────────────────────────────────────────────

const NAVIGABLE_COLS = ["name"] as const;
type NavigableCol = (typeof NAVIGABLE_COLS)[number];
type CellId = { rowId: string; colId: NavigableCol };
type AccountRow = StagedEntity<Account>;
type SortCol = "name" | "offBudget" | "closed";
type SortDir = "asc" | "desc";

// ─── Sort helpers ──────────────────────────────────────────────────────────────

function SortIndicator({ col, sortCol, sortDir }: { col: SortCol; sortCol: SortCol | null; sortDir: SortDir }) {
  if (sortCol !== col) return <ArrowUpDown className="ml-1 inline h-3 w-3 opacity-30" />;
  return sortDir === "asc"
    ? <ArrowUp className="ml-1 inline h-3 w-3" />
    : <ArrowDown className="ml-1 inline h-3 w-3" />;
}

// ─── AccountsTable ─────────────────────────────────────────────────────────────

export function AccountsTable({
  onCreateRule,
}: {
  onCreateRule?: (accountId: string, accountName: string) => void;
}) {
  const highlightedId = useHighlight();
  const router = useRouter();

  // ── Filter / sort state ──────────────────────────────────────────────────────
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [budgetFilter, setBudgetFilter] = useState<BudgetFilter>("all");
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
  const [deleteIntent, setDeleteIntent] = useState<DeleteIntent | null>(null);
  const [inspectId, setInspectId] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);

  // ── Store subscriptions ──────────────────────────────────────────────────────
  const staged = useStagedStore((s) => s.accounts);
  const stagedRules = useStagedStore((s) => s.rules);
  const stageNew = useStagedStore((s) => s.stageNew);
  const stageUpdate = useStagedStore((s) => s.stageUpdate);
  const stageDelete = useStagedStore((s) => s.stageDelete);
  const revertEntity = useStagedStore((s) => s.revertEntity);
  const clearSaveError = useStagedStore((s) => s.clearSaveError);
  const pushUndo = useStagedStore((s) => s.pushUndo);

  // ── Account balances ─────────────────────────────────────────────────────────
  const { data: balances } = useAccountBalances();

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

  // ── Account → rule count ─────────────────────────────────────────────────────
  const accountRuleCount = useMemo(
    () => buildRuleReferenceMap(stagedRules, ["account"]),
    [stagedRules]
  );

  // ── Lazy tx counts for delete/close confirm dialogs ───────────────────────────
  const { data: txCounts, isLoading: txLoading } = useTransactionCountsForIds(
    "account",
    deleteIntent?.ids ?? [],
    { enabled: !!deleteIntent && deleteIntent.ids.length > 0 }
  );

  const txTotal = deleteIntent?.ids.length
    ? (txCounts ? [...txCounts.values()].reduce((a, b) => a + b, 0) : undefined)
    : 0;

  const confirmState: ConfirmState | null = deleteIntent
    ? (() => {
        const loading = txLoading && deleteIntent.ids.length > 0;
        switch (deleteIntent.kind) {
          case "close":
            return {
              title: deleteIntent.title,
              message: buildAccountCloseWarning(deleteIntent.label, deleteIntent.balance, txTotal, loading),
              onConfirm: deleteIntent.onConfirm,
              destructiveLabel: "Close",
            };
          case "delete":
            return {
              title: deleteIntent.title,
              message: buildAccountDeleteWarning(deleteIntent.label, deleteIntent.balance, deleteIntent.ruleCount, txTotal, loading),
              onConfirm: deleteIntent.onConfirm,
            };
          case "bulkClose":
            return {
              title: deleteIntent.title,
              message: buildAccountBulkCloseWarning(deleteIntent.count, deleteIntent.nonZeroBalanceCount),
              onConfirm: deleteIntent.onConfirm,
              destructiveLabel: "Close All",
            };
          case "bulkDelete":
            return {
              title: deleteIntent.title,
              message: buildAccountBulkDeleteWarning(
                deleteIntent.serverCount,
                deleteIntent.newCount,
                deleteIntent.nonZeroBalanceCount,
                deleteIntent.ruleCount,
                txTotal,
                loading
              ),
              onConfirm: deleteIntent.onConfirm,
            };
        }
      })()
    : null;

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
      if (rulesFilter === "with_rules" && !(accountRuleCount.get(r.entity.id) ?? 0)) continue;
      if (rulesFilter === "no_rules"   &&  (accountRuleCount.get(r.entity.id) ?? 0)) continue;
      result.push(r);
    }

    // New (unsaved) rows always float to the top regardless of sort column.
    result.sort((a, b) => {
      if (a.isNew && !b.isNew) return -1;
      if (!a.isNew && b.isNew) return 1;
      if (!sortCol) return 0;
      let av: string | boolean, bv: string | boolean;
      if (sortCol === "name") { av = a.entity.name.toLowerCase(); bv = b.entity.name.toLowerCase(); }
      else if (sortCol === "offBudget") { av = a.entity.offBudget; bv = b.entity.offBudget; }
      else { av = a.entity.closed; bv = b.entity.closed; }
      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
    return result;
  }, [staged, search, statusFilter, budgetFilter, rulesFilter, accountRuleCount, sortCol, sortDir]);

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
    const activeSelection = [...selectedIds].filter(
      (id) => !staged[id]?.isDeleted
    );
    const serverIds = activeSelection.filter((id) => staged[id] && !staged[id].isNew);
    const newIds = activeSelection.filter((id) => staged[id]?.isNew);
    const nonZeroBalanceCount = serverIds.filter((id) => {
      const b = balances?.get(id);
      return b === undefined || Math.abs(b) > 0; // unknown balance treated conservatively as non-zero
    }).length;
    const totalRuleCount = activeSelection.reduce((sum, id) => sum + (accountRuleCount.get(id) ?? 0), 0);
    const count = activeSelection.length;
    const capturedIds = activeSelection;
    setDeleteIntent({
      kind: "bulkDelete",
      ids: serverIds,
      title: `Delete ${count} account${count !== 1 ? "s" : ""}?`,
      serverCount: serverIds.length,
      newCount: newIds.length,
      nonZeroBalanceCount,
      ruleCount: totalRuleCount,
      onConfirm: () => {
        pushUndo();
        for (const id of capturedIds) stageDelete("accounts", id);
        clearSelection();
      },
    });
  }

  function handleBulkClose() {
    const closeableIds = [...selectedIds].filter(
      (id) => staged[id] && !staged[id].isDeleted && !staged[id].entity.closed
    );
    const count = closeableIds.length;
    if (count === 0) return;
    const nonZeroBalanceCount = closeableIds.filter((id) => {
      const b = balances?.get(id);
      return b === undefined || Math.abs(b) > 0; // unknown balance treated conservatively as non-zero
    }).length;
    const capturedIds = [...closeableIds];
    setDeleteIntent({
      kind: "bulkClose",
      ids: [],
      title: `Close ${count} account${count !== 1 ? "s" : ""}?`,
      count,
      nonZeroBalanceCount,
      onConfirm: () => {
        pushUndo();
        for (const id of capturedIds) stageUpdate("accounts", id, { closed: true });
      },
    });
  }

  function handleBulkReopen() {
    pushUndo();
    for (const id of selectedIds) {
      if (staged[id] && !staged[id].isDeleted) stageUpdate("accounts", id, { closed: false });
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
      default:
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && selectedCell.colId === "name" && !row.isDeleted) {
          startEditing(selectedCell.rowId, "name", e.key);
        }
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────────
  const totalCount = Object.keys(staged).length;
  const activeSelectedCount = [...selectedIds].filter((id) => staged[id] && !staged[id].isDeleted).length;

  return (
    <>
      <div ref={containerRef} className="flex min-h-0 flex-1 flex-col overflow-hidden outline-none" onKeyDown={handleKeyDown} onPaste={handlePaste} tabIndex={-1}>
        <FilterBar
          search={search} onSearchChange={setSearch}
          statusFilter={statusFilter} onStatusChange={setStatusFilter}
          budgetFilter={budgetFilter} onBudgetChange={setBudgetFilter}
          rulesFilter={rulesFilter} onRulesFilterChange={setRulesFilter}
          filteredCount={rows.length} totalCount={totalCount}
          selectedCount={activeSelectedCount}
          onBulkClose={handleBulkClose}
          onBulkReopen={handleBulkReopen}
          onBulkDelete={handleBulkDelete}
          onDeselect={() => clearSelection()}
        />

        <div className="min-h-0 flex-1 overflow-auto">
        {rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
            <span>{search || statusFilter !== "all" || budgetFilter !== "all" || rulesFilter !== "all" ? "No accounts match the current filters." : "No accounts yet."}</span>
            {(search || statusFilter !== "all" || budgetFilter !== "all" || rulesFilter !== "all") && (
              <button
                className="text-xs underline hover:text-foreground"
                onClick={() => { setSearch(""); setStatusFilter("all"); setBudgetFilter("all"); setRulesFilter("all"); }}
              >
                Clear filters
              </button>
            )}
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

                  <th className="w-32 px-4 py-1.5 text-right">
                    <span className="text-xs font-medium text-muted-foreground">Balance</span>
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
                    className="w-32 cursor-pointer select-none px-2 py-1.5 text-left hover:bg-muted/30"
                    onClick={() => toggleSort("closed")}
                  >
                    <span className="flex items-center text-xs font-medium text-muted-foreground">
                      Status
                      <SortIndicator col="closed" sortCol={sortCol} sortDir={sortDir} />
                    </span>
                  </th>

                  <th className="w-40 px-2 py-1.5 text-left">
                    <span className="text-xs font-medium text-muted-foreground">Rules</span>
                  </th>

                  <th className="w-24 p-0" />
                </tr>
              </thead>

              <tbody>
                {rows.map((row) => {
                  const { entity, isNew, isUpdated, isDeleted, saveError } = row;
                  const isDuplicate = !isDeleted && duplicateNames.has(entity.name.trim().toLowerCase());
                  const nameSelected   = selectedCell?.rowId === entity.id && selectedCell?.colId === "name";
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

                      {/* Balance */}
                      <td className="w-32 px-4 py-0.5 text-right tabular-nums">
                        {(() => {
                          if (isNew) return <span className="text-xs text-muted-foreground/50">-</span>;
                          if (!balances) return <span className="text-xs text-muted-foreground/50">-</span>;
                          const bal = balances.get(entity.id);
                          if (bal === undefined) return <span className="text-xs text-muted-foreground/50">-</span>;
                          const formatted = bal.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                          return (
                            <span className={cn(
                              "text-xs",
                              bal < 0 && "text-destructive",
                              bal === 0 && "text-muted-foreground",
                            )}>
                              {formatted}
                            </span>
                          );
                        })()}
                      </td>

                      {/* Budget — badge for existing rows, toggle for new staged rows */}
                      <td className="w-40 px-2 py-0.5">
                        {!isNew ? (
                          <Badge variant={entity.offBudget ? "status-inactive" : "status-active"} className="text-xs font-normal">
                            {entity.offBudget ? "Off Budget" : "On Budget"}
                          </Badge>
                        ) : (
                          <button
                            disabled={isDeleted}
                            onClick={() => { pushUndo(); stageUpdate("accounts", entity.id, { offBudget: !entity.offBudget }); }}
                            className="inline-flex items-center gap-1.5 text-xs font-medium text-foreground hover:text-foreground/80 transition-colors"
                          >
                            <span className={cn(
                              "relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors",
                              entity.offBudget ? "bg-slate-400 dark:bg-slate-500" : "bg-emerald-500 dark:bg-emerald-600",
                            )}>
                              <span className={cn(
                                "inline-block h-3 w-3 rounded-full bg-white shadow transition-transform",
                                entity.offBudget ? "translate-x-0.5" : "translate-x-3.5",
                              )} />
                            </span>
                            {entity.offBudget ? "Off Budget" : "On Budget"}
                          </button>
                        )}
                      </td>

                      {/* Status */}
                      <td className="w-32 px-2 py-0.5">
                        <Badge variant={entity.closed ? "status-inactive" : "status-active"} className="text-xs font-normal">
                          {entity.closed ? "Closed" : "Open"}
                        </Badge>
                      </td>

                      {/* Rules */}
                      <td className="w-40 px-2 py-0.5">
                        {!isDeleted && (() => {
                          const count = accountRuleCount.get(entity.id) ?? 0;
                          const label = count === 0
                            ? "create rule"
                            : count === 1
                              ? "1 associated rule"
                              : `${count} associated rules`;
                          return (
                            <button
                              className="inline-flex items-center rounded bg-purple-100 px-1.5 py-0.5 text-xs font-medium text-purple-700 hover:bg-purple-200 dark:bg-purple-900/40 dark:text-purple-300 dark:hover:bg-purple-900/60"
                              onClick={() => count > 0
                                ? router.push(`/rules?accountId=${entity.id}`)
                                : onCreateRule ? onCreateRule(entity.id, entity.name) : router.push("/rules?new=1")}
                              title={count > 0 ? "View rules for this account" : "Create a rule for this account"}
                            >
                              {label}
                            </button>
                          );
                        })()}
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
                                onClick={() => {
                                  if (entity.closed) {
                                    pushUndo();
                                    stageUpdate("accounts", entity.id, { closed: false });
                                  } else {
                                    const balance = balances?.get(entity.id) ?? 0;
                                    setDeleteIntent({
                                      kind: "close",
                                      ids: isNew ? [] : [entity.id],
                                      title: "Close account?",
                                      label: entity.name || "Unnamed",
                                      balance,
                                      onConfirm: () => { pushUndo(); stageUpdate("accounts", entity.id, { closed: true }); },
                                    });
                                  }
                                }}>
                                {entity.closed ? <ArchiveRestore /> : <Archive />}
                              </Button>
                              <Button variant="ghost" size="icon-xs" title="Delete"
                                className="text-destructive hover:text-destructive"
                                onClick={() => {
                                  const balance = balances?.get(entity.id) ?? 0;
                                  const ruleCount = accountRuleCount.get(entity.id) ?? 0;
                                  setDeleteIntent({
                                    kind: "delete",
                                    ids: isNew ? [] : [entity.id],
                                    title: "Delete account?",
                                    label: entity.name || "Unnamed",
                                    balance,
                                    ruleCount,
                                    onConfirm: () => { pushUndo(); stageDelete("accounts", entity.id); },
                                  });
                                }}>
                                <Trash2 />
                              </Button>
                              <Button variant="ghost" size="icon-xs" title="Inspect usage" aria-label="Inspect usage"
                                onClick={() => setInspectId(entity.id)}>
                                <Info />
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
        </div>

        <BulkAddBar bulkCount={bulkCount} onBulkCountChange={setBulkCount} onAdd={(n) => addRows(n, true)} />
      </div>

      <ConfirmDialog
        open={!!deleteIntent}
        onOpenChange={(open) => { if (!open) setDeleteIntent(null); }}
        state={confirmState}
      />

      <UsageInspectorDrawer
        entityId={inspectId}
        entityType="account"
        open={!!inspectId}
        onOpenChange={(open) => { if (!open) setInspectId(null); }}
      />
    </>
  );
}
