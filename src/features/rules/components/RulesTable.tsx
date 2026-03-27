"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Trash2, RotateCcw, Copy, AlertTriangle, Search, X, Merge } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useStagedStore } from "@/store/staged";
import { rulePreview } from "../utils/rulePreview";
import { CONDITION_FIELDS, ACTION_FIELDS, STAGE_LABELS } from "../utils/ruleFields";
import { valueToString } from "../utils/rulePreview";
import type { StagedEntity, StagedMap } from "@/types/staged";
import type { Rule, ConditionOrAction, Payee, Category, Account } from "@/types/entities";

// ─── Types ────────────────────────────────────────────────────────────────────

type StageFilter = "all" | "pre" | "default" | "post";

type EntityMaps = {
  payees: StagedMap<Payee>;
  categories: StagedMap<Category>;
  accounts: StagedMap<Account>;
};

// ─── Entity resolution ────────────────────────────────────────────────────────

function resolveEntityName(
  id: string,
  entity: "payee" | "category" | "account",
  maps: EntityMaps
): string {
  if (entity === "payee") return maps.payees[id]?.entity.name ?? id;
  if (entity === "category") return maps.categories[id]?.entity.name ?? id;
  if (entity === "account") return maps.accounts[id]?.entity.name ?? id;
  return id;
}

/** Resolve a single scalar value to a display name. */
function resolveScalar(
  id: string,
  field: string,
  maps: EntityMaps,
  fieldDefs: typeof CONDITION_FIELDS | typeof ACTION_FIELDS
): string {
  const def = fieldDefs[field];
  if (def?.entity && id) return resolveEntityName(id, def.entity, maps);
  return id;
}

/** Resolve all values (handles both single and array) to display names. */
function resolveValues(
  field: string,
  value: ConditionOrAction["value"],
  maps: EntityMaps,
  fieldDefs: typeof CONDITION_FIELDS | typeof ACTION_FIELDS
): string[] {
  if (Array.isArray(value)) {
    return value.filter(Boolean).map((v) => resolveScalar(String(v), field, maps, fieldDefs));
  }
  const scalar = valueToString(value);
  if (!scalar) return [];
  return [resolveScalar(scalar, field, maps, fieldDefs)];
}

// ─── Condition chip ───────────────────────────────────────────────────────────

function ConditionChip({
  condition,
  maps,
}: {
  condition: ConditionOrAction;
  maps: EntityMaps;
}) {
  const fieldLabel = CONDITION_FIELDS[condition.field]?.label ?? condition.field;
  const valueLabels = resolveValues(condition.field, condition.value, maps, CONDITION_FIELDS);

  return (
    <div className="flex items-center gap-1 flex-wrap">
      {/* Field — indigo */}
      <span className="rounded px-1 py-0.5 text-[11px] font-semibold bg-indigo-50 text-indigo-700 dark:bg-indigo-950/30 dark:text-indigo-400">
        {fieldLabel}
      </span>
      {/* Op — muted */}
      <span className="text-[11px] text-muted-foreground">{condition.op}</span>
      {/* Values — each as its own emerald chip, comma-separated */}
      {valueLabels.map((label, i) => (
        <span key={i} className="rounded px-1 py-0.5 text-[11px] font-medium bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400">
          {label}
          {i < valueLabels.length - 1 && <span className="text-emerald-500 ml-0.5">,</span>}
        </span>
      ))}
    </div>
  );
}

// ─── Action chip ──────────────────────────────────────────────────────────────

function ActionChip({
  action,
  maps,
}: {
  action: ConditionOrAction;
  maps: EntityMaps;
}) {
  const fieldLabel = ACTION_FIELDS[action.field]?.label ?? action.field;
  const valueLabels = resolveValues(action.field, action.value, maps, ACTION_FIELDS);

  return (
    <div className="flex items-center gap-1 flex-wrap">
      {/* Field — violet */}
      <span className="rounded px-1 py-0.5 text-[11px] font-semibold bg-violet-50 text-violet-700 dark:bg-violet-950/30 dark:text-violet-400">
        {fieldLabel}
      </span>
      {/* Arrow */}
      <span className="text-[11px] text-muted-foreground">→</span>
      {/* Values — emerald chips */}
      {valueLabels.map((label, i) => (
        <span key={i} className="rounded px-1 py-0.5 text-[11px] font-medium bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400">
          {label}
          {i < valueLabels.length - 1 && <span className="text-emerald-500 ml-0.5">,</span>}
        </span>
      ))}
    </div>
  );
}

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
};

