"use client";

import { CONDITION_FIELDS, ACTION_FIELDS, ACTION_OPS } from "../utils/ruleFields";
import { valueToString, isRecurConfig } from "../utils/rulePreview";
import type { EntityMaps } from "../utils/rulePreview";
import type { ConditionOrAction } from "@/types/entities";
import { cn } from "@/lib/utils";
import { recurSummary } from "@/features/schedules/lib/recurSummary";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** True when the field resolves to a named entity (payee, category, account, group). */
function isEntityField(field: string, fieldDefs: typeof CONDITION_FIELDS | typeof ACTION_FIELDS): boolean {
  return !!fieldDefs[field]?.entity;
}

// ─── Entity resolution ────────────────────────────────────────────────────────

function resolveEntityName(
  id: string,
  entity: "payee" | "category" | "account" | "categoryGroup",
  maps: EntityMaps
): string {
  if (entity === "payee")         return maps.payees[id]?.entity.name         ?? id;
  if (entity === "category")      return maps.categories[id]?.entity.name     ?? id;
  if (entity === "account")       return maps.accounts[id]?.entity.name       ?? id;
  if (entity === "categoryGroup") return maps.categoryGroups[id]?.entity.name ?? id;
  return id;
}

function resolveScalar(
  id: string,
  field: string,
  maps: EntityMaps,
  fieldDefs: typeof CONDITION_FIELDS | typeof ACTION_FIELDS
): string {
  const def = fieldDefs[field];
  if (def?.entity && id) return resolveEntityName(id, def.entity, maps);
  if (def?.type === "number" && id !== "" && !isNaN(Number(id))) {
    return Number(id).toFixed(2);
  }
  return id;
}

function resolveValues(
  field: string,
  value: ConditionOrAction["value"],
  maps: EntityMaps,
  fieldDefs: typeof CONDITION_FIELDS | typeof ACTION_FIELDS
): string[] {
  // Date conditions in schedule-linked rules carry a RecurConfig object as their value.
  if (field === "date" && isRecurConfig(value)) {
    const summary = recurSummary(value);
    return summary ? [summary] : ["recurring"];
  }

  if (Array.isArray(value)) {
    return value.filter(Boolean).map((v) => resolveScalar(String(v), field, maps, fieldDefs));
  }
  const scalar = valueToString(value);
  if (!scalar) return [];
  return [resolveScalar(scalar, field, maps, fieldDefs)];
}

// ─── ConditionChip ────────────────────────────────────────────────────────────

export function ConditionChip({
  condition,
  maps,
}: {
  condition: ConditionOrAction;
  maps: EntityMaps;
}) {
  const field = condition.field ?? "";
  const fieldLabel = CONDITION_FIELDS[field]?.label ?? field;
  const valueLabels = resolveValues(field, condition.value, maps, CONDITION_FIELDS);
  const isEntity = isEntityField(field, CONDITION_FIELDS);

  return (
    <div className="flex items-center gap-1 flex-wrap">
      {/* Field — indigo */}
      <span className="rounded px-1 py-0.5 text-[11px] font-semibold bg-indigo-50 text-indigo-700 dark:bg-indigo-950/30 dark:text-indigo-400">
        {fieldLabel}
      </span>
      {/* Op — muted */}
      <span className="text-[11px] text-muted-foreground">{condition.op}</span>
      {/* Values — sky for entity references, emerald for plain strings */}
      {valueLabels.map((label, i) => (
        <span key={i} className={cn(
          "rounded px-1 py-0.5 text-[11px] font-medium",
          isEntity
            ? "bg-sky-50 text-sky-700 dark:bg-sky-950/30 dark:text-sky-400"
            : "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400"
        )}>
          {label}
          {i < valueLabels.length - 1 && <span className={isEntity ? "text-sky-500 ml-0.5" : "text-emerald-500 ml-0.5"}>,</span>}
        </span>
      ))}
    </div>
  );
}

// ─── ActionChip ───────────────────────────────────────────────────────────────

