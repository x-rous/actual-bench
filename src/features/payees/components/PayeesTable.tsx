"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useHighlight } from "@/hooks/useHighlight";
import { useEditableGrid } from "@/hooks/useEditableGrid";
import { useTableSelection } from "@/hooks/useTableSelection";
import type { DoneAction } from "@/components/ui/editable-cell";
import {
  ArrowUpDown, ArrowUp, ArrowDown,
} from "lucide-react";
import { TableBulkAddBar } from "@/components/ui/table-bulk-add-bar";
import { useStagedStore } from "@/store/staged";
import { generateId } from "@/lib/uuid";
import { buildRuleReferenceMap } from "@/lib/referenceCheck";
import type { StagedEntity } from "@/types/staged";
import type { Payee } from "@/types/entities";
import { FilterBar } from "./FilterBar";
import { PayeesTableRow } from "./PayeesTableRow";
import type { PayeeDeleteIntent } from "./PayeesTableOverlays";
import type { PayeeMergeState } from "./PayeesMergeDialog";
import type { TypeFilter, RulesFilter, SortCol, SortDir } from "./FilterBar";

// ─── Types ─────────────────────────────────────────────────────────────────────

const NAVIGABLE_COLS = ["name"] as const;
type NavigableCol = (typeof NAVIGABLE_COLS)[number];
type PayeeRow = StagedEntity<Payee>;

// ─── Sort helpers ──────────────────────────────────────────────────────────────

function SortIndicator({ col, sortCol, sortDir }: { col: SortCol; sortCol: SortCol | null; sortDir: SortDir }) {
  if (sortCol !== col) return <ArrowUpDown className="ml-1 inline h-3 w-3 opacity-30" />;
  return sortDir === "asc"
    ? <ArrowUp className="ml-1 inline h-3 w-3" />
    : <ArrowDown className="ml-1 inline h-3 w-3" />;
}

// ─── PayeesTable ───────────────────────────────────────────────────────────────

