"use client";

import React, { useDeferredValue, useMemo, useState, startTransition } from "react";
import { usePersistedFilters } from "@/hooks/usePersistedFilters";
import { useRouter } from "next/navigation";
import { useHighlight } from "@/hooks/useHighlight";
import { useEditableGrid } from "@/hooks/useEditableGrid";
import { useNotesIndex } from "@/hooks/useNotesIndex";
import { useTableSelection } from "@/hooks/useTableSelection";
import type { DoneAction } from "@/components/ui/editable-cell";
import {
  ArrowUpDown, ArrowUp, ArrowDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useStagedStore } from "@/store/staged";
import { generateId } from "@/lib/uuid";
import { buildRuleReferenceMap } from "@/lib/referenceCheck";
import type { StagedEntity } from "@/types/staged";
import type { CategoryGroup, Category } from "@/types/entities";
import { FilterBar } from "./FilterBar";
import type { CategoryDeleteIntent, CategoryInspectTarget } from "./CategoriesTableOverlays";
import { CategoriesTableGroupRow } from "./CategoriesTableGroupRow";
import { CategoriesTableCategoryRow } from "./CategoriesTableCategoryRow";
import type { CategoryGroupOption } from "./CategoryGroupAssignmentCell";
import type { VisibilityFilter, TypeFilter, RulesFilter, SortDir } from "./FilterBar";
import { getGroupCollapseState } from "../utils/collapsedGroups";

// ─── Types ─────────────────────────────────────────────────────────────────────

type GroupRow = StagedEntity<CategoryGroup>;
type CategoryRow = StagedEntity<Category>;
type SelectionKind = "group" | "category";

const CATEGORY_NAME_COLS = ["name"] as const;

function makeSelectionRowId(kind: SelectionKind, id: string) {
  return `${kind}:${id}`;
}

function parseSelectionRowId(rowId: string): { kind: SelectionKind; id: string } | null {
  if (rowId.startsWith("group:")) return { kind: "group", id: rowId.slice("group:".length) };
  if (rowId.startsWith("category:")) return { kind: "category", id: rowId.slice("category:".length) };
  return null;
}

// ─── SortIndicator ─────────────────────────────────────────────────────────────

function SortIndicator({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) return <ArrowUpDown className="ml-1 inline h-3 w-3 opacity-30" />;
  return dir === "asc"
    ? <ArrowUp className="ml-1 inline h-3 w-3" />
    : <ArrowDown className="ml-1 inline h-3 w-3" />;
}

// ─── CategoriesTable ───────────────────────────────────────────────────────────

