"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useHighlight } from "@/hooks/useHighlight";
import { useTableSelection } from "@/hooks/useTableSelection";
import { Pencil, Trash2, RotateCcw, Copy, AlertTriangle, CalendarDays } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useStagedStore } from "@/store/staged";
import { generateId } from "@/lib/uuid";
import { rulePreview } from "../utils/rulePreview";
import type { EntityMaps } from "../utils/rulePreview";
import { STAGE_LABELS } from "../utils/ruleFields";
import { FilterBar } from "./FilterBar";
import type { StageFilter, ActionTypeFilter } from "./FilterBar";
import { ConditionChip, ActionChip } from "./RuleChips";
import type { StagedEntity } from "@/types/staged";
import type { Rule } from "@/types/entities";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Empty or missing stage is treated as "default". */
function normalizeStage(stage: string | null | undefined): string {
  return stage || "default";
}

function stageBadgeVariant(stage: string) {
  if (stage === "pre") return "status-warning" as const;
  if (stage === "post") return "status-inactive" as const;
  return "status-active" as const;
}

// ─── RulesTable ───────────────────────────────────────────────────────────────

type Props = {
  onEdit: (id: string) => void;
  /** Called with the selected rule IDs when the user clicks "Merge selected". */
  onMerge: (ids: string[]) => void;
  /** When set, only rules that reference this payee ID in a condition or action are shown. */
  payeeId?: string | null;
  /** When set, only rules that reference this category ID in a condition or action are shown. */
  categoryId?: string | null;
  /** When set, only rules that reference this account ID in a condition or action are shown. */
  accountId?: string | null;
};

