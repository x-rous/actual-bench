"use client";

import { useCallback } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TagInput } from "@/components/ui/tag-input";
import { cn } from "@/lib/utils";
import { EntityCombobox, MultiEntityCombobox } from "./EntityCombobox";
import { valueToString, isRecurConfig } from "../utils/rulePreview";
import {
  CONDITION_FIELDS,
  DEFAULT_CONDITION_FIELD,
  conditionDisplayField,
  conditionValueKind,
  getConditionOps,
} from "../utils/ruleFields";
import { recurSummary } from "@/features/schedules/lib/recurSummary";
import { useQuickCreateStore } from "@/features/quick-create/store/useQuickCreateStore";
import type { QuickCreateEntityType } from "@/features/quick-create/store/useQuickCreateStore";
import type { ConditionOrAction, AmountRange, RecurConfig } from "@/types/entities";
import type { RuleEntityOptionsMap } from "../lib/ruleEditor";

// ─── Shared input/select styles ───────────────────────────────────────────────

export const selectCls =
  "h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring/50";

export const conditionFieldSelectCls =
  "h-8 rounded-md border border-indigo-200 bg-indigo-50 px-2 text-xs font-medium text-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-400/50 dark:border-indigo-800 dark:bg-indigo-950/30 dark:text-indigo-300";

export const fieldSelectCls =
  "h-8 rounded-md border border-violet-200 bg-violet-50 px-2 text-xs font-medium text-violet-700 focus:outline-none focus:ring-2 focus:ring-violet-400/50 dark:border-violet-800 dark:bg-violet-950/30 dark:text-violet-300";

export const inputCls =
  "h-8 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring/50";

// ─── Tag values ───────────────────────────────────────────────────────────────
//
// `hasTags` / `hasAnyTag` store one string, which the engine splits on `#`/whitespace. The
// editor shows it as chips, and writes it back "#"-prefixed so the stored value is unambiguous.

