"use client";

import { useState, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useHighlight } from "@/hooks/useHighlight";
import { useEditableGrid } from "@/hooks/useEditableGrid";
import { useNotesIndex } from "@/hooks/useNotesIndex";
import { useTableSelection } from "@/hooks/useTableSelection";
import type { DoneAction } from "@/components/ui/editable-cell";
import { ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";
import { TableBulkAddBar } from "@/components/ui/table-bulk-add-bar";
import { useStagedStore } from "@/store/staged";
import { generateId } from "@/lib/uuid";
import { useAccountBalances } from "../hooks/useAccountBalances";
import { buildRuleReferenceMap } from "@/lib/referenceCheck";
import { FilterBar } from "./FilterBar";
import { AccountsTableRow } from "./AccountsTableRow";
import type { AccountDeleteIntent } from "./AccountsTableOverlays";
import type { StatusFilter, BudgetFilter, RulesFilter } from "./FilterBar";
import type { StagedEntity } from "@/types/staged";
import type { Account } from "@/types/entities";

// ─── Types ─────────────────────────────────────────────────────────────────────

const NAVIGABLE_COLS = ["name"] as const;
type NavigableCol = (typeof NAVIGABLE_COLS)[number];
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
  onDeleteIntentChange,
  onInspectIdChange,
}: {
  onCreateRule?: (accountId: string, accountName: string) => void;
  onDeleteIntentChange: (intent: AccountDeleteIntent | null) => void;
  onInspectIdChange: (id: string | null) => void;
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
  const [bulkCount, setBulkCount] = useState(5);

  // ── Multi-select state ───────────────────────────────────────────────────────
  const { selectedIds, toggleSelect: toggleSelectRow, toggleSelectAll: _toggleSelectAll, clearSelection } = useTableSelection();

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
  const { data: notesIndex } = useNotesIndex();

  const accountIdsWithNotes = useMemo(
    () => new Set(notesIndex?.accountIdsWithNotes ?? []),
    [notesIndex]
  );

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
    canEditCell: (cell) => !staged[cell.rowId]?.isDeleted,
    onAddRowAtEnd: search ? undefined : () => addRows(1, true),
  });

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

  function handleNameDone(rowId: string, value: string, action: DoneAction) {
    if (action !== "cancel" && value !== staged[rowId]?.entity.name) {
      pushUndo();
      stageUpdate("accounts", rowId, { name: value });
    }
    commitCell(rowId, "name");
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
    onDeleteIntentChange({
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
    onDeleteIntentChange({
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

    let targetIdx = startIdx;
    for (const cols of pastedRows) {

      while (targetIdx < rows.length && rows[targetIdx]?.isDeleted) {
        targetIdx++;
      }

      if (targetIdx < rows.length) {
        const target = rows[targetIdx];
        const patch: Partial<Account> = {};
        const name = cols[0]?.trim() ?? "";
        if (name) patch.name = name;
        if (cols[1] !== undefined) {
          const v = cols[1].trim().toLowerCase();
          patch.offBudget = v === "true" || v === "1" || v === "yes" || v === "off budget" || v === "off";
        }
        if (Object.keys(patch).length > 0) stageUpdate("accounts", target.entity.id, patch);
        targetIdx++;
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

  function handleOpenRules(accountId: string, accountName: string, ruleCount: number) {
    if (ruleCount > 0) {
      router.push(`/rules?accountId=${accountId}`);
      return;
    }

    if (onCreateRule) {
      onCreateRule(accountId, accountName);
      return;
    }

    router.push("/rules?new=1");
  }

  function handleToggleNewBudgetType(accountId: string, nextOffBudget: boolean) {
    pushUndo();
    stageUpdate("accounts", accountId, { offBudget: nextOffBudget });
  }

  function handleReopen(accountId: string) {
    pushUndo();
    stageUpdate("accounts", accountId, { closed: false });
  }

  function handleRequestClose(entity: Account, balance: number, isNew: boolean) {
    onDeleteIntentChange({
      kind: "close",
      ids: isNew ? [] : [entity.id],
      title: "Close account?",
      label: entity.name || "Unnamed",
      balance,
      onConfirm: () => {
        pushUndo();
        stageUpdate("accounts", entity.id, { closed: true });
      },
    });
  }

  function handleRequestDelete(entity: Account, balance: number, ruleCount: number, isNew: boolean) {
    onDeleteIntentChange({
      kind: "delete",
      ids: isNew ? [] : [entity.id],
      title: "Delete account?",
      label: entity.name || "Unnamed",
      balance,
      ruleCount,
      onConfirm: () => {
        pushUndo();
        stageDelete("accounts", entity.id);
      },
    });
  }

  // ── Stable row callbacks ─────────────────────────────────────────────────────
  const handleSelectNameCell = useCallback((id: string) => selectCell(id, "name"), [selectCell]);
  const handleStartEditingName = useCallback((id: string) => startEditing(id, "name"), [startEditing]);
  const handleClearSaveError = useCallback((id: string) => clearSaveError("accounts", id), [clearSaveError]);
  const handleRevert = useCallback((id: string) => revertEntity("accounts", id), [revertEntity]);

  // ── Render ───────────────────────────────────────────────────────────────────
  const totalCount = Object.keys(staged).length;
  const activeSelectedCount = [...selectedIds].filter((id) => staged[id] && !staged[id].isDeleted).length;

  return (
    <>
      <div ref={containerRef} className="flex min-h-0 flex-1 flex-col overflow-hidden outline-none" onKeyDown={handleGridKeyDown} onPaste={handlePaste} tabIndex={-1}>
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

                  <th className="w-8 p-0">
                    <span className="sr-only">Notes</span>
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
                  const { entity, isDeleted } = row;
                  const isNameEditing = editingCell?.rowId === entity.id && editingCell.colId === "name";
                  return (
                    <AccountsTableRow
                      key={entity.id}
                      row={row}
                      highlightedId={highlightedId}
                      isRowSelected={selectedIds.has(entity.id)}
                      isNameSelected={selectedCell?.rowId === entity.id && selectedCell.colId === "name"}
                      isNameEditing={isNameEditing}
                      editStartChar={isNameEditing ? editStartChar : undefined}
                      isDuplicate={!isDeleted && duplicateNames.has(entity.name.trim().toLowerCase())}
                      hasNote={!row.isNew && accountIdsWithNotes.has(entity.id)}
                      balance={balances?.get(entity.id)}
                      ruleCount={accountRuleCount.get(entity.id) ?? 0}
                      onToggleSelect={toggleSelectRow}
                      onSelectNameCell={handleSelectNameCell}
                      onStartEditingName={handleStartEditingName}
                      onDoneName={handleNameDone}
                      onToggleNewBudgetType={handleToggleNewBudgetType}
                      onOpenRules={handleOpenRules}
                      onClearSaveError={handleClearSaveError}
                      onRevert={handleRevert}
                      onRequestClose={handleRequestClose}
                      onReopen={handleReopen}
                      onRequestDelete={handleRequestDelete}
                      onInspect={onInspectIdChange}
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
