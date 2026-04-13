"use client";

import React, { useState, useRef, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useHighlight } from "@/hooks/useHighlight";
import { useInlineEdit } from "@/hooks/useInlineEdit";
import { useNotesIndex } from "@/hooks/useNotesIndex";
import { useTableSelection } from "@/hooks/useTableSelection";
import { useTransactionCountsForIds } from "@/hooks/useTransactionCountsForIds";
import { EntityNoteButton } from "@/components/ui/entity-note-button";
import { NameInput } from "@/components/ui/editable-cell";
import type { DoneAction } from "@/components/ui/editable-cell";
import {
  RotateCcw, Trash2, RefreshCw, Eye, EyeOff,
  ArrowUpDown, ArrowUp, ArrowDown, AlertTriangle,
  ChevronDown, ChevronRight, Info,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { ConfirmState } from "@/components/ui/confirm-dialog";
import { cn } from "@/lib/utils";
import { useStagedStore } from "@/store/staged";
import { generateId } from "@/lib/uuid";
import { buildRuleReferenceMap } from "@/lib/referenceCheck";
import {
  buildCategoryDeleteWarning,
  buildCategoryGroupDeleteWarning,
  buildCategoryBulkDeleteWarning,
} from "@/lib/usageWarnings";
import { UsageInspectorDrawer } from "@/features/usage-inspector/components/UsageInspectorDrawer";
import type { EntityUsageData } from "@/features/usage-inspector/types";
import type { StagedEntity } from "@/types/staged";
import type { CategoryGroup, Category } from "@/types/entities";
import { FilterBar } from "./FilterBar";
import type { VisibilityFilter, TypeFilter, RulesFilter, SortDir } from "./FilterBar";

// ─── Delete intent ────────────────────────────────────────────────────────────

type DeleteIntent = {
  /** Server-side category IDs for $oneof tx-count query. */
  ids: string[];
  title: string;
  onConfirm: () => void;
  // Category single delete
  entityLabel?: string;
  entityRuleCount?: number;
  // Group single delete
  groupName?: string;
  childCount?: number;
  groupRuleCount?: number;
  // Bulk delete
  bulkServerCount?: number;
  bulkNewCount?: number;
  bulkRuleCount?: number;
};

// ─── Types ─────────────────────────────────────────────────────────────────────

type GroupRow = StagedEntity<CategoryGroup>;
type CategoryRow = StagedEntity<Category>;
type SelectionKind = "group" | "category";
type CellId = { kind: SelectionKind; id: string };

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
}: {
  collapsedGroups: Set<string>;
  setCollapsedGroups: React.Dispatch<React.SetStateAction<Set<string>>>;
  onCreateRule?: (categoryId: string) => void;
}) {
  // ── Filter / sort state ──────────────────────────────────────────────────────
  const [search, setSearch] = useState("");
  const [visibilityFilter, setVisibilityFilter] = useState<VisibilityFilter>("all");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [rulesFilter, setRulesFilter] = useState<RulesFilter>("all");
  const [sortNameDir, setSortNameDir] = useState<SortDir | null>(null);

  // ── Editing state ────────────────────────────────────────────────────────────
  const {
    selectedCell, editingCell, editStartChar,
    selectCell, startEdit, commitEdit,
  } = useInlineEdit<CellId>();

  // ── Multi-select ─────────────────────────────────────────────────────────────
  const { selectedIds, toggleSelect, clearSelection } = useTableSelection();
  const [deleteIntent, setDeleteIntent] = useState<DeleteIntent | null>(null);
  const [inspectTarget, setInspectTarget] = useState<{ id: string; type: EntityUsageData["entityType"] } | null>(null);

  const containerRef  = useRef<HTMLDivElement>(null);
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

  // ── Lazy tx counts for delete confirm dialogs ─────────────────────────────────
  const { data: txCounts, isLoading: txLoading } = useTransactionCountsForIds(
    "category",
    deleteIntent?.ids ?? [],
    { enabled: !!deleteIntent && deleteIntent.ids.length > 0 }
  );

  const txTotal = deleteIntent?.ids.length
    ? (txCounts ? [...txCounts.values()].reduce((a, b) => a + b, 0) : undefined)
    : 0;

  const confirmState: ConfirmState | null = deleteIntent
    ? {
        title: deleteIntent.title,
        message:
          deleteIntent.bulkServerCount !== undefined
            ? buildCategoryBulkDeleteWarning(
                deleteIntent.bulkServerCount,
                deleteIntent.bulkNewCount ?? 0,
                deleteIntent.bulkRuleCount ?? 0,
                txTotal,
                txLoading && deleteIntent.ids.length > 0
              )
            : deleteIntent.groupName !== undefined
              ? buildCategoryGroupDeleteWarning(
                  deleteIntent.groupName,
                  deleteIntent.childCount ?? 0,
                  deleteIntent.groupRuleCount ?? 0,
                  txTotal,
                  txLoading && deleteIntent.ids.length > 0
                )
              : buildCategoryDeleteWarning(
                  deleteIntent.entityLabel ?? "",
                  deleteIntent.entityRuleCount ?? 0,
                  txTotal,
                  txLoading && deleteIntent.ids.length > 0
                ),
        onConfirm: deleteIntent.onConfirm,
      }
    : null;

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
    const q = search.toLowerCase();
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
  }, [allCatsByGroup, search, visibilityFilter, sortNameDir]);

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
    const q = search.toLowerCase();
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
  }, [stagedGroups, allCatsByGroup, search, typeFilter, visibilityFilter, sortNameDir]);

  const incomeGroupCount = Object.values(stagedGroups).filter((g) => !g.isDeleted && g.entity.isIncome).length;

  const totalCount = Object.keys(stagedGroups).length + Object.keys(stagedCats).length;
  const filteredCount = allGroups.reduce(
    (acc, g) => acc + 1 + (visibleCatsByGroup.get(g.entity.id)?.length ?? 0),
    0
  );

  function toggleSort() {
    setSortNameDir((prev) =>
      prev === null ? "asc" : prev === "asc" ? "desc" : null
    );
  }

  function toggleCollapse(groupId: string) {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId); else next.add(groupId);
      return next;
    });
  }

  // ── Focus management ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!selectedCell || editingCell) return;
    containerRef.current
      ?.querySelector<HTMLElement>(`[data-cell="${selectedCell.kind}:${selectedCell.id}"]`)
      ?.focus({ preventScroll: false });
  }, [selectedCell, editingCell]);

  // ── Editing ──────────────────────────────────────────────────────────────────
  function startEditing(kind: SelectionKind, id: string, startChar?: string) {
    startEdit({ kind, id }, startChar);
  }

  function handleGroupNameDone(id: string, value: string, action: DoneAction) {
    if (action !== "cancel" && value !== stagedGroups[id]?.entity.name) {
      pushUndo();
      stageUpdate("categoryGroups", id, { name: value });
    }
    commitEdit({ kind: "group", id });
  }

  function handleCategoryNameDone(id: string, value: string, action: DoneAction) {
    if (action !== "cancel" && value !== stagedCats[id]?.entity.name) {
      pushUndo();
      stageUpdate("categories", id, { name: value });
    }
    commitEdit({ kind: "category", id });
  }

  // ── Adding rows ──────────────────────────────────────────────────────────────
  function addGroup(isIncome: boolean) {
    pushUndo();
    const id = generateId();
    stageNew("categoryGroups", { id, name: "", isIncome, hidden: false, categoryIds: [] });
    setTimeout(() => startEditing("group", id), 0);
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
    setTimeout(() => startEditing("category", id), 0);
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

    setDeleteIntent({
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
    const { entity, isNew, isUpdated, isDeleted, saveError } = group;
    const collapsed = collapsedGroups.has(entity.id);
    const isSelected = selectedCell?.kind === "group" && selectedCell?.id === entity.id;
    const isEditing = editingCell?.kind === "group" && editingCell?.id === entity.id;
    const isChecked = selectedIds.has(entity.id);
    const isDuplicate = duplicateGroupNames.has(entity.name.trim().toLowerCase());

    return (
      <tr
        key={`g-${entity.id}`}
        data-row-id={entity.id}
        className={cn(
          "group/row border-b border-border/40 border-l-2 border-l-transparent bg-muted/20 transition-colors",
          highlightedId === entity.id && "bg-primary/20 ring-2 ring-inset ring-primary/40",
          highlightedId !== entity.id && isChecked && "bg-primary/10",
          highlightedId !== entity.id && !isChecked && saveError && "bg-destructive/5 border-l-destructive",
          highlightedId !== entity.id && !isChecked && !saveError && isDeleted && "opacity-50 border-l-muted-foreground/30",
          highlightedId !== entity.id && !isChecked && !saveError && !isDeleted && isNew && "bg-green-50/40 dark:bg-green-950/10 border-l-green-500",
          highlightedId !== entity.id && !isChecked && !saveError && !isDeleted && !isNew && isUpdated && "bg-amber-50/40 dark:bg-amber-950/10 border-l-amber-400",
        )}
      >
        {/* Checkbox */}
        <td className="w-9 px-3 py-0.5">
          <input
            type="checkbox"
            checked={isChecked}
            onChange={(e) => toggleSelect(entity.id, e.target.checked)}
            onClick={(e) => e.stopPropagation()}
            className="h-3.5 w-3.5 cursor-pointer rounded accent-primary"
          />
        </td>

        {/* State indicator */}
        <td className="w-1 p-0 pl-0.5">
          <div className={cn(
            "h-4 w-0.5 rounded-full",
            saveError && "bg-destructive",
            !saveError && isDeleted && "bg-muted-foreground/30",
            !saveError && !isDeleted && isNew && "bg-green-500",
            !saveError && !isDeleted && !isNew && isUpdated && "bg-amber-400",
          )} />
        </td>

        {/* Collapse toggle + Name */}
        <td
          data-cell={`group:${entity.id}`}
          tabIndex={isSelected ? 0 : -1}
          className={cn(
            "cursor-default px-2 py-0.5 outline-none",
            isSelected && !isEditing && "bg-primary/10 ring-1 ring-inset ring-primary/50",
            isEditing && "ring-1 ring-inset ring-primary",
          )}
          onClick={() => isSelected && !isDeleted ? startEditing("group", entity.id) : selectCell({ kind: "group", id: entity.id })}
          onFocus={() => { if (!editingCell) selectCell({ kind: "group", id: entity.id }); }}
        >
          <div className="flex items-center gap-1">
            <button
              onClick={(e) => { e.stopPropagation(); toggleCollapse(entity.id); }}
              className="shrink-0 text-muted-foreground hover:text-foreground"
            >
              {collapsed
                ? <ChevronRight className="h-3.5 w-3.5" />
                : <ChevronDown className="h-3.5 w-3.5" />}
            </button>
            {isEditing ? (
              <NameInput
                initialValue={entity.name}
                startChar={editStartChar}
                onDone={(val, action) => handleGroupNameDone(entity.id, val, action)}
              />
            ) : (
              <div className="flex flex-col">
                <span className={cn(
                  "flex items-center gap-1 text-sm font-medium leading-6",
                  isDeleted && "line-through",
                  !entity.name && "text-xs italic font-normal text-muted-foreground/60",
                )}>
                  {entity.name || "empty name"}
                  {isDuplicate && <AlertTriangle className="h-3 w-3 shrink-0 text-amber-500" aria-label="Duplicate name" />}
                  {!isDeleted && (() => {
                    const total = (allCatsByGroup.get(entity.id) ?? []).filter((c) => !c.isDeleted).length;
                    const visible = (visibleCatsByGroup.get(entity.id) ?? []).filter((c) => !c.isDeleted).length;
                    const label = visible !== total ? `${visible}/${total}` : `${total}`;
                    return (
                      <span className="text-xs font-normal text-muted-foreground">({label})</span>
                    );
                  })()}
                </span>
                {saveError && (
                  <span className="text-xs text-destructive leading-tight pb-0.5">{saveError}</span>
                )}
              </div>
            )}
          </div>
        </td>

        {/* Note */}
        <td className="w-8 px-0 py-0.5 text-center">
          {!isNew && rawEntityIdsWithNotes.has(entity.id) && (
            <EntityNoteButton
              entityId={entity.id}
              entityKind="category"
              entityLabel={entity.name || "Unnamed group"}
              entityTypeLabel="Category group"
              className="mx-auto"
            />
          )}
        </td>

        {/* Type badge */}
        <td className="w-48 px-2 py-0.5">
          <Badge variant={entity.isIncome ? "status-active" : "secondary"} className="text-xs font-normal">
            {entity.isIncome ? "Income" : "Expense"}
          </Badge>
        </td>

        {/* Hidden toggle */}
        <td className="w-36 px-2 py-0.5">
          <button
            disabled={isDeleted}
            onClick={() => { pushUndo(); stageUpdate("categoryGroups", entity.id, { hidden: !entity.hidden }); }}
            className={cn(
              "flex items-center gap-1 text-xs transition-colors",
              entity.hidden ? "text-amber-600" : "text-muted-foreground hover:text-foreground",
              isDeleted && "cursor-default opacity-50",
            )}
          >
            {entity.hidden
              ? <><EyeOff className="h-3 w-3" /> Hidden</>
              : <><Eye className="h-3 w-3" /> Visible</>}
          </button>
        </td>

        {/* Rules (groups don't have direct rule associations) */}
        <td className="w-44 px-2 py-0.5" />

        {/* Actions */}
        <td className="w-28 px-1 py-0.5">
          <div className="flex items-center justify-end gap-0.5 opacity-0 transition-opacity group-hover/row:opacity-100">
            {saveError ? (
              <Button variant="ghost" size="icon-xs" title="Clear error and retry" onClick={() => clearSaveError("categoryGroups", entity.id)}>
                <RefreshCw />
              </Button>
            ) : isDeleted ? (
              <Button variant="ghost" size="icon-xs" title="Undo delete" onClick={() => revertEntity("categoryGroups", entity.id)}>
                <RotateCcw />
              </Button>
            ) : (
              <>
                <Button variant="ghost" size="icon-xs" title="Inspect usage" aria-label="Inspect usage"
                  onClick={() => setInspectTarget({ id: entity.id, type: "categoryGroup" })}>
                  <Info />
                </Button>
                {!(entity.isIncome && incomeGroupCount <= 1) && (
                  <Button
                    variant="ghost" size="icon-xs" title="Delete group"
                    className="text-destructive hover:text-destructive"
                    onClick={() => {
                      const children = Object.values(stagedCats).filter(
                        (cat) => cat.entity.groupId === entity.id && !cat.isDeleted
                      );
                      const serverChildIds = children
                        .filter((cat) => !cat.isNew)
                        .map((cat) => cat.entity.id);
                      const groupRuleCount = children.reduce(
                        (sum, cat) => sum + (categoryRuleCount.get(cat.entity.id) ?? 0),
                        0
                      );
                      const capturedChildren = [...children];
                      setDeleteIntent({
                        ids: serverChildIds,
                        title: `Delete group "${entity.name || "Unnamed"}"?`,
                        groupName: entity.name || "Unnamed",
                        childCount: children.length,
                        groupRuleCount,
                        onConfirm: () => {
                          pushUndo();
                          for (const cat of capturedChildren) stageDelete("categories", cat.entity.id);
                          stageDelete("categoryGroups", entity.id);
                        },
                      });
                    }}
                  >
                    <Trash2 />
                  </Button>
                )}
                {(isNew || isUpdated) && (
                  <Button variant="ghost" size="icon-xs" title="Revert" onClick={() => revertEntity("categoryGroups", entity.id)}>
                    <RotateCcw />
                  </Button>
                )}
              </>
            )}
          </div>
        </td>
      </tr>
    );
  }

  function renderCategoryRow(cat: CategoryRow, group: GroupRow) {
    const { entity, isNew, isUpdated, isDeleted, saveError } = cat;
    const isSelected = selectedCell?.kind === "category" && selectedCell?.id === entity.id;
    const isEditing = editingCell?.kind === "category" && editingCell?.id === entity.id;
    const isChecked = selectedIds.has(entity.id);
    const isDuplicate = duplicateCatNames.has(entity.id);
    const isInheritedHidden = !isDeleted && group.entity.hidden;

    return (
      <tr
        key={`c-${entity.id}`}
        data-row-id={entity.id}
        className={cn(
          "group/row border-b border-border/20 border-l-2 border-l-transparent transition-colors",
          highlightedId === entity.id && "bg-primary/20 ring-2 ring-inset ring-primary/40",
          highlightedId !== entity.id && isChecked && "bg-primary/10",
          highlightedId !== entity.id && !isChecked && saveError && "bg-destructive/5 border-l-destructive",
          highlightedId !== entity.id && !isChecked && !saveError && isDeleted && "opacity-50 border-l-muted-foreground/30",
          highlightedId !== entity.id && !isChecked && !saveError && !isDeleted && isNew && "bg-green-50/30 dark:bg-green-950/10 border-l-green-500",
          highlightedId !== entity.id && !isChecked && !saveError && !isDeleted && !isNew && isUpdated && "bg-amber-50/30 dark:bg-amber-950/10 border-l-amber-400",
        )}
      >
        {/* Checkbox */}
        <td className="w-9 px-3 py-0.5">
          <input
            type="checkbox"
            checked={isChecked}
            onChange={(e) => toggleSelect(entity.id, e.target.checked)}
            onClick={(e) => e.stopPropagation()}
            className="h-3.5 w-3.5 cursor-pointer rounded accent-primary"
          />
        </td>

        {/* State indicator */}
        <td className="w-1 p-0 pl-0.5">
          <div className={cn(
            "h-4 w-0.5 rounded-full",
            saveError && "bg-destructive",
            !saveError && isDeleted && "bg-muted-foreground/30",
            !saveError && !isDeleted && isNew && "bg-green-500",
            !saveError && !isDeleted && !isNew && isUpdated && "bg-amber-400",
          )} />
        </td>

        {/* Indented name */}
        <td
          data-cell={`category:${entity.id}`}
          tabIndex={isSelected ? 0 : -1}
          className={cn(
            "cursor-default px-2 py-0.5 outline-none",
            isSelected && !isEditing && "bg-primary/10 ring-1 ring-inset ring-primary/50",
            isEditing && "ring-1 ring-inset ring-primary",
          )}
          onClick={() => isSelected && !isDeleted ? startEditing("category", entity.id) : selectCell({ kind: "category", id: entity.id })}
          onFocus={() => { if (!editingCell) selectCell({ kind: "category", id: entity.id }); }}
        >
          <div className="flex items-center gap-1 pl-6">
            {isEditing ? (
              <NameInput
                initialValue={entity.name}
                startChar={editStartChar}
                onDone={(val, action) => handleCategoryNameDone(entity.id, val, action)}
              />
            ) : (
              <div className="flex flex-col">
                <span className={cn(
                  "flex items-center gap-1 leading-6",
                  isDeleted && "line-through",
                  !entity.name && "text-xs italic text-muted-foreground/60",
                )}>
                  {entity.name || "empty name"}
                  {isDuplicate && <AlertTriangle className="h-3 w-3 shrink-0 text-amber-500" aria-label="Duplicate name" />}
                </span>
                {saveError && (
                  <span className="text-xs text-destructive leading-tight pb-0.5">{saveError}</span>
                )}
              </div>
            )}
          </div>
        </td>

        {/* Note */}
        <td className="w-8 px-0 py-0.5 text-center">
          {!isNew && rawEntityIdsWithNotes.has(entity.id) && (
            <EntityNoteButton
              entityId={entity.id}
              entityKind="category"
              entityLabel={entity.name || "Unnamed category"}
              entityTypeLabel="Category"
              className="mx-auto"
            />
          )}
        </td>

        {/* Move to group */}
        <td className="w-60 px-2 py-0.5">
          {!isDeleted && (
            <select
              className="h-6 w-full rounded border border-border bg-background px-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              value={entity.groupId}
              onChange={(e) => {
                if (e.target.value !== entity.groupId) {
                  pushUndo();
                  stageUpdate("categories", entity.id, { groupId: e.target.value });
                }
              }}
            >
              {Object.values(stagedGroups)
                .filter((g) => !g.isDeleted)
                .map((g) => (
                  <option key={g.entity.id} value={g.entity.id}>
                    {g.entity.name}
                  </option>
                ))}
            </select>
          )}
        </td>

        {/* Hidden toggle */}
        <td className="w-36 px-2 py-0.5">
          {isInheritedHidden ? (
            <span
              className="flex items-center gap-1 text-xs text-amber-500/70 cursor-default"
              title="Hidden because the group is hidden — unhide the group first"
            >
              <EyeOff className="h-3 w-3" />
              Hidden - Inherited
            </span>
          ) : (
            <button
              disabled={isDeleted}
              onClick={() => { pushUndo(); stageUpdate("categories", entity.id, { hidden: !entity.hidden }); }}
              className={cn(
                "flex items-center gap-1 text-xs transition-colors",
                entity.hidden ? "text-amber-600" : "text-muted-foreground hover:text-foreground",
                isDeleted && "cursor-default opacity-50",
              )}
            >
              {entity.hidden
                ? <><EyeOff className="h-3 w-3" /> Hidden</>
                : <><Eye className="h-3 w-3" /> Visible</>}
            </button>
          )}
        </td>

        {/* Rules */}
        <td className="w-44 px-2 py-0.5">
          {!isDeleted && (() => {
            const count = categoryRuleCount.get(entity.id) ?? 0;
            const label = count === 0
              ? "create rule"
              : count === 1
                ? "1 associated rule"
                : `${count} associated rules`;
            return (
              <button
                className="inline-flex items-center rounded bg-purple-100 px-1.5 py-0.5 text-xs font-medium text-purple-700 hover:bg-purple-200 dark:bg-purple-900/40 dark:text-purple-300 dark:hover:bg-purple-900/60"
                onClick={() => count > 0
                  ? router.push(`/rules?categoryId=${entity.id}`)
                  : onCreateRule ? onCreateRule(entity.id) : router.push("/rules?new=1")}
                title={count > 0 ? "View rules for this category" : "Create a rule for this category"}
              >
                {label}
              </button>
            );
          })()}
        </td>

        {/* Actions */}
        <td className="w-28 px-1 py-0.5">
          <div className="flex items-center justify-end gap-0.5 opacity-0 transition-opacity group-hover/row:opacity-100">
            {saveError ? (
              <Button variant="ghost" size="icon-xs" title="Clear error and retry" onClick={() => clearSaveError("categories", entity.id)}>
                <RefreshCw />
              </Button>
            ) : isDeleted ? (
              <Button variant="ghost" size="icon-xs" title="Undo delete" onClick={() => revertEntity("categories", entity.id)}>
                <RotateCcw />
              </Button>
            ) : (
              <>
                <Button variant="ghost" size="icon-xs" title="Inspect usage" aria-label="Inspect usage"
                  onClick={() => setInspectTarget({ id: entity.id, type: "category" })}>
                  <Info />
                </Button>
                <Button
                  variant="ghost" size="icon-xs" title="Delete category"
                  className="text-destructive hover:text-destructive"
                  onClick={() => {
                    setDeleteIntent({
                      ids: isNew ? [] : [entity.id],
                      title: "Delete category?",
                      entityLabel: entity.name || "Unnamed",
                      entityRuleCount: categoryRuleCount.get(entity.id) ?? 0,
                      onConfirm: () => { pushUndo(); stageDelete("categories", entity.id); },
                    });
                  }}
                >
                  <Trash2 />
                </Button>
                {(isNew || isUpdated) && (
                  <Button variant="ghost" size="icon-xs" title="Revert" onClick={() => revertEntity("categories", entity.id)}>
                    <RotateCcw />
                  </Button>
                )}
              </>
            )}
          </div>
        </td>
      </tr>
    );
  }

  // ── Keyboard handler ─────────────────────────────────────────────────────────
  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (!selectedCell) return;
    if (editingCell?.kind === selectedCell.kind && editingCell?.id === selectedCell.id) return;

    const { kind, id } = selectedCell;

    if (kind === "group") {
      const row = stagedGroups[id];
      if (!row) return;
      switch (e.key) {
        case "Enter": case "F2":
          e.preventDefault();
          if (!row.isDeleted) startEditing("group", id);
          break;
        default:
          if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !row.isDeleted)
            startEditing("group", id, e.key);
      }
    } else {
      const row = stagedCats[id];
      if (!row) return;
      switch (e.key) {
        case "Enter": case "F2":
          e.preventDefault();
          if (!row.isDeleted) startEditing("category", id);
          break;
        default:
          if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !row.isDeleted)
            startEditing("category", id, e.key);
      }
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────────
  const incomeGroups = allGroups.filter((g) => g.entity.isIncome);
  const expenseGroups = allGroups.filter((g) => !g.entity.isIncome);

  return (
    <>
      <div ref={containerRef} className="flex min-h-0 flex-1 flex-col overflow-hidden outline-none" onKeyDown={handleKeyDown} tabIndex={-1}>
        <FilterBar
          search={search} onSearchChange={setSearch}
          visibilityFilter={visibilityFilter} onVisibilityChange={setVisibilityFilter}
          typeFilter={typeFilter} onTypeChange={setTypeFilter}
          rulesFilter={rulesFilter} onRulesFilterChange={setRulesFilter}
          filteredCount={filteredCount} totalCount={totalCount}
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
                          <button className="ml-2 underline hover:text-foreground" onClick={() => { setSearch(""); setVisibilityFilter("all"); setRulesFilter("all"); }}>
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
                          <button className="ml-2 underline hover:text-foreground" onClick={() => { setSearch(""); setVisibilityFilter("all"); setRulesFilter("all"); }}>
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

      <ConfirmDialog
        open={!!deleteIntent}
        onOpenChange={(open) => { if (!open) setDeleteIntent(null); }}
        state={confirmState}
      />

      <UsageInspectorDrawer
        entityId={inspectTarget?.id ?? null}
        entityType={inspectTarget?.type ?? null}
        open={!!inspectTarget}
        onOpenChange={(open) => { if (!open) setInspectTarget(null); }}
      />
    </>
  );
}
