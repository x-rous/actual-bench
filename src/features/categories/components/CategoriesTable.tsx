"use client";

import React, { useState, useRef, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  RotateCcw, Trash2, RefreshCw, Eye, EyeOff,
  ArrowUpDown, ArrowUp, ArrowDown, Search, X, AlertTriangle,
  ChevronDown, ChevronRight,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useStagedStore } from "@/store/staged";
import type { StagedEntity } from "@/types/staged";
import type { CategoryGroup, Category } from "@/types/entities";

// ─── Types ─────────────────────────────────────────────────────────────────────

type GroupRow = StagedEntity<CategoryGroup>;
type CategoryRow = StagedEntity<Category>;
type DoneAction = "down" | "up" | "tab" | "shiftTab" | "cancel" | "blur";
type SortDir = "asc" | "desc";
type VisibilityFilter = "all" | "visible" | "hidden";
type TypeFilter = "all" | "income" | "expense";
type ConfirmState = { title: string; message: string; onConfirm: () => void };
type SelectionKind = "group" | "category";
type CellId = { kind: SelectionKind; id: string };

// ─── NameInput ─────────────────────────────────────────────────────────────────

function NameInput({
  initialValue, startChar, onDone,
}: {
  initialValue: string;
  startChar?: string;
  onDone: (value: string, action: DoneAction) => void;
}) {
  const [value, setValue] = useState(startChar ?? initialValue);
  const inputRef = useRef<HTMLInputElement>(null);
  const committed = useRef(false);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    if (!startChar) el.select();
  }, [startChar]);

  function done(action: DoneAction) {
    if (committed.current) return;
    if (action !== "cancel" && value.trim() === "") {
      committed.current = true;
      onDone(initialValue, "cancel");
      return;
    }
    committed.current = true;
    onDone(value, action);
  }

  return (
    <input
      ref={inputRef}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => done("blur")}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") { e.preventDefault(); done("down"); }
        else if (e.key === "Escape") { e.preventDefault(); done("cancel"); }
        else if (e.key === "Tab") { e.preventDefault(); done(e.shiftKey ? "shiftTab" : "tab"); }
        else if (e.key === "ArrowDown") { e.preventDefault(); done("down"); }
        else if (e.key === "ArrowUp") { e.preventDefault(); done("up"); }
      }}
      className="w-full min-w-0 border-0 bg-transparent p-0 text-sm leading-6 outline-none"
    />
  );
}

// ─── PillGroup ─────────────────────────────────────────────────────────────────