export function RulesTable({ onEdit, onMerge, payeeId, categoryId }: Props) {
  const stagedRules = useStagedStore((s) => s.rules);
  const payees = useStagedStore((s) => s.payees);
  const categories = useStagedStore((s) => s.categories);
  const accounts = useStagedStore((s) => s.accounts);
  const stageDelete = useStagedStore((s) => s.stageDelete);
  const stageNew = useStagedStore((s) => s.stageNew);
  const revertEntity = useStagedStore((s) => s.revertEntity);
  const clearSaveError = useStagedStore((s) => s.clearSaveError);
  const pushUndo = useStagedStore((s) => s.pushUndo);

  const router = useRouter();

  const [stageFilter, setStageFilter] = useState<StageFilter>("all");
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const entityMaps = useMemo<EntityMaps>(
    () => ({ payees, categories, accounts }),
    [payees, categories, accounts]
  );

  const rows = useMemo<StagedEntity<Rule>[]>(() => {
    return Object.values(stagedRules).filter((s) => {
      if (s.isDeleted) return false;
      if (stageFilter !== "all" && normalizeStage(s.entity.stage) !== stageFilter) return false;
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
      if (search.trim()) {
        const q = search.toLowerCase();
        const preview = rulePreview(s.entity, entityMaps).toLowerCase();
        if (!preview.includes(q)) return false;
      }
      return true;
    });
  }, [stagedRules, stageFilter, payeeId, categoryId, search, entityMaps]);

  function handleDelete(id: string) {
    pushUndo();
    stageDelete("rules", id);
  }

  function handleDuplicate(rule: Rule) {
    pushUndo();
    stageNew("rules", { ...structuredClone(rule), id: crypto.randomUUID() });
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
    if (allSelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const s of rows) next.delete(s.entity.id);
        return next;
      });
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const s of rows) next.add(s.entity.id);
        return next;
      });
    }
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleMerge() {
    onMerge(activeSelectedIds);
    setSelectedIds(new Set());
  }

  function handleDeleteSelected() {
    pushUndo();
    for (const id of activeSelectedIds) stageDelete("rules", id);
    setSelectedIds(new Set());
  }

  const totalVisible = Object.values(stagedRules).filter((s) => !s.isDeleted).length;

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Bulk action bar — visible when ≥1 row is selected */}
      {activeSelectedIds.length >= 1 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-border/40 bg-primary/5 px-2 py-1.5">
          <span className="text-xs font-medium text-primary">
            {activeSelectedIds.length} selected
          </span>
          <Button size="xs" variant="destructive" onClick={handleDeleteSelected}>            
            Delete
          </Button>
          {activeSelectedIds.length >= 2 && (
            <Button size="xs" className="h-6 text-xs" onClick={handleMerge}>
              <Merge className="h-3.5 w-3.5 mr-1.5" />
              Merge Selected
            </Button>
          )}
          <button 
            onClick={() => setSelectedIds(new Set())}
            className="ml-auto text-xs text-muted-foreground hover:text-foreground"
          > Clear selection
          </button>
        </div>
      )}

      {/* Filter bar — hidden while rows are selected */}
      {activeSelectedIds.length === 0 && <div className="flex flex-wrap shrink-0 items-center gap-2 border-b border-border/40 bg-muted/10 px-2 py-1.5">
        <div className="relative">
          <Search className="absolute left-1.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search rules…"
            className="h-6 w-44 rounded border border-border bg-background pl-6 pr-6 text-xs outline-none focus:ring-1 focus:ring-ring"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>

        <div className="flex gap-px rounded border border-border bg-muted/40 p-px">
          {(["all", "pre", "default", "post"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setStageFilter(f)}
              className={cn(
                "rounded px-2 py-0.5 text-xs transition-colors",
                stageFilter === f
                  ? "bg-background font-medium shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {f === "all" ? "All" : STAGE_LABELS[f]}
            </button>
          ))}
        </div>

        {payeeId && (
          <div className="flex items-center gap-1.5 rounded-md border border-primary/30 bg-primary/5 px-2 py-0.5 text-xs text-primary">
            <span>
              Payee: <span className="font-medium">{payees[payeeId]?.entity.name ?? payeeId}</span>
            </span>
            <button
              onClick={() => router.push("/rules")}
              className="text-primary/60 hover:text-primary"
              title="Clear payee filter"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        )}
        {categoryId && (
          <div className="flex items-center gap-1.5 rounded-md border border-primary/30 bg-primary/5 px-2 py-0.5 text-xs text-primary">
            <span>
              Category: <span className="font-medium">{categories[categoryId]?.entity.name ?? categoryId}</span>
            </span>
            <button
              onClick={() => router.push("/rules")}
              className="text-primary/60 hover:text-primary"
              title="Clear category filter"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        )}

        <span className="ml-auto text-xs text-muted-foreground whitespace-nowrap">
          {rows.length} of {totalVisible}
        </span>
      </div>}

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {rows.length === 0 ? (
          <div className="flex items-center justify-center py-20 text-sm text-muted-foreground">
            No rules found.
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead>
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

                return (
                  <tr
                    key={rule.id}
                    className={cn(
                      "group border-b border-border hover:bg-muted/20 transition-colors align-top",
                      isDirty && "bg-amber-50/40 dark:bg-amber-950/10",
                      hasError && "bg-destructive/5",
                      selectedIds.has(rule.id) && "bg-primary/5"
                    )}
                  >
                    {/* Checkbox */}
                    <td className="px-3 py-2.5">
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
                        {isDirty && (
                          <span className="h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0" />
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
                        <span className="text-[11px] italic text-muted-foreground">No conditions</span>
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
                    <td className="px-3 py-2.5">
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
                          className="text-destructive hover:text-destructive"
                          title="Delete"
                          onClick={() => handleDelete(rule.id)}
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