export function RulesTable({ onEdit, onMerge, payeeId, categoryId, accountId }: Props) {
  const stagedRules = useStagedStore((s) => s.rules);
  const payees = useStagedStore((s) => s.payees);
  const categories = useStagedStore((s) => s.categories);
  const accounts = useStagedStore((s) => s.accounts);
  const categoryGroups = useStagedStore((s) => s.categoryGroups);
  const schedules = useStagedStore((s) => s.schedules);
  const stageDelete = useStagedStore((s) => s.stageDelete);
  const stageNew = useStagedStore((s) => s.stageNew);
  const revertEntity = useStagedStore((s) => s.revertEntity);
  const clearSaveError = useStagedStore((s) => s.clearSaveError);
  const pushUndo = useStagedStore((s) => s.pushUndo);

  const router        = useRouter();
  const highlightedId = useHighlight();

  const [stageFilter, setStageFilter] = useState<StageFilter>("all");
  const [actionTypeFilter, setActionTypeFilter] = useState<ActionTypeFilter>("all");
  const [search, setSearch] = useState("");
  const { selectedIds, toggleSelect, toggleSelectAll: _toggleSelectAll, clearSelection } = useTableSelection();

  const entityMaps = useMemo<EntityMaps>(
    () => ({ payees, categories, accounts, categoryGroups, schedules }),
    [payees, categories, accounts, categoryGroups, schedules]
  );

  // Pre-compute previews once when rules or entity maps change so the search
  // filter doesn't recompute them on every keystroke.
  const rulePreviews = useMemo<Map<string, string>>(() => {
    const map = new Map<string, string>();
    for (const s of Object.values(stagedRules)) {
      if (!s.isDeleted) {
        map.set(s.entity.id, rulePreview(s.entity, entityMaps).toLowerCase());
      }
    }
    return map;
  }, [stagedRules, entityMaps]);

  const rows = useMemo<StagedEntity<Rule>[]>(() => {
    const q = search.trim().toLowerCase();
    return Object.values(stagedRules).filter((s) => {
      if (s.isDeleted) return false;
      if (stageFilter !== "all" && normalizeStage(s.entity.stage) !== stageFilter) return false;
      if (actionTypeFilter !== "all") {
        const hasAction = s.entity.actions.some((a) => a.field === actionTypeFilter);
        if (!hasAction) return false;
      }
      if (payeeId) {
        const parts = [...s.entity.conditions, ...s.entity.actions];
        const hasPayee = parts.some((part) => {
          if (part.field !== "payee" && part.field !== "imported_payee") return false;
          const ids = Array.isArray(part.value) ? part.value : [part.value];
          return ids.includes(payeeId);
        });
        if (!hasPayee) return false;
      }
      if (categoryId) {
        const parts = [...s.entity.conditions, ...s.entity.actions];
        const hasCategory = parts.some((part) => {
          if (part.field !== "category") return false;
          const ids = Array.isArray(part.value) ? part.value : [part.value];
          return ids.includes(categoryId);
        });
        if (!hasCategory) return false;
      }
      if (accountId) {
        const parts = [...s.entity.conditions, ...s.entity.actions];
        const hasAccount = parts.some((part) => {
          if (part.field !== "account") return false;
          const ids = Array.isArray(part.value) ? part.value : [part.value];
          return ids.includes(accountId);
        });
        if (!hasAccount) return false;
      }
      if (q && !(rulePreviews.get(s.entity.id) ?? "").includes(q)) return false;
      return true;
    });
  }, [stagedRules, stageFilter, actionTypeFilter, payeeId, categoryId, accountId, search, rulePreviews]);

  function handleDelete(id: string) {
    pushUndo();
    stageDelete("rules", id);
  }

  function handleDuplicate(rule: Rule) {
    pushUndo();
    stageNew("rules", { ...structuredClone(rule), id: generateId() });
  }

  function handleRevert(id: string) {
    revertEntity("rules", id);
  }

  function handleClearError(id: string) {
    clearSaveError("rules", id);
    revertEntity("rules", id);
  }

  // ── Selection helpers ──────────────────────────────────────────────────────
  const selectableIds = useMemo(() => new Set(rows.map((s) => s.entity.id)), [rows]);
  const allSelected = rows.length > 0 && rows.every((s) => selectedIds.has(s.entity.id));
  const someSelected = rows.some((s) => selectedIds.has(s.entity.id));
  const activeSelectedIds = useMemo(
    () => [...selectedIds].filter((id) => selectableIds.has(id)),
    [selectedIds, selectableIds]
  );

  function toggleSelectAll() {
    _toggleSelectAll(selectableIds, allSelected);
  }

  function handleMerge() {
    onMerge(activeSelectedIds);
    clearSelection();
  }

  function handleDeleteSelected() {
    pushUndo();
    for (const id of activeSelectedIds) stageDelete("rules", id);
    clearSelection();
  }

  const totalVisible = Object.values(stagedRules).filter((s) => !s.isDeleted).length;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <FilterBar
        search={search}
        onSearchChange={setSearch}
        stageFilter={stageFilter}
        onStageFilterChange={setStageFilter}
        actionTypeFilter={actionTypeFilter}
        onActionTypeFilterChange={setActionTypeFilter}
        payeeId={payeeId}
        payeeName={payeeId ? payees[payeeId]?.entity.name : undefined}
        categoryId={categoryId}
        categoryName={categoryId ? categories[categoryId]?.entity.name : undefined}
        accountId={accountId}
        accountName={accountId ? accounts[accountId]?.entity.name : undefined}
        onClearPayee={() => router.push("/rules")}
        onClearCategory={() => router.push("/rules")}
        onClearAccount={() => router.push("/rules")}
        rowCount={rows.length}
        totalVisible={totalVisible}
        selectedCount={activeSelectedIds.length}
        onDeleteSelected={handleDeleteSelected}
        onMerge={handleMerge}
        onDeselect={clearSelection}
      />

      {/* Table */}
      <div className="min-h-0 flex-1 overflow-auto">
        {rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-20 text-sm text-muted-foreground">
            <span>No rules found.</span>
            {(search || stageFilter !== "all" || actionTypeFilter !== "all" || payeeId || categoryId || accountId) && (
              <button
                className="text-xs underline hover:text-foreground"
                onClick={() => {
                  setSearch("");
                  setStageFilter("all");
                  setActionTypeFilter("all");
                  if (payeeId || categoryId || accountId) router.push("/rules");
                }}
              >
                Clear filters
              </button>
            )}
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead className="sticky top-0 z-10 bg-background">
              <tr className="border-b border-border bg-muted/30 text-muted-foreground">
                <th className="w-8 px-3 py-2">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    ref={(el) => { if (el) el.indeterminate = someSelected && !allSelected; }}
                    onChange={toggleSelectAll}
                    className="h-3.5 w-3.5 cursor-pointer rounded accent-primary"
                    title="Select all visible rules"
                  />
                </th>
                <th className="w-20 px-3 py-2 text-left font-medium">Stage</th>
                <th className="w-12 px-2 py-2 text-left font-medium">Op</th>
                <th className="w-[45%] px-3 py-2 text-left font-medium">Conditions</th>
                <th className="px-3 py-2 text-left font-medium">Actions</th>
                <th className="w-28 px-3 py-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => {
                const rule = s.entity;
                const isDirty = s.isNew || s.isUpdated;
                const hasError = !!s.saveError;
                const isScheduleLinked = rule.actions.some((a) => a.op === "link-schedule");

                return (
                  <tr
                    key={rule.id}
                    data-row-id={rule.id}
                    className={cn(
                      "group cursor-pointer border-b border-border border-l-2 border-l-transparent hover:bg-muted/20 transition-colors align-top",
                      highlightedId === rule.id && "bg-primary/20 ring-2 ring-inset ring-primary/40",
                      highlightedId !== rule.id && selectedIds.has(rule.id) && "bg-primary/10",
                      highlightedId !== rule.id && !selectedIds.has(rule.id) && hasError && "bg-destructive/5 border-l-destructive",
                      highlightedId !== rule.id && !selectedIds.has(rule.id) && !hasError && s.isNew && "bg-green-50/40 dark:bg-green-950/10 border-l-green-500",
                      highlightedId !== rule.id && !selectedIds.has(rule.id) && !hasError && !s.isNew && s.isUpdated && "bg-amber-50/40 dark:bg-amber-950/10 border-l-amber-400",
                    )}
                    onClick={() => onEdit(rule.id)}
                  >
                    {/* Checkbox */}
                    <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selectedIds.has(rule.id)}
                        onChange={() => toggleSelect(rule.id)}
                        className="h-3.5 w-3.5 cursor-pointer rounded accent-primary"
                      />
                    </td>

                    {/* Stage */}
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-1">
                        {s.isNew && (
                          <span className="h-1.5 w-1.5 rounded-full bg-green-500 shrink-0" />
                        )}
                        {!s.isNew && s.isUpdated && (
                          <span className="h-1.5 w-1.5 rounded-full bg-amber-400 shrink-0" />
                        )}
                        {hasError && (
                          <AlertTriangle
                            className="h-3.5 w-3.5 text-destructive shrink-0"
                            aria-label={s.saveError}
                          />
                        )}
                        <Badge variant={stageBadgeVariant(normalizeStage(rule.stage))}>
                          {STAGE_LABELS[normalizeStage(rule.stage)]}
                        </Badge>
                        {isScheduleLinked && (
                          <span title="Linked to schedule">
                            <CalendarDays className="h-3 w-3 text-sky-500 shrink-0" aria-label="Linked to schedule" />
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Conditions op */}
                    <td className="px-2 py-2.5">
                      <span className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
                        {rule.conditionsOp}
                      </span>
                    </td>

                    {/* Conditions — one chip per line */}
                    <td className="px-3 py-2.5">
                      {rule.conditions.length === 0 ? (
                        <span className="flex items-center gap-1.5">
                          <span className="text-[11px] italic text-muted-foreground">No conditions</span>
                          <Badge variant="status-warning" className="text-[10px] font-normal">catch-all</Badge>
                        </span>
                      ) : (
                        <div className="flex flex-col gap-1">
                          {rule.conditions.map((c, i) => (
                            <ConditionChip key={i} condition={c} maps={entityMaps} />
                          ))}
                        </div>
                      )}
                      {hasError && (
                        <p className="mt-1 text-[11px] text-destructive">{s.saveError}</p>
                      )}
                    </td>

                    {/* Actions — one chip per line */}
                    <td className="px-3 py-2.5">
                      {rule.actions.length === 0 ? (
                        <span className="text-[11px] italic text-muted-foreground">No actions</span>
                      ) : (
                        <div className="flex flex-col gap-1">
                          {rule.actions.map((a, i) => (
                            <ActionChip key={i} action={a} maps={entityMaps} />
                          ))}
                        </div>
                      )}
                    </td>

                    {/* Row buttons */}
                    <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          title="Edit"
                          onClick={() => onEdit(rule.id)}
                        >
                          <Pencil />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          title="Duplicate"
                          onClick={() => handleDuplicate(rule)}
                        >
                          <Copy />
                        </Button>
                        {(isDirty || hasError) && (
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            className="text-muted-foreground"
                            title={hasError ? "Clear error & revert" : "Revert"}
                            onClick={() =>
                              hasError ? handleClearError(rule.id) : handleRevert(rule.id)
                            }
                          >
                            <RotateCcw />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          className="text-destructive hover:text-destructive disabled:opacity-30 disabled:cursor-not-allowed"
                          title={isScheduleLinked ? "Rule is linked to a schedule — delete it from the Schedules page" : "Delete"}
                          aria-label={isScheduleLinked ? "Delete (managed by schedule)" : "Delete"}
                          disabled={isScheduleLinked}
                          aria-disabled={isScheduleLinked}
                          onClick={isScheduleLinked ? undefined : () => handleDelete(rule.id)}
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