function PillGroup<T extends string>({
  options, value, onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex gap-px rounded border border-border bg-muted/40 p-px">
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={cn(
            "rounded px-2 py-0.5 text-xs transition-colors",
            value === opt.value
              ? "bg-background font-medium shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

const VISIBILITY_OPTIONS: { value: VisibilityFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "visible", label: "Visible" },
  { value: "hidden", label: "Hidden" },
];

const TYPE_OPTIONS: { value: TypeFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "income", label: "Income" },
  { value: "expense", label: "Expense" },
];

// ─── FilterBar ─────────────────────────────────────────────────────────────────

function FilterBar({
  search, onSearchChange,
  visibilityFilter, onVisibilityChange,
  typeFilter, onTypeChange,
  filteredCount, totalCount,
  selectedCount,
  onBulkDelete, onDeselect,
}: {
  search: string; onSearchChange: (v: string) => void;
  visibilityFilter: VisibilityFilter; onVisibilityChange: (v: VisibilityFilter) => void;
  typeFilter: TypeFilter; onTypeChange: (v: TypeFilter) => void;
  filteredCount: number; totalCount: number;
  selectedCount: number;
  onBulkDelete: () => void;
  onDeselect: () => void;
}) {
  const hasFilters = search || visibilityFilter !== "all" || typeFilter !== "all";

  if (selectedCount > 0) {
    return (
      <div className="flex flex-wrap items-center gap-2 border-b border-border/40 bg-primary/5 px-2 py-1.5">
        <span className="text-xs font-medium text-primary">{selectedCount} selected</span>
        <Button size="xs" variant="destructive" onClick={onBulkDelete}>Delete</Button>
        <button onClick={onDeselect} className="ml-auto text-xs text-muted-foreground hover:text-foreground">
          Clear selection
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border/40 bg-muted/10 px-2 py-1.5">
      <div className="relative flex items-center">
        <Search className="absolute left-1.5 h-3.5 w-3.5 text-muted-foreground" />
        <input
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search…"
          className="h-6 w-44 rounded border border-border bg-background pl-6 pr-6 text-xs outline-none focus:ring-1 focus:ring-ring"
        />
        {search && (
          <button onClick={() => onSearchChange("")} className="absolute right-1.5 text-muted-foreground hover:text-foreground">
            <X className="h-3 w-3" />
          </button>
        )}
      </div>

      <PillGroup options={VISIBILITY_OPTIONS} value={visibilityFilter} onChange={onVisibilityChange} />
      <PillGroup options={TYPE_OPTIONS} value={typeFilter} onChange={onTypeChange} />

      {hasFilters && (
        <button
          onClick={() => { onSearchChange(""); onVisibilityChange("all"); onTypeChange("all"); }}
          className="text-xs text-muted-foreground underline hover:text-foreground"
        >
          Clear
        </button>
      )}

      <span className="ml-auto text-xs text-muted-foreground">
        {filteredCount === totalCount ? `${totalCount} rows` : `${filteredCount} of ${totalCount}`}
      </span>
    </div>
  );
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
}: {
  collapsedGroups: Set<string>;
  setCollapsedGroups: React.Dispatch<React.SetStateAction<Set<string>>>;
}) {
  // ── Filter / sort state ──────────────────────────────────────────────────────
  const [search, setSearch] = useState("");
  const [visibilityFilter, setVisibilityFilter] = useState<VisibilityFilter>("all");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [sortNameDir, setSortNameDir] = useState<SortDir | null>(null);

  // ── Editing state ────────────────────────────────────────────────────────────
  const [selectedCell, setSelectedCell] = useState<CellId | null>(null);
  const [editingCell, setEditingCell] = useState<CellId | null>(null);
  const [editStartChar, setEditStartChar] = useState<string | undefined>(undefined);

  // ── Multi-select ─────────────────────────────────────────────────────────────
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmDialog, setConfirmDialog] = useState<ConfirmState | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

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
  const categoryRuleCount = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of Object.values(stagedRules)) {
      if (s.isDeleted) continue;
      for (const part of [...s.entity.conditions, ...s.entity.actions]) {
        if (part.field === "category") {
          const ids = Array.isArray(part.value) ? part.value : [part.value];
          for (const id of ids) {
            if (typeof id === "string" && id)
              counts.set(id, (counts.get(id) ?? 0) + 1);
          }
        }
      }
    }
    return counts;
  }, [stagedRules]);

  // ── Build flat ordered list of visible groups ─────────────────────────────────
  const allGroups: GroupRow[] = useMemo(() => {
    let gs = Object.values(stagedGroups) as GroupRow[];
    const q = search.toLowerCase();
    if (typeFilter === "income") gs = gs.filter((g) => g.entity.isIncome);
    if (typeFilter === "expense") gs = gs.filter((g) => !g.entity.isIncome);
    if (visibilityFilter === "visible") gs = gs.filter((g) => !g.entity.hidden);
    if (visibilityFilter === "hidden") gs = gs.filter((g) =>
      g.entity.hidden ||
      Object.values(stagedCats).some(
        (c) => c.entity.groupId === g.entity.id && c.entity.hidden && !c.isDeleted
      )
    );
    if (q) gs = gs.filter((g) => {
      if (g.entity.name.toLowerCase().includes(q)) return true;
      // Also show group if any child category matches
      const children = Object.values(stagedCats).filter(
        (c) => c.entity.groupId === g.entity.id && c.entity.name.toLowerCase().includes(q)
      );
      return children.length > 0;
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
  }, [stagedGroups, stagedCats, search, typeFilter, visibilityFilter, sortNameDir]);

  // Categories for a given group (filtered + sorted)
  function getCategoriesForGroup(groupId: string): CategoryRow[] {
    let cats = Object.values(stagedCats).filter(
      (c) => c.entity.groupId === groupId
    ) as CategoryRow[];

    const q = search.toLowerCase();
    if (q) cats = cats.filter((c) => c.entity.name.toLowerCase().includes(q));
    if (visibilityFilter === "visible") cats = cats.filter((c) => !c.entity.hidden);
    if (visibilityFilter === "hidden") cats = cats.filter((c) => c.entity.hidden);

    if (sortNameDir) {
      cats = [...cats].sort((a, b) =>
        sortNameDir === "asc"
          ? a.entity.name.toLowerCase().localeCompare(b.entity.name.toLowerCase())
          : b.entity.name.toLowerCase().localeCompare(a.entity.name.toLowerCase())
      );
    }
    return cats;
  }

  const totalCount = Object.keys(stagedGroups).length + Object.keys(stagedCats).length;
  const filteredCount = allGroups.reduce(
    (acc, g) => acc + 1 + getCategoriesForGroup(g.entity.id).length,
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
    setSelectedCell({ kind, id });
    setEditingCell({ kind, id });
    setEditStartChar(startChar);
  }

  function handleGroupNameDone(id: string, value: string, action: DoneAction) {
    if (action !== "cancel" && value !== stagedGroups[id]?.entity.name) {
      pushUndo();
      stageUpdate("categoryGroups", id, { name: value });
    }
    setEditingCell(null);
    setEditStartChar(undefined);
    setSelectedCell({ kind: "group", id });
  }

  function handleCategoryNameDone(id: string, value: string, action: DoneAction) {
    if (action !== "cancel" && value !== stagedCats[id]?.entity.name) {
      pushUndo();
      stageUpdate("categories", id, { name: value });
    }
    setEditingCell(null);
    setEditStartChar(undefined);
    setSelectedCell({ kind: "category", id });
  }

  // ── Adding rows ──────────────────────────────────────────────────────────────
  function addGroup(isIncome: boolean) {
    pushUndo();
    const id = crypto.randomUUID();
    stageNew("categoryGroups", { id, name: "", isIncome, hidden: false, categoryIds: [] });
    setTimeout(() => startEditing("group", id), 0);
  }

  function addCategory(groupId: string) {
    pushUndo();
    const id = crypto.randomUUID();
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
    const count = selectedIds.size;
    setConfirmDialog({
      title: `Delete ${count} item${count !== 1 ? "s" : ""}?`,
      message: "Staged deletions will be removed on Save. Deleting a group will also delete its categories.",
      onConfirm: () => {
        pushUndo();
        for (const id of selectedIds) {
          if (stagedGroups[id]) {
            // Also delete all child categories of this group
            for (const cat of Object.values(stagedCats)) {
              if (cat.entity.groupId === id) stageDelete("categories", cat.entity.id);
            }
            stageDelete("categoryGroups", id);
          } else if (stagedCats[id]) {
            stageDelete("categories", id);
          }
        }
        setSelectedIds(new Set());
      },
    });
  }

  function toggleSelect(id: string, checked: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id); else next.delete(id);
      return next;
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
        className={cn(
          "group/row border-b border-border/40 bg-muted/20",
          isChecked && "bg-primary/5",
          saveError && !isChecked && "bg-destructive/5",
          !saveError && !isChecked && isDeleted && "opacity-50",
          !saveError && !isChecked && !isDeleted && isNew && "bg-green-50/40 dark:bg-green-950/10",
          !saveError && !isChecked && !isDeleted && !isNew && isUpdated && "bg-amber-50/40 dark:bg-amber-950/10",
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
          onClick={() => isSelected && !isDeleted ? startEditing("group", entity.id) : setSelectedCell({ kind: "group", id: entity.id })}
          onFocus={() => { if (!editingCell) setSelectedCell({ kind: "group", id: entity.id }); }}
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
                </span>
                {saveError && (
                  <span className="text-xs text-destructive leading-tight pb-0.5">{saveError}</span>
                )}
              </div>
            )}
          </div>
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
                <Button
                  variant="ghost" size="icon-xs" title="Delete group"
                  className="text-destructive hover:text-destructive"
                  onClick={() => {
                    pushUndo();
                    // Stage-delete all child categories too
                    for (const cat of Object.values(stagedCats)) {
                      if (cat.entity.groupId === entity.id) stageDelete("categories", cat.entity.id);
                    }
                    stageDelete("categoryGroups", entity.id);
                  }}
                >
                  <Trash2 />
                </Button>
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
        className={cn(
          "group/row border-b border-border/20",
          isChecked && "bg-primary/5",
          saveError && !isChecked && "bg-destructive/5",
          !saveError && !isChecked && isDeleted && "opacity-50",
          !saveError && !isChecked && !isDeleted && isNew && "bg-green-50/30 dark:bg-green-950/10",
          !saveError && !isChecked && !isDeleted && !isNew && isUpdated && "bg-amber-50/30 dark:bg-amber-950/10",
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
          onClick={() => isSelected && !isDeleted ? startEditing("category", entity.id) : setSelectedCell({ kind: "category", id: entity.id })}
          onFocus={() => { if (!editingCell) setSelectedCell({ kind: "category", id: entity.id }); }}
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
                onClick={() => router.push(count > 0 ? `/rules?categoryId=${entity.id}` : "/rules?new=1")}
                title={count > 0 ? "View rules for this category" : "Go to rules to create a rule"}
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
                <Button
                  variant="ghost" size="icon-xs" title="Delete category"
                  className="text-destructive hover:text-destructive"
                  onClick={() => { pushUndo(); stageDelete("categories", entity.id); }}
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
      <div ref={containerRef} className="flex flex-col outline-none" onKeyDown={handleKeyDown} tabIndex={-1}>
        <FilterBar
          search={search} onSearchChange={setSearch}
          visibilityFilter={visibilityFilter} onVisibilityChange={setVisibilityFilter}
          typeFilter={typeFilter} onTypeChange={setTypeFilter}
          filteredCount={filteredCount} totalCount={totalCount}
          selectedCount={activeSelectedCount}
          onBulkDelete={handleBulkDelete}
          onDeselect={() => setSelectedIds(new Set())}
        />

        <div className="overflow-auto">
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
                    <td colSpan={7} className="border-b border-border/60 bg-muted/40 px-3 py-1">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          Income
                        </span>
                        <Button
                          variant="ghost" size="xs"
                          className="h-5 text-xs text-muted-foreground"
                          onClick={() => addGroup(true)}
                        >
                          + Add group
                        </Button>
                      </div>
                    </td>
                  </tr>
                  {incomeGroups.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-4 py-3 text-xs text-muted-foreground">
                        No income groups{search ? " matching the search" : ""}.
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
                            <td colSpan={7} className="border-b border-border/20 px-2 py-0.5 pl-14">
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
                    <td colSpan={7} className="border-b border-border/60 bg-muted/40 px-3 py-1">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          Expense
                        </span>
                        <Button
                          variant="ghost" size="xs"
                          className="h-5 text-xs text-muted-foreground"
                          onClick={() => addGroup(false)}
                        >
                          + Add group
                        </Button>
                      </div>
                    </td>
                  </tr>
                  {expenseGroups.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-4 py-3 text-xs text-muted-foreground">
                        No expense groups{search ? " matching the search" : ""}.
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
                            <td colSpan={7} className="border-b border-border/20 px-2 py-0.5 pl-14">
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
