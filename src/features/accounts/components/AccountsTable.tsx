"use client";

import { Fragment, useState, useMemo, useCallback, useEffect } from "react";
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
import { useAccountFlags } from "../hooks/useAccountFlags";
import { isExcluded, type AccountFlagChange } from "@/lib/account-class/flags";
import { accessChoosable, accessFlagChanges } from "@/lib/account-class/access";
import { NO_FLAGS, type AccountFlagEdit, type AccountFlagState } from "./AccountAccessCell";
import { toast } from "sonner";
import { ACCOUNT_CLASS_INFO, accountClassLabel, isAccountClass, isAccountClassAllowed, isAccountClassAllowedForSet, type AccountClass } from "@/lib/account-class";
import { selectActiveInstance, useConnectionStore } from "@/store/connection";
import { effectiveAccountClasses } from "../lib/accountClasses";
import { buildClusters, type GroupBy } from "../lib/accountClusters";
import { AccountClusterHeader, AccountTotalRow } from "./AccountClusterRows";
import { UNCLASSIFIED } from "./AccountClassCell";
import { NEW_GROUP, NO_GROUP, groupLabel, liveGroups } from "../lib/accountGroups";
import { AccountsTableRow } from "./AccountsTableRow";
import type { AccountDeleteIntent } from "./AccountsTableOverlays";
import type { StatusFilter, BudgetFilter, RulesFilter, ReportingFilter, BulkAccessChoice } from "./FilterBar";
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
    reportingFilter: "all" as ReportingFilter,
    groupBy: "group" as GroupBy,
  });
  const { search, statusFilter, budgetFilter, rulesFilter, groupFilter, classFilter, reportingFilter, groupBy } = filters;
  const setSearch       = (v: string)       => setFilters((f) => ({ ...f, search: v }));
  const setStatusFilter = (v: StatusFilter) => setFilters((f) => ({ ...f, statusFilter: v }));
  const setBudgetFilter = (v: BudgetFilter) => setFilters((f) => ({ ...f, budgetFilter: v }));
  const setRulesFilter  = (v: RulesFilter)  => setFilters((f) => ({ ...f, rulesFilter: v }));
  const setGroupFilter  = (v: string)       => setFilters((f) => ({ ...f, groupFilter: v }));
  const setClassFilter   = (v: string)       => setFilters((f) => ({ ...f, classFilter: v }));
  const setReportingFilter = (v: ReportingFilter) => setFilters((f) => ({ ...f, reportingFilter: v }));
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
  const stageAccountCloseTransfer = useStagedStore((s) => s.stageAccountCloseTransfer);
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
  const accountFlags = useAccountFlags();
  const classesEnabled = accountClasses.enabled;
  const selectedHasOnBudgetAccounts = [...selectedIds].some((id) => staged[id] && !staged[id].isDeleted && !staged[id].entity.offBudget);
  const selectedHasOffBudgetAccounts = [...selectedIds].some((id) => staged[id] && !staged[id].isDeleted && staged[id].entity.offBudget);
  const groupAssignOptions = useMemo(
    () => groups ? buildGroupOptions(groups, accountClasses.maps.groups, selectedHasOnBudgetAccounts, selectedHasOffBudgetAccounts || !selectedHasOnBudgetAccounts, accountFlags.maps.groups) : undefined,
    [groups, accountClasses.maps.groups, accountFlags.maps.groups, selectedHasOnBudgetAccounts, selectedHasOffBudgetAccounts]
  );
  const effectiveClasses = useMemo(() => effectiveAccountClasses(staged, groups, accountClasses.maps), [staged, groups, accountClasses.maps]);
  const groupNames = useMemo(() => new Map((groups ?? []).map((g) => [g.id, g.name])), [groups]);
  const applyAccountClasses = accountClasses.apply;

  // ── An own class the group overrides ──────────────────────────────────────────
  // A group's class wins, and an account's own class is kept but unused while it is in that group (unless it is a narrower kind of
  // the group's, which applies). When an unused own class differs from the group's, say so once, so it is not a surprise.
  const connectionForNotice = useConnectionStore(selectActiveInstance);
  const noticeKey = `accounts:own-class-notice:${connectionForNotice?.budgetSyncId ?? ""}`;
  const overridden = useMemo(() => {
    if (!groups || !accountClasses.available) return [];
    const live = new Set(groups.map((g) => g.id));
    return (Object.values(staged) as AccountRow[]).flatMap((r) => {
      const groupId = r.entity.groupId;
      const own = accountClasses.maps.accounts.get(r.entity.id);
      const group = groupId && live.has(groupId) ? accountClasses.maps.groups.get(groupId) : undefined;
      return !r.isNew && !r.isDeleted && own && group && own !== group && effectiveClasses.get(r.entity.id)?.source === "group" ? [{ id: r.entity.id, name: r.entity.name, own, group, groupName: groupNames.get(groupId!) ?? "" }] : [];
    });
  }, [groups, accountClasses.available, accountClasses.maps, staged, groupNames, effectiveClasses]);
  const overriddenSignature = overridden.map((o) => `${o.id}:${o.own}:${o.group}`).sort().join("|");
  // What was dismissed, per budget, in this browser only; read again when the budget changes or after a dismissal.
  const [dismissals, setDismissals] = useState(0);
  // Also kept in memory, so Dismiss works when the browser blocks storage.
  const [dismissedHere, setDismissedHere] = useState<string | null>(null);
  const dismissedNotice = useMemo(() => {
    void dismissals;
    try { return typeof window === "undefined" ? null : localStorage.getItem(noticeKey); } catch { return null; }
  }, [noticeKey, dismissals]);
  const dismissNotice = () => {
    try { localStorage.setItem(noticeKey, overriddenSignature); } catch { /* the notice simply shows again next time */ }
    setDismissedHere(overriddenSignature);
    setDismissals((n) => n + 1);
  };
  const showOverriddenNotice = overridden.length > 0 && dismissedNotice !== overriddenSignature && dismissedHere !== overriddenSignature;
  const handleSetClass = useCallback(
    (accountId: string, accountClass: AccountClass | null) => {
      const entry = staged[accountId];
      if (!entry || entry.isDeleted
        || effectiveClasses.get(accountId)?.source === "group"
        || !isAccountClassAllowed(accountClass, entry.entity.offBudget)) return;
      if (entry.isNew || entry.pendingAccountClass !== undefined) {
        pushUndo();
        useStagedStore.getState().stageAccountClass(accountId, accountClass);
        return;
      }
      if (!accountClasses.available) return;
      applyAccountClasses([{ scope: "account", id: accountId, accountClass }]);
    },
    [applyAccountClasses, staged, accountClasses.available, effectiveClasses, pushUndo]
  );
  // A class filter saved by an older version (the retired "excluded" class) matches no option, so it counts as no filter.
  const classFilterKnown = classFilter === ALL_CLASSES || classFilter === UNCLASSIFIED || isAccountClass(classFilter);
  const activeClassFilter = classesEnabled && classFilterKnown ? classFilter : ALL_CLASSES;
  useEffect(() => {
    if (!classFilterKnown) setFilters((f) => ({ ...f, classFilter: ALL_CLASSES }));
  }, [classFilterKnown, setFilters]);

  // ── Access and reports ───────────────────────────────────────────────────────
  // Also Bench-owned and immediate. Nothing here is required: an off-budget account can be marked available now or locked against its
  // class default, and left out of reports. Unsaved rows have no permanent id yet, so their choice waits for the save.
  const applyAccountFlags = accountFlags.apply;
  const handleSetFlags = useCallback(
    (accountId: string, edits: AccountFlagEdit[]) => {
      const entry = useStagedStore.getState().accounts[accountId];
      // A new account has no permanent id yet: its choices wait for the save, like its class. An account whose flags are still waiting
      // for a retry keeps collecting edits there, so the retry writes the latest choice, never an older one over a later edit.
      if (entry?.isNew || entry?.pendingAccountFlags) {
        const next = { ...(entry.pendingAccountFlags ?? NO_FLAGS) };
        for (const e of edits) next[e.flag] = e.on;
        useStagedStore.getState().pushUndo();
        useStagedStore.getState().stageAccountFlags(accountId, next);
        return;
      }
      applyAccountFlags(edits.map((e) => ({ scope: "account" as const, id: accountId, flag: e.flag, on: e.on })));
    },
    [applyAccountFlags]
  );
  const flagStateOf = useCallback((accountId: string): AccountFlagState => staged[accountId]?.pendingAccountFlags ?? ({
    // An account that takes its class from its group is left out, or not, by the group; its own saved flag is kept but does not apply.
    excluded: effectiveClasses.get(accountId)?.source !== "group" && !!accountFlags.maps.accounts.get("excluded")?.has(accountId),
    accessible: !!accountFlags.maps.accounts.get("accessible")?.has(accountId),
    locked: !!accountFlags.maps.accounts.get("locked")?.has(accountId),
  }), [accountFlags.maps, effectiveClasses, staged]);
  // Accounts left out of Financial Insights, by their own flag or their group's (a live group only).
  const excludedIds = useMemo(() => {
    const liveGroupIds = groups ? new Set(groups.map((g) => g.id)) : null;
    return new Set((Object.values(staged) as AccountRow[]).filter((r) => !r.isNew && !r.isDeleted
      && isExcluded(r.entity.id, liveGroupIds && r.entity.groupId && liveGroupIds.has(r.entity.groupId) ? r.entity.groupId : null, accountFlags.maps, effectiveClasses.get(r.entity.id)?.source === "group")).map((r) => r.entity.id));
  }, [staged, groups, accountFlags.maps, effectiveClasses]);
  // Accounts waiting for a class. One that is left out of Financial Insights needs none, so it is not counted here.
  const unclassifiedCount = useMemo(() => {
    let n = 0;
    for (const r of Object.values(staged) as AccountRow[]) {
      if (r.isDeleted || r.entity.closed) continue;
      if (!effectiveClasses.get(r.entity.id)?.accountClass && !excludedIds.has(r.entity.id)) n++;
    }
    return n;
  }, [staged, effectiveClasses, excludedIds]);
  const excludedByGroupIds = useMemo(() => {
    const liveGroupIds = groups ? new Set(groups.map((g) => g.id)) : null;
    return new Set((Object.values(staged) as AccountRow[]).filter((r) => !r.isNew && !r.isDeleted && liveGroupIds && r.entity.groupId && liveGroupIds.has(r.entity.groupId) && accountFlags.maps.groups.has(r.entity.groupId)).map((r) => r.entity.id));
  }, [staged, groups, accountFlags.maps]);
  // The "left out" list only means something once the saved settings have loaded, and it ends on its own when it is empty.
  const activeReportingFilter: ReportingFilter = classesEnabled && accountFlags.available && excludedIds.size > 0 && reportingFilter === "excluded" ? "excluded" : "all";
  const listEnded = classesEnabled && accountFlags.available && excludedIds.size === 0;
  useEffect(() => {
    if (listEnded && reportingFilter !== "all") setFilters((f) => ({ ...f, reportingFilter: "all" }));
  }, [listEnded, reportingFilter, setFilters]);

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
      if (activeReportingFilter === "excluded" && !excludedIds.has(r.entity.id)) continue;
      if (activeClassFilter !== ALL_CLASSES) {
        const t = effectiveClasses.get(r.entity.id)?.accountClass ?? UNCLASSIFIED;
        if (t !== activeClassFilter) continue;
      }
      result.push(r);
    }

    const groupOrderById = new Map((groups ?? []).map((group, index) => [group.id, {
      sortOrder: group.sortOrder,
      listOrder: index,
    }]));
    // New (unsaved) rows always float to the top regardless of sort column.
    result.sort((a, b) => {
      if (a.isNew && !b.isNew) return -1;
      if (!a.isNew && b.isNew) return 1;
      if (!sortCol) {
        // Match Actual's account list: budget placement, group order, then account order.
        const budgetOrder = Number(a.entity.offBudget) - Number(b.entity.offBudget);
        if (budgetOrder !== 0) return budgetOrder;
        const groupOrder = (groupId: string | null | undefined) =>
          groupId ? groupOrderById.get(groupId) : undefined;
        const groupA = groupOrder(a.entity.groupId);
        const groupB = groupOrder(b.entity.groupId);
        const groupSortOrderA = groupA?.sortOrder ?? Number.MAX_SAFE_INTEGER;
        const groupSortOrderB = groupB?.sortOrder ?? Number.MAX_SAFE_INTEGER;
        if (groupSortOrderA !== groupSortOrderB) return groupSortOrderA - groupSortOrderB;
        const groupListOrderA = groupA?.listOrder ?? Number.MAX_SAFE_INTEGER;
        const groupListOrderB = groupB?.listOrder ?? Number.MAX_SAFE_INTEGER;
        if (groupListOrderA !== groupListOrderB) return groupListOrderA - groupListOrderB;
        return (a.entity.sortOrder ?? 0) - (b.entity.sortOrder ?? 0);
      }
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
  }, [staged, search, statusFilter, budgetFilter, rulesFilter, activeGroupFilter, activeClassFilter, activeReportingFilter, excludedIds, effectiveClasses, groups, accountRuleCount, sortCol, sortDir]);

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
  const leadingColSpan = 4 + (groups ? 1 : 0) + (classesEnabled ? 3 : 0);

  const hasActiveFilters = Boolean(
    search || statusFilter !== "all" || budgetFilter !== "all" || rulesFilter !== "all" || activeGroupFilter !== ALL_GROUPS || activeClassFilter !== ALL_CLASSES || activeReportingFilter !== "all"
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
      if (staged[id] && !staged[id].isDeleted) { stageUpdate("accounts", id, { closed: false }); stageAccountCloseTransfer(id, null); }
    }
  }

  function handleAssignGroup(accountId: string, groupId: string | null) {
    if (classesEnabled && !accountClasses.available) return;
    if (!isAccountClassAllowed(groupId ? accountClasses.maps.groups.get(groupId) : null, staged[accountId]?.entity.offBudget ?? false)) return;
    if (groupId && accountFlags.maps.groups.has(groupId) && !(staged[accountId]?.entity.offBudget ?? false)) return;
    assignAccounts([accountId], groupId);
  }

  function handleBulkAssignGroup(groupId: string | null | typeof NEW_GROUP) {
    const ids = [...selectedIds].filter((id) => staged[id] && !staged[id].isDeleted);
    if (groupId === NEW_GROUP) {
      setNewGroupFor(ids);
      return;
    }
    if (classesEnabled && !accountClasses.available) return;
    if (ids.some((id) => !isAccountClassAllowed(groupId ? accountClasses.maps.groups.get(groupId) : null, staged[id].entity.offBudget))) return;
    if (groupId && accountFlags.maps.groups.has(groupId) && ids.some((id) => !staged[id].entity.offBudget)) return;
    assignAccounts(ids, groupId);
  }

  function handleBulkSetClass(accountClass: AccountClass | null) {
    if (!accountClasses.available || !isAccountClassAllowedForSet(accountClass, { onBudget: selectedHasOnBudgetAccounts, offBudget: selectedHasOffBudgetAccounts })) return;
    // New accounts and class retries stay staged; existing saved classes remain immediate.
    const live = [...selectedIds].filter((id) => staged[id] && !staged[id].isDeleted);
    const targets = live.filter((id) => effectiveClasses.get(id)?.source !== "group");
    const drafts = targets.filter((id) => staged[id].isNew || staged[id].pendingAccountClass !== undefined);
    const saved = targets.filter((id) => !drafts.includes(id));
    const skipped = [...selectedIds].filter((id) => staged[id] && !staged[id].isDeleted).length - targets.length;
    if (drafts.length > 0) {
      pushUndo();
      for (const id of drafts) useStagedStore.getState().stageAccountClass(id, accountClass);
    }
    if (saved.length > 0) {
      applyAccountClasses(saved.map((id) => ({ scope: "account" as const, id, accountClass })));
    }
    if (skipped > 0) {
      toast.info(
        `${skipped} account${skipped === 1 ? " was" : "s were"} left unchanged: ${skipped === 1 ? "it inherits" : "they inherit"} the class of ${skipped === 1 ? "its" : "their"} group.`
      );
    }
  }

  function handleBulkSetAccess(choice: BulkAccessChoice) {
    if (accountFlags.busy) return;
    const live = [...selectedIds].filter((id) => staged[id] && !staged[id].isDeleted);
    const savedChanges: AccountFlagChange[] = [];
    const drafts: { id: string; edits: AccountFlagEdit[] }[] = [];
    let skipped = 0;
    for (const id of live) {
      const entity = staged[id].entity;
      const effective = effectiveClasses.get(id);
      const flags = flagStateOf(id);
      let edits: AccountFlagEdit[];
      if (choice === "exclude" || choice === "include") {
        // Only off-budget accounts can be left out, and the group decides for an account in a left-out group or taking its group's class.
        if (!entity.offBudget || excludedByGroupIds.has(id) || effective?.source === "group") { skipped++; continue; }
        edits = flags.excluded === (choice === "exclude") ? [] : [{ flag: "excluded", on: choice === "exclude" }];
      } else {
        const cls = effective?.accountClass ?? null;
        if (!cls || !accessChoosable(cls, entity.offBudget)) { skipped++; continue; }
        const wanted = accessFlagChanges(cls, choice);
        edits = [
          ...(flags.accessible !== wanted.accessible ? [{ flag: "accessible" as const, on: wanted.accessible }] : []),
          ...(flags.locked !== wanted.locked ? [{ flag: "locked" as const, on: wanted.locked }] : []),
        ];
      }
      if (edits.length === 0) continue;
      if (staged[id].isNew || staged[id].pendingAccountFlags) drafts.push({ id, edits });
      else savedChanges.push(...edits.map((e) => ({ scope: "account" as const, id, flag: e.flag, on: e.on })));
    }
    if (drafts.length > 0) {
      pushUndo();
      for (const { id, edits } of drafts) {
        const next = { ...(staged[id].pendingAccountFlags ?? NO_FLAGS) };
        for (const e of edits) next[e.flag] = e.on;
        useStagedStore.getState().stageAccountFlags(id, next);
      }
    }
    if (savedChanges.length > 0) applyAccountFlags(savedChanges);
    if (skipped > 0) {
      const why = choice === "exclude" || choice === "include"
        ? "only off-budget accounts whose group does not decide can be left out"
        : "access applies only to off-budget Checking, Cash, Savings, Fixed Deposit, Investment, Retirement and Other Asset accounts";
      toast.info(`${skipped} account${skipped === 1 ? " was" : "s were"} left unchanged: ${why}.`);
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
          const offBudget = v === "true" || v === "1" || v === "yes" || v === "off budget" || v === "off";
          if (isAccountClassAllowed(effectiveClasses.get(target.entity.id)?.accountClass, offBudget)
            && isAccountClassAllowed(target.pendingAccountClass, offBudget)) patch.offBudget = offBudget;
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
    if (!isAccountClassAllowed(effectiveClasses.get(accountId)?.accountClass, nextOffBudget)) return;
    if (!isAccountClassAllowed(staged[accountId]?.pendingAccountClass, nextOffBudget)) return;
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
    stageAccountCloseTransfer(accountId, null);
  }

  function handleRequestClose(entity: Account, balance: number, isNew: boolean) {
    onDeleteIntentChange({
      kind: "close",
      ids: isNew ? [] : [entity.id],
      title: "Close account?",
      label: entity.name || "Unnamed",
      balance,
      accountId: entity.id,
      offBudget: entity.offBudget,
      canTransfer: !isNew,
      onConfirm: () => {
        pushUndo();
        stageUpdate("accounts", entity.id, { closed: true });
      },
      onConfirmClose: (transfer) => {
        pushUndo();
        stageUpdate("accounts", entity.id, { closed: true });
        stageAccountCloseTransfer(entity.id, transfer);
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
        groupClasses={accountClasses.maps.groups}
        excludedGroups={accountFlags.maps.groups}
        canAssignGroups={!classesEnabled || accountClasses.available}
        onAssignGroup={handleAssignGroup}
        onRequestNewGroup={handleRequestNewGroup}
        effective={classesEnabled ? effectiveClasses.get(entity.id) : undefined}
        classGroupName={entity.groupId ? groupNames.get(entity.groupId) : undefined}
        canSetClass={row.isNew || row.pendingAccountClass !== undefined || accountClasses.available}
        onSetClass={handleSetClass}
        canSetFlags={row.isNew || (accountFlags.available && !accountFlags.busy)}
        flagState={flagStateOf(entity.id)}
        excludedByGroup={excludedByGroupIds.has(entity.id)}
        onSetFlags={handleSetFlags}
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
          groupAssignmentDisabled={classesEnabled && !accountClasses.available}
          selectedHasOnBudgetAccounts={selectedHasOnBudgetAccounts}
          selectedHasOffBudgetAccounts={selectedHasOffBudgetAccounts}
          classFilter={classesEnabled ? activeClassFilter : undefined} onClassFilterChange={setClassFilter}
          unclassifiedCount={classesEnabled ? unclassifiedCount : undefined}
          reportingFilter={activeReportingFilter} onReportingFilterChange={setReportingFilter}
          leftOutCount={classesEnabled && accountFlags.available ? excludedIds.size : undefined}
          groupBy={activeGroupBy} onGroupByChange={setGroupBy} groupByOptions={groupByOptions}
          onBulkSetClass={accountClasses.available ? handleBulkSetClass : undefined}
          onBulkSetAccess={classesEnabled && accountClasses.available && accountFlags.available ? handleBulkSetAccess : undefined}
          bulkAccessBusy={accountFlags.busy}
          onBulkAssignGroup={handleBulkAssignGroup}
          filteredCount={rows.length} totalCount={totalCount}
          selectedCount={activeSelectedCount}
          onBulkClose={handleBulkClose}
          onBulkReopen={handleBulkReopen}
          onBulkDelete={handleBulkDelete}
          onDeselect={() => clearSelection()}
        />

        {classesEnabled && showOverriddenNotice && (
          <div role="status" className="flex items-center justify-between gap-3 border-b border-amber-500/40 bg-amber-50 px-4 py-1.5 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
            <span className="min-w-0 truncate" title={overridden.map((o) => `${o.name}: own class ${accountClassLabel(o.own)}, group “${o.groupName}” is ${accountClassLabel(o.group)}`).join("\n")}>
              {overridden.length === 1
                ? <>“{overridden[0].name}” has its own class, {accountClassLabel(overridden[0].own)}, but its group “{overridden[0].groupName}” is {accountClassLabel(overridden[0].group)}, and the group’s class applies.</>
                : <>{overridden.length} accounts have their own class, which their group’s class overrides ({overridden.slice(0, 3).map((o) => o.name).join(", ")}{overridden.length > 3 ? ", …" : ""}).</>}
              {" "}Change the group’s class or move the account out, or keep the group’s class.
            </span>
            <span className="flex shrink-0 gap-1.5">
              <button type="button" className="rounded border border-amber-600/50 px-2 py-0.5 hover:bg-amber-100 dark:hover:bg-amber-900/40" onClick={() => applyAccountClasses(overridden.map((o) => ({ scope: "account" as const, id: o.id, accountClass: null })))}>Keep the group’s class</button>
              <button type="button" className="rounded px-2 py-0.5 hover:bg-amber-100 dark:hover:bg-amber-900/40" onClick={dismissNotice}>Dismiss</button>
            </span>
          </div>
        )}
        {classesEnabled && accountFlags.failed && (
          <div role="alert" className="flex items-center justify-between gap-3 border-b border-amber-500/40 bg-amber-50 px-4 py-1.5 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
            <span>Access and report settings could not be loaded, so they cannot be changed or checked here.</span>
            <button type="button" className="rounded border border-amber-600/50 px-2 py-0.5 hover:bg-amber-100 dark:hover:bg-amber-900/40" onClick={() => { void accountFlags.refetch(); }}>Retry</button>
          </div>
        )}
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
                      aria-sort={activeGroupBy === "group" ? "none" : sortCol === "group" ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
                    >
                      <button
                        type="button"
                        onClick={() => toggleSort("group")}
                        disabled={activeGroupBy === "group"}
                        className="flex w-full items-center text-xs font-medium text-muted-foreground cursor-pointer select-none hover:bg-muted/30 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                      >
                        Group
                        {activeGroupBy !== "group" && <SortIndicator col="group" sortCol={sortCol} sortDir={sortDir} />}
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

                  {classesEnabled && (
                    <th className="w-40 px-2 py-1.5 text-left">
                      <span className="text-xs font-medium text-muted-foreground" title="Whether you can use the account's money now. On budget it always counts as available; off budget it follows the class unless you choose.">Accessible</span>
                    </th>
                  )}

                  {classesEnabled && (
                    <th className="w-48 px-2 py-1.5 text-left">
                      <span className="text-xs font-medium text-muted-foreground">Reports</span>
                    </th>
                  )}

                  <th className="w-32 px-4 py-1.5 text-right">
                    <span className="text-xs font-medium text-muted-foreground">Balance</span>
                  </th>

                  <th
                    className="w-28 px-2 py-1.5 text-left"
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
                    className="w-26 px-2 py-1.5 text-left"
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

                  <th className="w-32 px-2 py-1.5 text-left">
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