export function CategoriesTable({
  collapsedGroups,
  setCollapsedGroups,
  onCreateRule,
  onDeleteIntentChange,
  onInspectTargetChange,
}: {
  collapsedGroups: Set<string>;
  setCollapsedGroups: React.Dispatch<React.SetStateAction<Set<string>>>;
  onCreateRule?: (categoryId: string) => void;
  onDeleteIntentChange: (intent: CategoryDeleteIntent | null) => void;
  onInspectTargetChange: (target: CategoryInspectTarget | null) => void;
}) {
  // ── Filter / sort state ──────────────────────────────────────────────────────
  const [filters, setFilters, clearFilters] = usePersistedFilters("filters:categories", {
    search: "",
    visibilityFilter: "all" as VisibilityFilter,
    typeFilter: "all" as TypeFilter,
    rulesFilter: "all" as RulesFilter,
  });
  const { search, visibilityFilter, typeFilter, rulesFilter } = filters;
  const setSearch          = (v: string)           => setFilters((f) => ({ ...f, search: v }));
  const setVisibilityFilter = (v: VisibilityFilter) => setFilters((f) => ({ ...f, visibilityFilter: v }));
  const setTypeFilter      = (v: TypeFilter)        => setFilters((f) => ({ ...f, typeFilter: v }));
  const setRulesFilter     = (v: RulesFilter)       => setFilters((f) => ({ ...f, rulesFilter: v }));
  const [sortNameDir, setSortNameDir] = useState<SortDir | null>(null);
  const deferredSearch = useDeferredValue(search);

  // ── Editing state ────────────────────────────────────────────────────────────
  // ── Multi-select ─────────────────────────────────────────────────────────────
  const { selectedIds, toggleSelect, clearSelection } = useTableSelection();

  const router        = useRouter();
  const highlightedId = useHighlight();

  // ── Store ────────────────────────────────────────────────────────────────────
  const stagedGroups = useStagedStore((s) => s.categoryGroups);
  const stagedCats = useStagedStore((s) => s.categories);
  const stagedRules = useStagedStore((s) => s.rules);
  const stageNew = useStagedStore((s) => s.stageNew);
  const stageUpdate = useStagedStore((s) => s.stageUpdate);
  const stageDelete = useStagedStore((s) => s.stageDelete);
  const revertEntity = useStagedStore((s) => s.revertEntity);
  const clearSaveError = useStagedStore((s) => s.clearSaveError);
  const pushUndo = useStagedStore((s) => s.pushUndo);

  // ── Duplicate detection ───────────────────────────────────────────────────────
  const duplicateGroupNames = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of Object.values(stagedGroups)) {
      if (s.isDeleted) continue;
      const k = s.entity.name.trim().toLowerCase();
      if (k) counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    return new Set([...counts].filter(([, v]) => v > 1).map(([k]) => k));
  }, [stagedGroups]);

  // Duplicate category names within the same group
  const duplicateCatNames = useMemo(() => {
    const byGroup = new Map<string, Map<string, number>>();
    for (const s of Object.values(stagedCats)) {
      if (s.isDeleted) continue;
      const k = s.entity.name.trim().toLowerCase();
      if (!k) continue;
      if (!byGroup.has(s.entity.groupId)) byGroup.set(s.entity.groupId, new Map());
      const m = byGroup.get(s.entity.groupId)!;
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    const dupes = new Set<string>(); // category ids
    for (const s of Object.values(stagedCats)) {
      if (s.isDeleted) continue;
      const k = s.entity.name.trim().toLowerCase();
      const count = byGroup.get(s.entity.groupId)?.get(k) ?? 0;
      if (count > 1) dupes.add(s.entity.id);
    }
    return dupes;
  }, [stagedCats]);

  // ── Category → rule count ─────────────────────────────────────────────────────
  const categoryRuleCount = useMemo(
    () => buildRuleReferenceMap(stagedRules, ["category"]),
    [stagedRules]
  );
  const { data: notesIndex } = useNotesIndex();

  const rawEntityIdsWithNotes = useMemo(
    () => new Set(notesIndex?.rawEntityIdsWithNotes ?? []),
    [notesIndex]
  );

  // ── Index all categories by groupId (no filters) ─────────────────────────────
  // Used by allGroups for group-level hidden/search checks, and as the base for
  // filteredCatsByGroup. Recomputed only when stagedCats changes.
  const allCatsByGroup = useMemo(() => {
    const map = new Map<string, CategoryRow[]>();
    for (const s of Object.values(stagedCats)) {
      const cat = s as CategoryRow;
      const list = map.get(cat.entity.groupId);
      if (list) list.push(cat);
      else map.set(cat.entity.groupId, [cat]);
    }
    return map;
  }, [stagedCats]);

  // ── Filtered + sorted categories per group ────────────────────────────────────
  // Replaces the getCategoriesForGroup plain function. Each call site becomes O(1).
  const filteredCatsByGroup = useMemo(() => {
    const q = deferredSearch.toLowerCase();
    const map = new Map<string, CategoryRow[]>();
    for (const [groupId, cats] of allCatsByGroup) {
      let filtered: CategoryRow[] = cats;
      if (q) filtered = filtered.filter((c) => c.entity.name.toLowerCase().includes(q));
      if (visibilityFilter === "visible") filtered = filtered.filter((c) => !c.entity.hidden);
      if (visibilityFilter === "hidden")  filtered = filtered.filter((c) =>  c.entity.hidden);
      if (sortNameDir) {
        filtered = [...filtered].sort((a, b) =>
          sortNameDir === "asc"
            ? a.entity.name.toLowerCase().localeCompare(b.entity.name.toLowerCase())
            : b.entity.name.toLowerCase().localeCompare(a.entity.name.toLowerCase())
        );
      }
      map.set(groupId, filtered);
    }
    return map;
  }, [allCatsByGroup, deferredSearch, visibilityFilter, sortNameDir]);

  // ── Rules filter layer on top of filteredCatsByGroup ────────────────────────
  const visibleCatsByGroup = useMemo(() => {
    if (rulesFilter === "all") return filteredCatsByGroup;
    const map = new Map<string, CategoryRow[]>();
    for (const [groupId, cats] of filteredCatsByGroup) {
      const filtered = cats.filter((c) => {
        const count = categoryRuleCount.get(c.entity.id) ?? 0;
        return rulesFilter === "with_rules" ? count > 0 : count === 0;
      });
      map.set(groupId, filtered);
    }
    return map;
  }, [filteredCatsByGroup, rulesFilter, categoryRuleCount]);

  function getCategoriesForGroup(groupId: string): CategoryRow[] {
    return visibleCatsByGroup.get(groupId) ?? [];
  }

  // ── Build flat ordered list of visible groups ─────────────────────────────────
  const allGroups: GroupRow[] = useMemo(() => {
    let gs = Object.values(stagedGroups) as GroupRow[];
    const q = deferredSearch.toLowerCase();
    if (typeFilter === "income") gs = gs.filter((g) => g.entity.isIncome);
    if (typeFilter === "expense") gs = gs.filter((g) => !g.entity.isIncome);
    if (visibilityFilter === "visible") gs = gs.filter((g) => !g.entity.hidden);
    if (visibilityFilter === "hidden") gs = gs.filter((g) =>
      g.entity.hidden ||
      (allCatsByGroup.get(g.entity.id) ?? []).some(
        (c) => c.entity.hidden && !c.isDeleted
      )
    );
    if (q) gs = gs.filter((g) => {
      if (g.entity.name.toLowerCase().includes(q)) return true;
      // Also show group if any child category matches
      return (allCatsByGroup.get(g.entity.id) ?? []).some(
        (c) => c.entity.name.toLowerCase().includes(q)
      );
    });
    if (sortNameDir) {
      gs = [...gs].sort((a, b) => {
        const av = a.entity.name.toLowerCase();
        const bv = b.entity.name.toLowerCase();
        return sortNameDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      });
    } else {
      // Default: income groups first, then expense
      gs = [...gs].sort((a, b) => Number(b.entity.isIncome) - Number(a.entity.isIncome));
    }
    return gs;
  }, [stagedGroups, allCatsByGroup, deferredSearch, typeFilter, visibilityFilter, sortNameDir]);

  const groupCountById = useMemo(() => {
    const counts = new Map<string, { total: number; visible: number }>();

    for (const [groupId, cats] of allCatsByGroup) {
      let total = 0;
      for (const cat of cats) {
        if (!cat.isDeleted) total++;
      }
      counts.set(groupId, { total, visible: 0 });
    }

    for (const [groupId, cats] of visibleCatsByGroup) {
      const existing = counts.get(groupId) ?? { total: 0, visible: 0 };
      let visible = 0;
      for (const cat of cats) {
        if (!cat.isDeleted) visible++;
      }
      counts.set(groupId, { total: existing.total, visible });
    }

    return counts;
  }, [allCatsByGroup, visibleCatsByGroup]);

  const incomeGroupCount = Object.values(stagedGroups).filter((g) => !g.isDeleted && g.entity.isIncome).length;
  const activeGroupIds = useMemo(
    () =>
      Object.values(stagedGroups)
        .filter((group) => !group.isDeleted)
        .map((group) => group.entity.id),
    [stagedGroups]
  );
  const groupOptions = useMemo<CategoryGroupOption[]>(
    () =>
      Object.values(stagedGroups)
        .filter((group) => !group.isDeleted)
        .map((group) => ({
          id: group.entity.id,
          name: group.entity.name || "Unnamed group",
        })),
    [stagedGroups]
  );
  const incomeGroupOptions = useMemo<CategoryGroupOption[]>(
    () => groupOptions.filter((group) => stagedGroups[group.id]?.entity.isIncome),
    [groupOptions, stagedGroups]
  );
  const expenseGroupOptions = useMemo<CategoryGroupOption[]>(
    () => groupOptions.filter((group) => !stagedGroups[group.id]?.entity.isIncome),
    [groupOptions, stagedGroups]
  );
  const groupLabelById = useMemo(
    () => new Map(groupOptions.map((group) => [group.id, group.name])),
    [groupOptions]
  );
  const { allCollapsed } = getGroupCollapseState(collapsedGroups, activeGroupIds);

  const totalCount = Object.keys(stagedGroups).length + Object.keys(stagedCats).length;
  const filteredCount = allGroups.reduce(
    (acc, g) => acc + 1 + (visibleCatsByGroup.get(g.entity.id)?.length ?? 0),
    0
  );

  const visibleRowIds = useMemo(() => {
    const next: string[] = [];
    for (const group of allGroups) {
      next.push(makeSelectionRowId("group", group.entity.id));
      if (!collapsedGroups.has(group.entity.id)) {
        for (const cat of visibleCatsByGroup.get(group.entity.id) ?? []) {
          next.push(makeSelectionRowId("category", cat.entity.id));
        }
      }
    }
    return next;
  }, [allGroups, collapsedGroups, visibleCatsByGroup]);

  const {
    containerRef,
    selectedCell,
    editingCell,
    editStartChar,
    selectCell,
    startEditing,
    commitCell,
    handleGridKeyDown,
  } = useEditableGrid<"name">({
    rowIds: visibleRowIds,
    columns: CATEGORY_NAME_COLS,
    canEditCell: (cell) => {
      const parsed = parseSelectionRowId(cell.rowId);
      if (!parsed) return false;
      return parsed.kind === "group"
        ? !!stagedGroups[parsed.id] && !stagedGroups[parsed.id].isDeleted
        : !!stagedCats[parsed.id] && !stagedCats[parsed.id].isDeleted;
    },
  });

  function toggleSort() {
    setSortNameDir((prev) =>
      prev === null ? "asc" : prev === "asc" ? "desc" : null
    );
  }

  function toggleCollapse(groupId: string) {
    startTransition(() => {
      setCollapsedGroups((prev) => {
        const next = new Set(prev);
        if (next.has(groupId)) next.delete(groupId); else next.add(groupId);
        return next;
      });
    });
  }

  function handleVisibilityFilterChange(value: VisibilityFilter) {
    startTransition(() => setVisibilityFilter(value));
  }

  function handleTypeFilterChange(value: TypeFilter) {
    startTransition(() => setTypeFilter(value));
  }

  function handleRulesFilterChange(value: RulesFilter) {
    startTransition(() => setRulesFilter(value));
  }

  function handleClearFilters() {
    startTransition(() => clearFilters());
  }

  function handleToggleCollapseAll() {
    startTransition(() => {
      setCollapsedGroups(allCollapsed ? new Set() : new Set(activeGroupIds));
    });
  }

  function handleCategoryGroupChange(categoryId: string, nextGroupId: string) {
    pushUndo();
    stageUpdate("categories", categoryId, { groupId: nextGroupId });
  }

  function handleGroupNameDone(id: string, value: string, action: DoneAction) {
    if (action !== "cancel" && value !== stagedGroups[id]?.entity.name) {
      pushUndo();
      stageUpdate("categoryGroups", id, { name: value });
    }
    commitCell(makeSelectionRowId("group", id), "name");
  }

  function handleCategoryNameDone(id: string, value: string, action: DoneAction) {
    if (action !== "cancel" && value !== stagedCats[id]?.entity.name) {
      pushUndo();
      stageUpdate("categories", id, { name: value });
    }
    commitCell(makeSelectionRowId("category", id), "name");
  }

  // ── Adding rows ──────────────────────────────────────────────────────────────
  function addGroup(isIncome: boolean) {
    pushUndo();
    const id = generateId();
    stageNew("categoryGroups", { id, name: "", isIncome, hidden: false, categoryIds: [] });
    setTimeout(() => startEditing(makeSelectionRowId("group", id), "name"), 0);
  }

  function addCategory(groupId: string) {
    pushUndo();
    const id = generateId();
    const group = stagedGroups[groupId];
    stageNew("categories", {
      id,
      name: "",
      groupId,
      isIncome: group?.entity.isIncome ?? false,
      hidden: false,
    });
    // Expand the group so the new row is visible
    setCollapsedGroups((prev) => { const next = new Set(prev); next.delete(groupId); return next; });
    setTimeout(() => startEditing(makeSelectionRowId("category", id), "name"), 0);
  }

  // ── Bulk delete ───────────────────────────────────────────────────────────────
  function handleBulkDelete() {
    const pendingIncomeDeletes = [...selectedIds].filter(
      (id) => stagedGroups[id]?.entity.isIncome && !stagedGroups[id]?.isDeleted
    ).length;
    const remainingIncomeAfter = incomeGroupCount - pendingIncomeDeletes;

    // Resolve what will actually be deleted (respecting last-income-group guard)
    const effectiveGroupIds: string[] = [];
    const directCatIds: string[] = [];
    let incomeSkipped = 0;

    for (const id of selectedIds) {
      if (stagedGroups[id]) {
        const g = stagedGroups[id];
        if (g.isDeleted) continue;
        if (g.entity.isIncome && remainingIncomeAfter < 1 && incomeSkipped === 0) {
          incomeSkipped++;
          continue;
        }
        effectiveGroupIds.push(id);
      } else if (stagedCats[id]) {
        if (stagedCats[id].isDeleted) continue;
        directCatIds.push(id);
      }
    }

    // All category IDs affected (children of selected groups + directly selected cats).
    // Use a Set to deduplicate: a category that is both directly selected AND a child
    // of a selected group must only be counted once.
    const implicitCatIds = effectiveGroupIds.flatMap((gid) =>
      Object.values(stagedCats)
        .filter((c) => c.entity.groupId === gid)
        .map((c) => c.entity.id)
    );
    const allCatIds = [...new Set([...directCatIds, ...implicitCatIds])];
    const serverCatIds = allCatIds.filter((id) => !stagedCats[id]?.isNew);

    const serverCount =
      effectiveGroupIds.filter((id) => !stagedGroups[id]?.isNew).length +
      directCatIds.filter((id) => !stagedCats[id]?.isNew).length;
    const newCount =
      effectiveGroupIds.filter((id) => stagedGroups[id]?.isNew).length +
      directCatIds.filter((id) => stagedCats[id]?.isNew).length;
    const totalRuleCount = allCatIds.reduce(
      (sum, id) => sum + (categoryRuleCount.get(id) ?? 0),
      0
    );
    const totalItems = effectiveGroupIds.length + directCatIds.length;

    // Capture refs for the confirm closure
    const groupsToDelete = [...effectiveGroupIds];
    const catsToDelete = [...directCatIds];

    onDeleteIntentChange({
      kind: "bulk",
      ids: serverCatIds,
      title: `Delete ${totalItems} item${totalItems !== 1 ? "s" : ""}?`,
      bulkServerCount: serverCount,
      bulkNewCount: newCount,
      bulkRuleCount: totalRuleCount,
      onConfirm: () => {
        pushUndo();
        for (const gid of groupsToDelete) {
          for (const cat of Object.values(stagedCats)) {
            if (cat.entity.groupId === gid) stageDelete("categories", cat.entity.id);
          }
          stageDelete("categoryGroups", gid);
        }
        for (const id of catsToDelete) stageDelete("categories", id);
        clearSelection();
      },
    });
  }


  const activeSelectedCount = [...selectedIds].filter((id) => {
    const g = stagedGroups[id];
    const c = stagedCats[id];
    return (g && !g.isDeleted) || (c && !c.isDeleted);
  }).length;

  // ── Row render helpers ────────────────────────────────────────────────────────
  function renderGroupRow(group: GroupRow) {
    const { entity } = group;
    const rowId = makeSelectionRowId("group", entity.id);
    const counts = groupCountById.get(entity.id) ?? { total: 0, visible: 0 };
    const groupCountLabel = counts.visible !== counts.total ? `${counts.visible}/${counts.total}` : `${counts.total}`;

    return (
      <CategoriesTableGroupRow
        row={group}
        rowId={rowId}
        highlightedId={highlightedId}
        collapsed={collapsedGroups.has(entity.id)}
        isSelected={selectedCell?.rowId === rowId}
        isEditing={editingCell?.rowId === rowId}
        isChecked={selectedIds.has(entity.id)}
        isDuplicate={duplicateGroupNames.has(entity.name.trim().toLowerCase())}
        groupCountLabel={groupCountLabel}
        hasNote={!group.isNew && rawEntityIdsWithNotes.has(entity.id)}
        incomeGroupCount={incomeGroupCount}
        editStartChar={editingCell?.rowId === rowId ? editStartChar : undefined}
        onToggleSelect={toggleSelect}
        onToggleCollapse={toggleCollapse}
        onSelectNameCell={(nextRowId) => selectCell(nextRowId, "name")}
        onStartEditingName={(nextRowId) => startEditing(nextRowId, "name")}
        onDoneName={handleGroupNameDone}
        onToggleHidden={(id, hidden) => {
          pushUndo();
          stageUpdate("categoryGroups", id, { hidden });
        }}
        onClearSaveError={(id) => clearSaveError("categoryGroups", id)}
        onRevert={(id) => revertEntity("categoryGroups", id)}
        onRequestDelete={(groupId) => {
          const groupEntity = stagedGroups[groupId]?.entity;
          if (!groupEntity) return;
          const children = Object.values(stagedCats).filter(
            (cat) => cat.entity.groupId === groupId && !cat.isDeleted
          );
          const serverChildIds = children.filter((cat) => !cat.isNew).map((cat) => cat.entity.id);
          const groupRuleCount = children.reduce(
            (sum, cat) => sum + (categoryRuleCount.get(cat.entity.id) ?? 0),
            0
          );
          const capturedChildren = [...children];
          onDeleteIntentChange({
            kind: "group",
            ids: serverChildIds,
            title: `Delete group "${groupEntity.name || "Unnamed"}"?`,
            groupName: groupEntity.name || "Unnamed",
            childCount: children.length,
            groupRuleCount,
            onConfirm: () => {
              pushUndo();
              for (const cat of capturedChildren) stageDelete("categories", cat.entity.id);
              stageDelete("categoryGroups", groupId);
            },
          });
        }}
        onInspect={(id) => onInspectTargetChange({ id, type: "categoryGroup" })}
        isAnotherCellEditing={!!editingCell}
      />
    );
  }

  function renderCategoryRow(cat: CategoryRow, group: GroupRow) {
    const { entity } = cat;
    const rowId = makeSelectionRowId("category", entity.id);

    return (
      <CategoriesTableCategoryRow
        key={entity.id}
        row={cat}
        rowId={rowId}
        highlightedId={highlightedId}
        isSelected={selectedCell?.rowId === rowId}
        isEditing={editingCell?.rowId === rowId}
        isChecked={selectedIds.has(entity.id)}
        isDuplicate={duplicateCatNames.has(entity.id)}
        hasNote={!cat.isNew && rawEntityIdsWithNotes.has(entity.id)}
        isInheritedHidden={!cat.isDeleted && group.entity.hidden}
        ruleCount={categoryRuleCount.get(entity.id) ?? 0}
        groupLabel={groupLabelById.get(entity.groupId) ?? "Unknown group"}
        groupOptions={entity.isIncome ? incomeGroupOptions : expenseGroupOptions}
        editStartChar={editingCell?.rowId === rowId ? editStartChar : undefined}
        onToggleSelect={toggleSelect}
        onSelectNameCell={(nextRowId) => selectCell(nextRowId, "name")}
        onStartEditingName={(nextRowId) => startEditing(nextRowId, "name")}
        onDoneName={handleCategoryNameDone}
        onChangeGroup={handleCategoryGroupChange}
        onToggleHidden={(id, hidden) => {
          pushUndo();
          stageUpdate("categories", id, { hidden });
        }}
        onOpenRules={(categoryId, ruleCount) => {
          if (ruleCount > 0) {
            router.push(`/rules?categoryId=${categoryId}`);
          } else if (onCreateRule) {
            onCreateRule(categoryId);
          } else {
            router.push("/rules?new=1");
          }
        }}
        onClearSaveError={(id) => clearSaveError("categories", id)}
        onRevert={(id) => revertEntity("categories", id)}
        onRequestDelete={(id) => {
          const category = stagedCats[id];
          if (!category) return;
          onDeleteIntentChange({
            kind: "single",
            ids: category.isNew ? [] : [id],
            title: "Delete category?",
            entityLabel: category.entity.name || "Unnamed",
            entityRuleCount: categoryRuleCount.get(id) ?? 0,
            onConfirm: () => {
              pushUndo();
              stageDelete("categories", id);
            },
          });
        }}
        onInspect={(id) => onInspectTargetChange({ id, type: "category" })}
        isAnotherCellEditing={!!editingCell}
      />
    );
  }

  // ── Render ───────────────────────────────────────────────────────────────────
  const incomeGroups = useMemo(
    () => allGroups.filter((g) => g.entity.isIncome),
    [allGroups]
  );
  const expenseGroups = useMemo(
    () => allGroups.filter((g) => !g.entity.isIncome),
    [allGroups]
  );

  return (
    <>
      <div ref={containerRef} className="flex min-h-0 flex-1 flex-col overflow-hidden outline-none" onKeyDown={handleGridKeyDown} tabIndex={-1}>
        <FilterBar
          search={search} onSearchChange={setSearch}
          visibilityFilter={visibilityFilter} onVisibilityChange={handleVisibilityFilterChange}
          typeFilter={typeFilter} onTypeChange={handleTypeFilterChange}
          rulesFilter={rulesFilter} onRulesFilterChange={handleRulesFilterChange}
          filteredCount={filteredCount} totalCount={totalCount}
          allCollapsed={allCollapsed}
          onToggleCollapseAll={handleToggleCollapseAll}
          selectedCount={activeSelectedCount}
          onBulkDelete={handleBulkDelete}
          onDeselect={() => clearSelection()}
        />

        <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-background">
              <tr className="border-b border-border">
                <th className="w-9 px-3 py-1.5" />
                <th className="w-1 p-0" />
                <th
                  className="cursor-pointer select-none px-2 py-1.5 text-left hover:bg-muted/30"
                  onClick={toggleSort}
                >
                  <span className="flex items-center text-xs font-medium text-muted-foreground">
                    Name
                    <SortIndicator active={sortNameDir !== null} dir={sortNameDir ?? "asc"} />
                  </span>
                </th>
                <th className="w-8 p-0">
                  <span className="sr-only">Notes</span>
                </th>
                <th className="w-48 px-2 py-1.5 text-left text-xs font-medium text-muted-foreground">Type / Group</th>
                <th className="w-36 px-2 py-1.5 text-left text-xs font-medium text-muted-foreground">Visibility</th>
                <th className="w-44 px-2 py-1.5 text-left text-xs font-medium text-muted-foreground">Rules</th>
                <th className="w-28 p-0" />
              </tr>
            </thead>

            <tbody>
              {/* ── Income section ── */}
              {(typeFilter === "all" || typeFilter === "income") && (
                <>
                  <tr>
                    <td colSpan={8} className="border-b border-border/80 bg-muted/90 px-3 py-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          Income
                        </span>                      
                      </div>
                    </td>
                  </tr>
                  {incomeGroups.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-4 py-3 text-xs text-muted-foreground">
                        <span>No income groups{search || visibilityFilter !== "all" || rulesFilter !== "all" ? " matching the current filters" : ""}.</span>
                        {(search || visibilityFilter !== "all" || rulesFilter !== "all") && (
                          <button className="ml-2 underline hover:text-foreground" onClick={handleClearFilters}>
                            Clear filters
                          </button>
                        )}
                      </td>
                    </tr>
                  )}
                  {incomeGroups.map((group) => {
                    const cats = getCategoriesForGroup(group.entity.id);
                    const collapsed = collapsedGroups.has(group.entity.id);
                    return (
                      <React.Fragment key={group.entity.id}>
                        {renderGroupRow(group)}
                        {!collapsed && cats.map((cat) => renderCategoryRow(cat, group))}
                        {!collapsed && !group.isDeleted && (
                          <tr>
                            <td colSpan={8} className="border-b border-border/80 bg-muted/90 px-3 py-1.5">
                              <button
                                onClick={() => addCategory(group.entity.id)}
                                className="text-xs text-muted-foreground hover:text-foreground"
                              >
                                + Add category
                              </button>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </>
              )}

              {/* ── Expense section ── */}
              {(typeFilter === "all" || typeFilter === "expense") && (
                <>
                  <tr>
                    <td colSpan={8} className="border-b border-border/60 bg-muted/40 px-3 py-1">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          Expense
                        </span>
                        <Button
                          variant="ghost" size="xs"
                          className="h-5 text-xs text-muted-foreground"
                          onClick={() => addGroup(false)}
                        >
                          + Add Expense group
                        </Button>
                      </div>
                    </td>
                  </tr>
                  {expenseGroups.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-4 py-3 text-xs text-muted-foreground">
                        <span>No expense groups{search || visibilityFilter !== "all" || rulesFilter !== "all" ? " matching the current filters" : ""}.</span>
                        {(search || visibilityFilter !== "all" || rulesFilter !== "all") && (
                          <button className="ml-2 underline hover:text-foreground" onClick={handleClearFilters}>
                            Clear filters
                          </button>
                        )}
                      </td>
                    </tr>
                  )}
                  {expenseGroups.map((group) => {
                    const cats = getCategoriesForGroup(group.entity.id);
                    const collapsed = collapsedGroups.has(group.entity.id);
                    return (
                      <React.Fragment key={group.entity.id}>
                        {renderGroupRow(group)}
                        {!collapsed && cats.map((cat) => renderCategoryRow(cat, group))}
                        {!collapsed && !group.isDeleted && (
                          <tr>
                            <td colSpan={8} className="border-b border-border/20 px-2 py-0.5 pl-14">
                              <button
                                onClick={() => addCategory(group.entity.id)}
                                className="text-xs text-muted-foreground hover:text-foreground"
                              >
                                + Add category
                              </button>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </>
              )}
            </tbody>
        </table>
        </div>
      </div>
    </>
  );
}