export function parseTagValue(value: ConditionOrAction["value"]): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value !== "string") return [];
  return value
    .split(/[\s#]+/)
    .map((tag) => tag.trim())
    .filter(Boolean);
}

export function formatTagValue(tags: string[]): string {
  // A chip can hold whitespace — typed with a space, or pasted. The engine splits the stored
  // string on whitespace regardless (`/#*([^#\s]+)/g`), so "food travel" would silently become
  // two tags. Tokenize here so what is shown and what is matched agree.
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    for (const token of raw.split(/[\s#]+/)) {
      const tag = token.trim();
      if (!tag || seen.has(tag)) continue;
      seen.add(tag);
      out.push(`#${tag}`);
    }
  }
  return out.join(" ");
}

// ─── ConditionValueInput ──────────────────────────────────────────────────────

function ConditionValueInput({
  condition,
  entityOptions,
  onChange,
  onQuickCreate,
  compact = false,
}: {
  condition: ConditionOrAction;
  entityOptions: RuleEntityOptionsMap;
  onChange: (c: ConditionOrAction) => void;
  onQuickCreate: (entity: QuickCreateEntityType, name: string) => void;
  compact?: boolean;
}) {
  const displayField = conditionDisplayField(condition.field, condition.options);
  const fieldDef = CONDITION_FIELDS[displayField];
  const ops = getConditionOps(displayField);
  const opDef = ops[condition.op];
  const kind = conditionValueKind(displayField, condition.op);
  // Every value control needs an accessible name — the field select above it is a separate
  // control, so a screen reader reaches these inputs with nothing identifying them.
  const valueLabel = `${fieldDef?.label ?? displayField} value`;

  if (!opDef || kind === "none") return null;

  if (kind === "range") {
    const range: AmountRange =
      typeof condition.value === "object" &&
      !Array.isArray(condition.value) &&
      condition.value !== null
        ? (condition.value as AmountRange)
        : { num1: 0, num2: 0 };
    return (
      <div className="flex flex-1 items-center gap-1">
        <input
          type="number"
          className={cn(inputCls, compact && "h-7")}
          value={range.num1}
          aria-label={`${valueLabel} from`}
          onChange={(e) =>
            onChange({ ...condition, value: { ...range, num1: Number(e.target.value) } })
          }
          placeholder="from"
        />
        <span className="text-xs text-muted-foreground shrink-0">–</span>
        <input
          type="number"
          className={cn(inputCls, compact && "h-7")}
          value={range.num2}
          aria-label={`${valueLabel} to`}
          onChange={(e) =>
            onChange({ ...condition, value: { ...range, num2: Number(e.target.value) } })
          }
          placeholder="to"
        />
      </div>
    );
  }

  if (kind === "multi-entity" && fieldDef?.entity) {
    const arr = Array.isArray(condition.value)
      ? (condition.value as string[])
      : condition.value
      ? [String(condition.value)]
      : [];
    return (
      <MultiEntityCombobox
        entity={fieldDef.entity}
        options={entityOptions[fieldDef.entity]}
        values={arr}
        onChange={(v) => onChange({ ...condition, value: v })}
        compact={compact}
      />
    );
  }

  if (kind === "multi-text") {
    const arr = Array.isArray(condition.value)
      ? (condition.value as string[])
      : condition.value
      ? [String(condition.value)]
      : [];
    return (
      <TagInput
        values={arr}
        onChange={(v) => onChange({ ...condition, value: v })}
        placeholder="Type and press Enter…"
        ariaLabel={valueLabel}
        compact={compact}
      />
    );
  }

  // Tags are stored as one string ("#food #travel"), not an array — Actual parses them back out
  // with a `#tag` regex. The chip input is a nicer way to type that than a bare text field.
  if (kind === "tags") {
    return (
      <div className="flex flex-1 flex-col gap-0.5">
        <TagInput
          values={parseTagValue(condition.value)}
          onChange={(v) => onChange({ ...condition, value: formatTagValue(v) })}
          placeholder="Type a tag and press Enter…"
          ariaLabel={valueLabel}
          compact={compact}
        />
        <span className="text-[10px] text-muted-foreground">
          {condition.op === "hasTags"
            ? "Matches only when the notes carry every tag listed."
            : "Matches when the notes carry at least one of these tags."}
        </span>
      </div>
    );
  }

  if (kind === "boolean") {
    const checked = condition.value === true || condition.value === "true";
    return (
      <div className={cn("flex h-8 flex-1 items-center gap-2", compact && "h-7")}>
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange({ ...condition, value: e.target.checked })}
          className="h-4 w-4 cursor-pointer rounded accent-primary"
          aria-label={valueLabel}
        />
        <span className="text-xs text-muted-foreground">{checked ? "Yes" : "No"}</span>
      </div>
    );
  }

  if (kind === "date") {
    return (
      <input
        type="date"
        className={cn(inputCls, compact && "h-7")}
        value={valueToString(condition.value)}
        aria-label={valueLabel}
        onChange={(e) => onChange({ ...condition, value: e.target.value })}
      />
    );
  }

  if (kind === "entity" && fieldDef?.entity) {
    const scalar = valueToString(condition.value);
    const QUICK_CREATE_ENTITIES: QuickCreateEntityType[] = ["payee", "category", "account", "tag"];
    const quickCreateEntity = QUICK_CREATE_ENTITIES.includes(fieldDef.entity as QuickCreateEntityType)
      ? (fieldDef.entity as QuickCreateEntityType)
      : null;
    return (
      <EntityCombobox
        entity={fieldDef.entity}
        options={entityOptions[fieldDef.entity]}
        value={scalar}
        onChange={(v) => onChange({ ...condition, value: v })}
        onQuickCreate={quickCreateEntity ? (name) => onQuickCreate(quickCreateEntity, name) : undefined}
        compact={compact}
      />
    );
  }

  if (kind === "number") {
    return (
      <input
        type="number"
        className={cn(inputCls, compact && "h-7")}
        value={valueToString(condition.value)}
        aria-label={valueLabel}
        onChange={(e) =>
          onChange({
            ...condition,
            value: e.target.value === "" ? "" : Number(e.target.value),
          })
        }
        placeholder="value…"
      />
    );
  }

  const isRegex = condition.op === "matches";

  return isRegex ? (
    <div className="flex flex-1 flex-col gap-0.5">
      <input
        className={cn(inputCls, compact && "h-7")}
        value={valueToString(condition.value)}
        aria-label={valueLabel}
        onChange={(e) => onChange({ ...condition, value: e.target.value })}
        placeholder="regex pattern…"
      />
      <span className="text-[10px] text-muted-foreground">
        Regex pattern - e.g. <code>^amazon</code>
      </span>
    </div>
  ) : (
    <input
      className={cn(inputCls, compact && "h-7")}
      value={valueToString(condition.value)}
      aria-label={valueLabel}
      onChange={(e) => onChange({ ...condition, value: e.target.value })}
      placeholder="value…"
    />
  );
}

// ─── ConditionRow ─────────────────────────────────────────────────────────────

export function ConditionRow({
  condition,
  scheduleLinked = false,
  entityOptions,
  error,
  onChange,
  onDelete,
  compact = false,
}: {
  condition: ConditionOrAction;
  scheduleLinked?: boolean;
  entityOptions: RuleEntityOptionsMap;
  error?: string;
  onChange: (c: ConditionOrAction) => void;
  onDelete: () => void;
  compact?: boolean;
}) {
  const openQuickCreate = useQuickCreateStore((s) => s.open);
  const field = condition.field ?? "";
  // `amount` carrying inflow/outflow options is shown as its own entry in the field select,
  // mirroring Actual's `amount-inflow` / `amount-outflow` pseudo-fields.
  const displayField = conditionDisplayField(field, condition.options);
  const ops = getConditionOps(displayField);
  const isScheduleDate = field === "date" && isRecurConfig(condition.value);
  const isScheduleLinkedEntity =
    scheduleLinked && (field === "payee" || field === "account") && condition.op === "is";

  const setField = useCallback(
    (newField: string) => {
      const newDef = CONDITION_FIELDS[newField] ?? CONDITION_FIELDS[DEFAULT_CONDITION_FIELD];
      const firstOp = Object.keys(getConditionOps(newField))[0] ?? "is";
      // A pseudo-field is stored as the field it stands for, plus its options. `inflow`/`outflow`
      // belong to the field being replaced, so they are cleared; anything else on the bag is not
      // this row's to discard.
      const pseudo = newDef?.pseudoFor;
      const carried = { ...(condition.options ?? {}) };
      delete carried.inflow;
      delete carried.outflow;
      const options = { ...carried, ...(pseudo?.options ?? {}) };
      onChange({
        field: pseudo?.field ?? newField,
        op: firstOp,
        value: newDef?.type === "boolean" ? false : "",
        type: newDef?.type ?? "string",
        ...(Object.keys(options).length > 0 ? { options } : {}),
      });
    },
    [condition.options, onChange]
  );

  function handleOpChange(newOp: string) {
    const wasKind = conditionValueKind(displayField, condition.op);
    const nextKind = conditionValueKind(displayField, newOp);
    const wasMulti = wasKind === "multi-text" || wasKind === "multi-entity";
    const isMulti = nextKind === "multi-text" || nextKind === "multi-entity";

    let newValue: ConditionOrAction["value"];

    if (nextKind === "none") {
      newValue = "";
    } else if (nextKind === "range") {
      newValue =
        typeof condition.value === "object" && !Array.isArray(condition.value)
          ? condition.value
          : { num1: 0, num2: 0 };
    } else if (nextKind === "tags") {
      // Ahead of the multi-to-scalar case below: tags are stored as one string, so a list can be
      // carried across whole. Taking `value[0]` would silently drop every tag but the first.
      newValue = wasKind === "tags" ? condition.value : formatTagValue(parseTagValue(condition.value));
    } else if (isMulti && !wasMulti) {
      const scalar = typeof condition.value === "string" ? condition.value : "";
      newValue = scalar ? [scalar] : [];
    } else if (!isMulti && wasMulti) {
      newValue = Array.isArray(condition.value) ? (condition.value[0] ?? "") : "";
    } else if (wasKind === "range") {
      // An amount range cannot be reinterpreted as a scalar; start clean.
      newValue = "";
    } else {
      newValue = condition.value;
    }

    // `options` carries inflow/outflow, which survive an operator change.
    onChange({ ...condition, op: newOp, value: newValue });
  }

  // Schedule-managed date condition — render read-only, not editable.
  if (isScheduleDate) {
    const summary = recurSummary(condition.value as unknown as RecurConfig);
    return (
      <div className="space-y-1">
        <div className="flex items-center gap-1.5 rounded border border-border bg-muted/30 px-2 py-1.5">
          <span className="rounded px-1 py-0.5 text-[11px] font-semibold bg-indigo-50 text-indigo-700 dark:bg-indigo-950/30 dark:text-indigo-400">
            Date
          </span>
          <span className="text-[11px] text-muted-foreground">{condition.op}</span>
          <span className="rounded px-1 py-0.5 text-[11px] font-medium bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400">
            {summary || "recurring"}
          </span>
          <span className="ml-auto text-[10px] italic text-muted-foreground/60">managed by schedule</span>
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    );
  }

  if (isScheduleLinkedEntity) {
    const fieldLabel = CONDITION_FIELDS[field]?.label ?? field;
    return (
      <div className="space-y-1">
        <div className="flex items-start gap-1.5">
          <div
            className={cn(
              selectCls,
              compact && "h-7",
              "flex w-32 shrink-0 items-center bg-muted/30 text-muted-foreground"
            )}
          >
            {fieldLabel}
          </div>

          <div
            className={cn(
              selectCls,
              compact && "h-7",
              "flex w-32 shrink-0 items-center bg-muted/30 text-muted-foreground"
            )}
          >
            is
          </div>

          <div className="flex-1">
            <ConditionValueInput condition={condition} entityOptions={entityOptions} onChange={onChange} onQuickCreate={openQuickCreate} compact={compact} />
          </div>

          <span className="mt-2 shrink-0 text-[10px] italic text-muted-foreground/60">
            synced with schedule
          </span>
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <div className="flex items-start gap-1.5">
        <select
          className={cn(conditionFieldSelectCls, compact && "h-7", "w-32 shrink-0")}
          value={displayField}
          aria-label="Condition field"
          onChange={(e) => setField(e.target.value)}
        >
          {Object.entries(CONDITION_FIELDS).map(([k, def]) => (
            <option key={k} value={k}>
              {def.label}
            </option>
          ))}
        </select>

        <select
          className={cn(selectCls, compact && "h-7", "w-32 shrink-0")}
          value={condition.op ?? ""}
          aria-label="Condition operator"
          onChange={(e) => handleOpChange(e.target.value)}
        >
          {Object.entries(ops).map(([k, def]) => (
            <option key={k} value={k}>
              {def.label}
            </option>
          ))}
        </select>

        <ConditionValueInput condition={condition} entityOptions={entityOptions} onChange={onChange} onQuickCreate={openQuickCreate} compact={compact} />

        <Button
          variant="ghost"
          size="icon"
          className="mt-0.5 h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
          onClick={onDelete}
          aria-label="Delete condition"
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