export function PayeesTable({
  onCreateRule,
  onDeleteIntentChange,
  onInspectIdChange,
  onMergeDialogChange,
}: {
  onCreateRule?: (payeeId: string, payeeName: string) => void;
  onDeleteIntentChange: (intent: PayeeDeleteIntent | null) => void;
  onInspectIdChange: (id: string | null) => void;
  onMergeDialogChange: (state: PayeeMergeState | null) => void;
}) {
  // ── Filter / sort state ──────────────────────────────────────────────────────
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [rulesFilter, setRulesFilter] = useState<RulesFilter>("all");
  const [sortCol, setSortCol] = useState<SortCol | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  // ── Cell selection + editing state ───────────────────────────────────────────
  const [bulkCount, setBulkCount] = useState(5);

  // ── Multi-select state ───────────────────────────────────────────────────────
  const { selectedIds, toggleSelect: toggleSelectRow, toggleSelectAll: _toggleSelectAll, clearSelection } = useTableSelection();

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
  const payeeRuleCount = useMemo(
    () => buildRuleReferenceMap(stagedRules, ["payee", "imported_payee"]),
    [stagedRules]
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
    canEditCell: (cell) => {
      const row = staged[cell.rowId];
      return !!row && !row.isDeleted && !row.entity.transferAccountId;
    },
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
  // Only regular payees can be selected (transfer payees are system-managed)
  const selectableRows = useMemo(() => rows.filter((r) => !r.entity.transferAccountId), [rows]);
  const visibleSelectableIds = useMemo(() => new Set(selectableRows.map((r) => r.entity.id)), [selectableRows]);
  const allVisibleSelected = selectableRows.length > 0 && selectableRows.every((r) => selectedIds.has(r.entity.id));
  const someVisibleSelected = selectableRows.some((r) => selectedIds.has(r.entity.id));

  function toggleSelectAll() {
    _toggleSelectAll(visibleSelectableIds, allVisibleSelected);
  }

  function handleNameDone(rowId: string, value: string, action: DoneAction) {
    if (action !== "cancel") {
      const trimmed = value.trim();
      if (trimmed !== staged[rowId]?.entity.name) {
        pushUndo();
        stageUpdate("payees", rowId, { name: trimmed });
      }
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
    stageNew("payees", { id: firstId, name: "" });
    for (let i = 1; i < count; i++) {
      stageNew("payees", { id: generateId(), name: "" });
    }
    if (focusFirst) setTimeout(() => startEditing(firstId, "name"), 0);
  }

  // ── Bulk actions ─────────────────────────────────────────────────────────────
  function handleBulkDelete() {
    // Only delete regular payees (transfer payees are system-managed)
    const activeIds = [...selectedIds].filter((id) => staged[id] && !staged[id].isDeleted);
    const deletableIds = activeIds.filter((id) => !staged[id]!.entity.transferAccountId);
    const skipped = activeIds.length - deletableIds.length;
    const newIds = deletableIds.filter((id) => staged[id]?.isNew);
    const serverIds = deletableIds.filter((id) => !staged[id]?.isNew);
    const count = deletableIds.length;

    if (count === 0) {
      clearSelection();
      return;
    }

    const totalRuleCount = deletableIds.reduce((sum, id) => sum + (payeeRuleCount.get(id) ?? 0), 0);
    const capturedIds = [...deletableIds];

    onDeleteIntentChange({
      kind: "bulk",
      ids: serverIds,
      title: `Delete ${count} payee${count !== 1 ? "s" : ""}?`,
      bulkServerCount: serverIds.length,
      bulkNewCount: newIds.length,
      bulkSkippedCount: skipped,
      bulkRuleCount: totalRuleCount,
      onConfirm: () => {
        pushUndo();
        for (const id of capturedIds) stageDelete("payees", id);
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
    onMergeDialogChange({
      candidates: selectedRegular.map((r) => ({ id: r.entity.id, name: r.entity.name })),
      targetId:   selectedRegular[0].entity.id,
      onConfirm: (targetId) => {
        const mergeIds = selectedRegular
          .map((row) => row.entity.id)
          .filter((id) => id !== targetId);
        pushUndo();
        stagePayeeMerge(targetId, mergeIds);
        clearSelection();
      },
    });
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

    let targetIdx = startIdx;
    for (const cols of pastedRows) {
      const name = cols[0]?.trim() ?? "";

      while (
        targetIdx < rows.length &&
        (rows[targetIdx]?.isDeleted || rows[targetIdx]?.entity.transferAccountId)
      ) {
        targetIdx++;
      }

      if (targetIdx < rows.length) {
        const target = rows[targetIdx];
        if (name) stageUpdate("payees", target.entity.id, { name });
        targetIdx++;
      } else if (!search) {
        if (!name) continue;
        stageNew("payees", { id: generateId(), name });
      }
    }
  }

  function handleOpenRules(payeeId: string, payeeName: string, ruleCount: number) {
    if (ruleCount > 0) {
      router.push(`/rules?payeeId=${payeeId}`);
      return;
    }

    if (onCreateRule) {
      onCreateRule(payeeId, payeeName);
      return;
    }

    router.push("/rules?new=1");
  }

  function handleRequestDelete(entity: Payee, ruleCount: number, isNew: boolean) {
    onDeleteIntentChange({
      kind: "single",
      ids: isNew ? [] : [entity.id],
      title: "Delete payee?",
      entityLabel: entity.name || "Unnamed",
      entityRuleCount: ruleCount,
      onConfirm: () => {
        pushUndo();
        stageDelete("payees", entity.id);
      },
    });
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
      <div ref={containerRef} className="flex min-h-0 flex-1 flex-col overflow-hidden outline-none" onKeyDown={handleGridKeyDown} onPaste={handlePaste} tabIndex={-1}>
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
                      disabled={selectableRows.length === 0}
                      className="h-3.5 w-3.5 rounded accent-primary disabled:cursor-default disabled:opacity-50"
                      title={
                        selectableRows.length === 0
                          ? "No regular payees in the current view can be selected"
                          : "Select all visible regular payees"
                      }
                      aria-label={
                        selectableRows.length === 0
                          ? "No regular payees in the current view can be selected"
                          : "Select all visible regular payees"
                      }
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
                  const { entity, isDeleted } = row;
                  const isTransfer = !!entity.transferAccountId;
                  const isNameEditing = editingCell?.rowId === entity.id && editingCell.colId === "name";
                  return (
                    <PayeesTableRow
                      key={entity.id}
                      row={row}
                      highlightedId={highlightedId}
                      isRowSelected={!isTransfer && selectedIds.has(entity.id)}
                      isNameSelected={selectedCell?.rowId === entity.id && selectedCell.colId === "name"}
                      isNameEditing={isNameEditing}
                      editStartChar={isNameEditing ? editStartChar : undefined}
                      isDuplicate={!isDeleted && duplicateNames.has(entity.name.trim().toLowerCase())}
                      ruleCount={payeeRuleCount.get(entity.id) ?? 0}
                      onToggleSelect={toggleSelectRow}
                      onSelectNameCell={(id) => selectCell(id, "name")}
                      onStartEditingName={(id) => startEditing(id, "name")}
                      onDoneName={handleNameDone}
                      onOpenRules={handleOpenRules}
                      onClearSaveError={(id) => clearSaveError("payees", id)}
                      onRevert={(id) => revertEntity("payees", id)}
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