export function ActionChip({
  action,
  maps,
}: {
  action: ConditionOrAction;
  maps: EntityMaps;
}) {
  const op = action.op ?? "set";
  const opLabel = ACTION_OPS[op]?.label ?? op;

  // Delete transaction — op badge only
  if (op === "delete-transaction") {
    return (
      <div className="flex items-center gap-1 flex-wrap">
        <span className="rounded px-1 py-0.5 text-[11px] font-medium bg-muted text-muted-foreground">
          {opLabel}
        </span>
      </div>
    );
  }

  // Prepend / append notes — op badge + value (field is implicit)
  if (op === "prepend-notes" || op === "append-notes") {
    const displayValue = valueToString(action.value);
    return (
      <div className="flex items-center gap-1 flex-wrap">
        <span className="rounded px-1 py-0.5 text-[11px] font-medium bg-muted text-muted-foreground">
          {opLabel}
        </span>
        <span className="rounded px-1 py-0.5 text-[11px] font-medium bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400">
          {displayValue || <span className="italic opacity-60">empty</span>}
        </span>
      </div>
    );
  }

  const field = action.field ?? "";

  // Link-schedule — read-only badge resolving the schedule name
  if (op === "link-schedule") {
    const scheduleId = valueToString(action.value);
    const scheduleName = maps.schedules?.[scheduleId]?.entity.name ?? scheduleId;
    return (
      <div className="flex items-center gap-1 flex-wrap">
        <span className="rounded px-1 py-0.5 text-[11px] font-medium bg-muted text-muted-foreground">
          linked to schedule
        </span>
        <span className="text-[11px] text-muted-foreground">→</span>
        <span className="rounded px-1 py-0.5 text-[11px] font-medium bg-sky-50 text-sky-700 dark:bg-sky-950/30 dark:text-sky-400">
          {scheduleName}
        </span>
      </div>
    );
  }

  const fieldLabel = ACTION_FIELDS[field]?.label ?? field;
  const template = action.options?.template;
  const fieldDef = ACTION_FIELDS[field];

  // Template mode
  if (template !== undefined) {
    return (
      <div className="flex items-center gap-1 flex-wrap">
        <span className="rounded px-1 py-0.5 text-[11px] font-medium bg-muted text-muted-foreground">
          set
        </span>
        <span className="rounded px-1 py-0.5 text-[11px] font-semibold bg-violet-50 text-violet-700 dark:bg-violet-950/30 dark:text-violet-400">
          {fieldLabel}
        </span>
        <span className="text-[11px] text-muted-foreground">template:</span>
        <span className="rounded px-1 py-0.5 text-[11px] font-mono bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400">
          {template || <span className="italic opacity-60">empty template</span>}
        </span>
      </div>
    );
  }

  // Boolean field — show Yes/No
  let valueLabels: string[];
  if (fieldDef?.type === "boolean") {
    const boolVal = action.value === true || action.value === "true";
    valueLabels = [boolVal ? "Yes" : "No"];
  } else {
    valueLabels = resolveValues(field, action.value, maps, ACTION_FIELDS);
  }
  const isEntity = isEntityField(field, ACTION_FIELDS);

  return (
    <div className="flex items-center gap-1 flex-wrap">
      <span className="rounded px-1 py-0.5 text-[11px] font-medium bg-muted text-muted-foreground">
        set
      </span>
      <span className="rounded px-1 py-0.5 text-[11px] font-semibold bg-violet-50 text-violet-700 dark:bg-violet-950/30 dark:text-violet-400">
        {fieldLabel}
      </span>
      <span className="text-[11px] text-muted-foreground">→</span>
      {valueLabels.map((label, i) => (
        <span key={i} className={cn(
          "rounded px-1 py-0.5 text-[11px] font-medium",
          isEntity
            ? "bg-sky-50 text-sky-700 dark:bg-sky-950/30 dark:text-sky-400"
            : "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400"
        )}>
          {label}
          {i < valueLabels.length - 1 && <span className={isEntity ? "text-sky-500 ml-0.5" : "text-emerald-500 ml-0.5"}>,</span>}
        </span>
      ))}
    </div>
  );
}
