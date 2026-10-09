"use client";

import { Fragment, useState, useMemo, useCallback } from "react";
import { usePersistedFilters } from "@/hooks/usePersistedFilters";
import { useRouter } from "next/navigation";
import { useHighlight } from "@/hooks/useHighlight";
import { useEditableGrid } from "@/hooks/useEditableGrid";
import { useAllNotes } from "@/hooks/useAllNotes";
import { useTableSelection } from "@/hooks/useTableSelection";
import type { DoneAction } from "@/components/ui/editable-cell";
import { ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";
import { TableBulkAddBar } from "@/components/ui/table-bulk-add-bar";
import { useStagedStore } from "@/store/staged";
import { generateId } from "@/lib/uuid";
import { useAccountBalances } from "../hooks/useAccountBalances";
import { buildRuleReferenceMap } from "@/lib/referenceCheck";
import { FilterBar, ALL_GROUPS, ALL_CLASSES } from "./FilterBar";
import { AccountGroupsDialog } from "./AccountGroupsDialog";
import { buildGroupOptions } from "./AccountGroupCell";
import { useAccountGroups } from "../hooks/useAccountGroups";
import { useAccountGroupActions } from "../hooks/useAccountGroupActions";
import { useAccountClasses } from "../hooks/useAccountClasses";
import { toast } from "sonner";
import { ACCOUNT_CLASS_INFO, type AccountClass } from "@/lib/account-class";
import { effectiveAccountClasses } from "../lib/accountClasses";
import { buildClusters, type GroupBy } from "../lib/accountClusters";
import { AccountClusterHeader, AccountTotalRow } from "./AccountClusterRows";
import { UNCLASSIFIED } from "./AccountClassCell";
import { NEW_GROUP, NO_GROUP, groupLabel, liveGroups } from "../lib/accountGroups";
import { AccountsTableRow } from "./AccountsTableRow";
import type { AccountDeleteIntent } from "./AccountsTableOverlays";
import type { StatusFilter, BudgetFilter, RulesFilter } from "./FilterBar";
import type { StagedEntity } from "@/types/staged";
import type { Account } from "@/types/entities";
import { Checkbox } from "@/components/ui/checkbox";

// ─── Types ─────────────────────────────────────────────────────────────────────

const NAVIGABLE_COLS = ["name"] as const;
type NavigableCol = (typeof NAVIGABLE_COLS)[number];
type AccountRow = StagedEntity<Account>;
type SortCol = "name" | "offBudget" | "closed" | "group" | "class";
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
  const [filters, setFilters, clearFilters] = usePersistedFilters("filters:accounts", {
    search: "",
    statusFilter: "all" as StatusFilter,
    budgetFilter: "all" as BudgetFilter,
    rulesFilter: "all" as RulesFilter,
    groupFilter: ALL_GROUPS as string,
    classFilter: ALL_CLASSES as string,
    groupBy: "none" as GroupBy,
  });
  const { search, statusFilter, budgetFilter, rulesFilter, groupFilter, classFilter, groupBy } = filters;
  const setSearch       = (v: string)       => setFilters((f) => ({ ...f, search: v }));
  const setStatusFilter = (v: StatusFilter) => setFilters((f) => ({ ...f, statusFilter: v }));
  const setBudgetFilter = (v: BudgetFilter) => setFilters((f) => ({ ...f, budgetFilter: v }));
  const setRulesFilter  = (v: RulesFilter)  => setFilters((f) => ({ ...f, rulesFilter: v }));
  const setGroupFilter  = (v: string)       => setFilters((f) => ({ ...f, groupFilter: v }));
  const setClassFilter   = (v: string)       => setFilters((f) => ({ ...f, classFilter: v }));
  const setGroupBy       = (v: GroupBy)      => setFilters((f) => ({ ...f, groupBy: v }));
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

  // ── Account groups ───────────────────────────────────────────────────────────
  // `groups` is undefined when the server has no account groups: the Group
  // column, filter and bulk assign are then all hidden.
  const { supported: groupsSupported } = useAccountGroups();
  const stagedGroups = useStagedStore((s) => s.accountGroups);
  const { assignAccounts } = useAccountGroupActions();
  const allGroups = useMemo(() => liveGroups(stagedGroups), [stagedGroups]);
  const groups = groupsSupported ? allGroups : undefined;
  const [newGroupFor, setNewGroupFor] = useState<string[] | null>(null);
  const groupAssignOptions = useMemo(() => (groups ? buildGroupOptions(groups) : undefined), [groups]);
  const groupFilterOptions = useMemo(
    () =>
      groups
        ? [
            { value: ALL_GROUPS, label: "All groups" },
            { value: NO_GROUP, label: "No group" },
            ...groups.map((g) => ({ value: g.id, label: g.name })),
          ]
        : undefined,
    [groups]
  );
  // A filter on a group that no longer exists (deleted in this draft) is ignored.
  const activeGroupFilter =
    groups && (groupFilter === NO_GROUP || groups.some((g) => g.id === groupFilter)) ? groupFilter : ALL_GROUPS;

  // ── Account classes ──────────────────────────────────────────────────────────
  // Bench-owned, so a change applies at once rather than joining the draft.
  // A group's class is inherited by its members; group membership is read from
  // the draft, so a pending move shows its effect immediately.
  const accountClasses = useAccountClasses();
  const classesEnabled = accountClasses.enabled;
  const effectiveClasses = useMemo(() => effectiveAccountClasses(staged, groups, accountClasses.maps), [staged, groups, accountClasses.maps]);
  const groupNames = useMemo(() => new Map((groups ?? []).map((g) => [g.id, g.name])), [groups]);
  const unclassifiedCount = useMemo(() => {
    let n = 0;
    for (const r of Object.values(staged) as AccountRow[]) {
      if (r.isDeleted || r.entity.closed) continue;
      if (!effectiveClasses.get(r.entity.id)?.accountClass) n++;
    }
    return n;
  }, [staged, effectiveClasses]);
  const applyAccountClasses = accountClasses.apply;
  const handleSetClass = useCallback(
    (accountId: string, accountClass: AccountClass | null) => applyAccountClasses([{ scope: "account", id: accountId, accountClass }]),
    [applyAccountClasses]
  );
  const activeClassFilter = classesEnabled ? classFilter : ALL_CLASSES;

  // ── Account balances ─────────────────────────────────────────────────────────
  const { data: balances } = useAccountBalances();
  const { data: allNotes } = useAllNotes();

  const accountIdsWithNotes = useMemo(() => {
    const ids = new Set<string>();
    if (allNotes) {
      for (const key of allNotes.keys()) {
        if (key.startsWith("account-")) ids.add(key.slice("account-".length));
      }
    }
    return ids;
  }, [allNotes]);

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
  const sortedRows: AccountRow[] = useMemo(() => {
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
      if (activeGroupFilter === NO_GROUP && r.entity.groupId && groups?.some((g) => g.id === r.entity.groupId)) continue;
      if (activeGroupFilter !== ALL_GROUPS && activeGroupFilter !== NO_GROUP && r.entity.groupId !== activeGroupFilter) continue;
      if (activeClassFilter !== ALL_CLASSES) {
        const t = effectiveClasses.get(r.entity.id)?.accountClass ?? UNCLASSIFIED;
        if (t !== activeClassFilter) continue;
      }
      result.push(r);
    }

    // New (unsaved) rows always float to the top regardless of sort column.
    result.sort((a, b) => {
      if (a.isNew && !b.isNew) return -1;
      if (!a.isNew && b.isNew) return 1;
      if (!sortCol) return 0;
      let av: string | boolean, bv: string | boolean;
      if (sortCol === "name") { av = a.entity.name.toLowerCase(); bv = b.entity.name.toLowerCase(); }
      else if (sortCol === "group") {
        // Ungrouped accounts sort last in ascending order.
        av = groups && a.entity.groupId ? groupLabel(a.entity.groupId, groups).toLowerCase() : "\uffff";
        bv = groups && b.entity.groupId ? groupLabel(b.entity.groupId, groups).toLowerCase() : "\uffff";
      }
      else if (sortCol === "class") {
        // Assets before liabilities, in the order of the class list; unclassified last.
        const rank = (id: string) => {
          const c = effectiveClasses.get(id)?.accountClass;
          const i = c ? ACCOUNT_CLASS_INFO.findIndex((info) => info.value === c) : -1;
          return String(i === -1 ? 99 : i).padStart(2, "0");
        };
        av = rank(a.entity.id); bv = rank(b.entity.id);
      }
      else if (sortCol === "offBudget") { av = a.entity.offBudget; bv = b.entity.offBudget; }
      else { av = a.entity.closed; bv = b.entity.closed; }
      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
    return result;
  }, [staged, search, statusFilter, budgetFilter, rulesFilter, activeGroupFilter, activeClassFilter, effectiveClasses, groups, accountRuleCount, sortCol, sortDir]);

  // ── Grouped view ─────────────────────────────────────────────────────────────
  // Optional: clusters the filtered, sorted rows by account group or class, with a
  // balance subtotal each. `rows` is every matching row in display order;
  // `displayRows` leaves out the rows of collapsed clusters (a new, unsaved row is
  // always shown), and is what selection, paste and keyboard navigation use.
  const activeGroupBy: GroupBy = groupBy === "group" && groups ? "group" : groupBy === "class" && classesEnabled ? "class" : "none";
  const groupByOptions = useMemo(
    () => (groups || classesEnabled
      ? [
          { value: "none" as const, label: "No grouping" },
          ...(groups ? [{ value: "group" as const, label: "By group" }] : []),
          ...(classesEnabled ? [{ value: "class" as const, label: "By class" }] : []),
        ]
      : undefined),
    [groups, classesEnabled]
  );
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const collapseKey = useCallback((key: string) => `${activeGroupBy}:${key}`, [activeGroupBy]);
  const toggleCluster = useCallback(
    (key: string) =>
      setCollapsed((prev) => {
        const next = new Set(prev);
        const k = collapseKey(key);
        if (next.has(k)) next.delete(k);
        else next.add(k);
        return next;
      }),
    [collapseKey]
  );
  const clusters = useMemo(
    () => (activeGroupBy === "none" ? null : buildClusters(sortedRows, activeGroupBy, { groups, effective: effectiveClasses, balances })),
    [activeGroupBy, sortedRows, groups, effectiveClasses, balances]
  );
  const shownRowsOf = useCallback(
    <R extends { isNew: boolean }>(key: string, clusterRows: R[]) => (collapsed.has(collapseKey(key)) ? clusterRows.filter((r) => r.isNew) : clusterRows),
    [collapsed, collapseKey]
  );
  const rows = useMemo(() => (clusters ? clusters.flatMap((c) => c.rows) : sortedRows), [clusters, sortedRows]);
  const displayRows = useMemo(
    () => (clusters ? clusters.flatMap((c) => shownRowsOf(c.key, c.rows)) : sortedRows),
    [clusters, sortedRows, shownRowsOf]
  );
  const totalCents = useMemo(() => {
    if (!clusters) return null;
    const parts = clusters.map((c) => c.subtotalCents).filter((c): c is number => c !== null);
    return parts.length > 0 ? parts.reduce((a, b) => a + b, 0) : null;
  }, [clusters]);
  const leadingColSpan = 4 + (groups ? 1 : 0) + (classesEnabled ? 1 : 0);

  const hasActiveFilters = Boolean(
    search || statusFilter !== "all" || budgetFilter !== "all" || rulesFilter !== "all" || activeGroupFilter !== ALL_GROUPS || activeClassFilter !== ALL_CLASSES
  );
  // The grouping is a display choice, not a filter, so clearing filters keeps it.
  function handleClearFilters() {
    clearFilters();
    setGroupBy(groupBy);
  }

  const rowIds = useMemo(() => displayRows.map((row) => row.entity.id), [displayRows]);

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
  const visibleIds = useMemo(() => new Set(displayRows.map((r) => r.entity.id)), [displayRows]);
  const allVisibleSelected = displayRows.length > 0 && displayRows.every((r) => selectedIds.has(r.entity.id));
  const someVisibleSelected = displayRows.some((r) => selectedIds.has(r.entity.id));

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

  function handleAssignGroup(accountId: string, groupId: string | null) {
    assignAccounts([accountId], groupId);
  }

  function handleBulkAssignGroup(groupId: string | null | typeof NEW_GROUP) {
    const ids = [...selectedIds].filter((id) => staged[id] && !staged[id].isDeleted);
    if (groupId === NEW_GROUP) {
      setNewGroupFor(ids);
      return;
    }
    assignAccounts(ids, groupId);
  }

  function handleBulkSetClass(accountClass: AccountClass | null) {
    // A new account has no saved id yet, and a grouped account follows its group.
    const saved = [...selectedIds].filter((id) => staged[id] && !staged[id].isDeleted && !staged[id].isNew);
    const targets = saved.filter((id) => effectiveClasses.get(id)?.source !== "group");
    const skipped = [...selectedIds].filter((id) => staged[id] && !staged[id].isDeleted).length - targets.length;
    if (targets.length > 0) {
      applyAccountClasses(targets.map((id) => ({ scope: "account" as const, id, accountClass })));
    }
    if (skipped > 0) {
      toast.info(
        `${skipped} account${skipped === 1 ? " was" : "s were"} left unchanged: ${skipped === 1 ? "it is" : "they are"} new, or inherit${skipped === 1 ? "s" : ""} the class of ${skipped === 1 ? "its" : "their"} group.`
      );
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
      ? displayRows.findIndex((r) => r.entity.id === selectedCell.rowId)
      : 0;
    if (startIdx === -1) return;

    e.preventDefault();
    pushUndo();

    let targetIdx = startIdx;
    for (const cols of pastedRows) {

      while (targetIdx < displayRows.length && displayRows[targetIdx]?.isDeleted) {
        targetIdx++;
      }

      if (targetIdx < displayRows.length) {
        const target = displayRows[targetIdx];
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

  function handleSetInitialBalance(accountId: string, value: number | undefined) {
    if (value === staged[accountId]?.entity.initialBalance) return;
    pushUndo();
    stageUpdate("accounts", accountId, { initialBalance: value });
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
  const handleRequestNewGroup = useCallback((accountId: string) => setNewGroupFor([accountId]), []);
  const handleClearSaveError = useCallback((id: string) => clearSaveError("accounts", id), [clearSaveError]);
  const handleRevert = useCallback((id: string) => revertEntity("accounts", id), [revertEntity]);

  function renderRow(row: AccountRow) {
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
        groups={groups}
        onAssignGroup={handleAssignGroup}
        onRequestNewGroup={handleRequestNewGroup}
        effective={classesEnabled ? effectiveClasses.get(entity.id) : undefined}
        classGroupName={entity.groupId ? groupNames.get(entity.groupId) : undefined}
        canSetClass={accountClasses.available && !row.isNew}
        onSetClass={handleSetClass}
        onToggleSelect={toggleSelectRow}
        onSelectNameCell={handleSelectNameCell}
        onStartEditingName={handleStartEditingName}
        onDoneName={handleNameDone}
        onToggleNewBudgetType={handleToggleNewBudgetType}
        onSetInitialBalance={handleSetInitialBalance}
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
  }

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
          groupFilter={activeGroupFilter} onGroupFilterChange={setGroupFilter}
          groupFilterOptions={groupFilterOptions}
          groupAssignOptions={groupAssignOptions}
          classFilter={classesEnabled ? activeClassFilter : undefined} onClassFilterChange={setClassFilter}
          unclassifiedCount={classesEnabled ? unclassifiedCount : undefined}
          groupBy={activeGroupBy} onGroupByChange={setGroupBy} groupByOptions={groupByOptions}
          onBulkSetClass={accountClasses.available ? handleBulkSetClass : undefined}
          onBulkAssignGroup={handleBulkAssignGroup}
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
            <span>{hasActiveFilters ? "No accounts match the current filters." : "No accounts yet."}</span>
            {hasActiveFilters && (
              <button
                className="text-xs underline hover:text-foreground"
                onClick={handleClearFilters}
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
                    <Checkbox
                      checked={allVisibleSelected}
                      indeterminate={someVisibleSelected && !allVisibleSelected}
                      onCheckedChange={toggleSelectAll}
                    />
                  </th>
                  <th className="w-1 p-0" />
                  <th
                    className="px-2 py-1.5 text-left"
                    aria-sort={sortCol === "name" ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
                  >
                    <button
                      type="button"
                      onClick={() => toggleSort("name")}
                      className="flex w-full items-center text-xs font-medium text-muted-foreground cursor-pointer select-none hover:bg-muted/30"
                    >
                      Account Name
                      <SortIndicator col="name" sortCol={sortCol} sortDir={sortDir} />
                    </button>
                  </th>

                  <th className="w-8 p-0">
                    <span className="sr-only">Notes</span>
                  </th>

                  {groups && (
                    <th
                      className="w-44 px-2 py-1.5 text-left"
                      aria-sort={sortCol === "group" ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
                    >
                      <button
                        type="button"
                        onClick={() => toggleSort("group")}
                        className="flex w-full items-center text-xs font-medium text-muted-foreground cursor-pointer select-none hover:bg-muted/30"
                      >
                        Group
                        <SortIndicator col="group" sortCol={sortCol} sortDir={sortDir} />
                      </button>
                    </th>
                  )}

                  {classesEnabled && (
                    <th
                      className="w-44 px-2 py-1.5 text-left"
                      aria-sort={sortCol === "class" ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
                    >
                      <button
                        type="button"
                        onClick={() => toggleSort("class")}
                        className="flex w-full items-center text-xs font-medium text-muted-foreground cursor-pointer select-none hover:bg-muted/30"
                      >
                        Class
                        <SortIndicator col="class" sortCol={sortCol} sortDir={sortDir} />
                      </button>
                    </th>
                  )}

                  <th className="w-32 px-4 py-1.5 text-right">
                    <span className="text-xs font-medium text-muted-foreground">Balance</span>
                  </th>

                  <th
                    className="w-32 px-2 py-1.5 text-left"
                    aria-sort={sortCol === "offBudget" ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
                  >
                    <button
                      type="button"
                      onClick={() => toggleSort("offBudget")}
                      className="flex w-full items-center text-xs font-medium text-muted-foreground cursor-pointer select-none hover:bg-muted/30"
                    >
                      Budget
                      <SortIndicator col="offBudget" sortCol={sortCol} sortDir={sortDir} />
                    </button>
                  </th>

                  <th
                    className="w-32 px-2 py-1.5 text-left"
                    aria-sort={sortCol === "closed" ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
                  >
                    <button
                      type="button"
                      onClick={() => toggleSort("closed")}
                      className="flex w-full items-center text-xs font-medium text-muted-foreground cursor-pointer select-none hover:bg-muted/30"
                    >
                      Status
                      <SortIndicator col="closed" sortCol={sortCol} sortDir={sortDir} />
                    </button>
                  </th>

                  <th className="w-40 px-2 py-1.5 text-left">
                    <span className="text-xs font-medium text-muted-foreground">Rules</span>
                  </th>

                  <th className="w-24 p-0" />
                </tr>
              </thead>

              <tbody>
                {clusters ? (
                  clusters.map((cluster) => {
                    const isCollapsed = collapsed.has(collapseKey(cluster.key));
                    return (
                      <Fragment key={cluster.key}>
                        <AccountClusterHeader
                          cluster={cluster}
                          by={activeGroupBy as "group" | "class"}
                          collapsed={isCollapsed}
                          onToggle={toggleCluster}
                          leadingColSpan={leadingColSpan}
                          trailingColSpan={4}
                        />
                        {shownRowsOf(cluster.key, cluster.rows).map(renderRow)}
                      </Fragment>
                    );
                  })
                ) : (
                  rows.map(renderRow)
                )}
              </tbody>
              {clusters && (
                <tfoot>
                  <AccountTotalRow cents={totalCents} leadingColSpan={leadingColSpan} trailingColSpan={4} />
                </tfoot>
              )}
          </table>
        )}
        </div>

        <TableBulkAddBar bulkCount={bulkCount} onBulkCountChange={setBulkCount} onAdd={(n) => addRows(n, true)} />
      </div>

      <AccountGroupsDialog
        open={newGroupFor !== null}
        onOpenChange={(open) => {
          if (!open) setNewGroupFor(null);
        }}
        assignAccountIds={newGroupFor ?? undefined}
      />
    </>
  );
}
