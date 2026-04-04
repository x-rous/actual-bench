"use client";

import { useCallback } from "react";
import { Trash2, Braces } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TagInput } from "@/components/ui/tag-input";
import { cn } from "@/lib/utils";
import { EntityCombobox, MultiEntityCombobox } from "./EntityCombobox";
import { valueToString } from "../utils/rulePreview";
import { CONDITION_FIELDS, ACTION_FIELDS, ACTION_OPS, getConditionOps } from "../utils/ruleFields";
import type { ConditionOrAction, AmountRange } from "@/types/entities";

// ─── Shared input/select styles ───────────────────────────────────────────────

export const selectCls =
  "h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring/50";

export const inputCls =
  "h-8 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring/50";

// ─── ConditionValueInput ──────────────────────────────────────────────────────

function ConditionValueInput({
  condition,
  onChange,
}: {
  condition: ConditionOrAction;
  onChange: (c: ConditionOrAction) => void;
}) {
  const fieldDef = CONDITION_FIELDS[condition.field];
  const ops = getConditionOps(condition.field);
  const opDef = ops[condition.op];

  if (!opDef || !opDef.hasValue) return null;

  const isMulti = condition.op === "oneOf" || condition.op === "notOneOf";

  if (condition.op === "isbetween") {
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
          className={inputCls}
          value={range.num1}
          onChange={(e) =>
            onChange({ ...condition, value: { ...range, num1: Number(e.target.value) } })
          }
          placeholder="from"
        />
        <span className="text-xs text-muted-foreground shrink-0">–</span>
        <input
          type="number"
          className={inputCls}
          value={range.num2}
          onChange={(e) =>
            onChange({ ...condition, value: { ...range, num2: Number(e.target.value) } })
          }
          placeholder="to"
        />
      </div>
    );
  }

  if (isMulti && fieldDef?.entity) {
    const arr = Array.isArray(condition.value)
      ? (condition.value as string[])
      : condition.value
      ? [String(condition.value)]
      : [];
    return (
      <MultiEntityCombobox
        entity={fieldDef.entity}
        values={arr}
        onChange={(v) => onChange({ ...condition, value: v })}
      />
    );
  }

  if (isMulti) {
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
      />
    );
  }

  if (fieldDef?.entity) {
    const scalar = valueToString(condition.value);
    return (
      <EntityCombobox
        entity={fieldDef.entity}
        value={scalar}
        onChange={(v) => onChange({ ...condition, value: v })}
      />
    );
  }

  if (fieldDef?.type === "number") {
    return (
      <input
        type="number"
        className={inputCls}
        value={valueToString(condition.value)}
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
        className={inputCls}
        value={valueToString(condition.value)}
        onChange={(e) => onChange({ ...condition, value: e.target.value })}
        placeholder="regex pattern…"
      />
      <span className="text-[10px] text-muted-foreground">
        Regex pattern — e.g. <code>^amazon</code>
      </span>
    </div>
  ) : (
    <input
      className={inputCls}
      value={valueToString(condition.value)}
      onChange={(e) => onChange({ ...condition, value: e.target.value })}
      placeholder="value…"
    />
  );
}

// ─── ConditionRow ─────────────────────────────────────────────────────────────

export function ConditionRow({
  condition,
  onChange,
  onDelete,
}: {
  condition: ConditionOrAction;
  onChange: (c: ConditionOrAction) => void;
  onDelete: () => void;
}) {
  const field = condition.field;
  const ops = getConditionOps(field);

  const setField = useCallback(
    (newField: string) => {
      const newDef = CONDITION_FIELDS[newField];
      const firstOp = Object.keys(getConditionOps(newField))[0] ?? "is";
      onChange({ field: newField, op: firstOp, value: "", type: newDef?.type ?? "string" });
    },
    [onChange]
  );

  function handleOpChange(newOp: string) {
    const wasMulti = condition.op === "oneOf" || condition.op === "notOneOf";
    const isMulti = newOp === "oneOf" || newOp === "notOneOf";
    const isBetween = newOp === "isbetween";
    const hasValue = ops[newOp]?.hasValue !== false;

    let newValue: ConditionOrAction["value"];

    if (!hasValue) {
      newValue = "";
    } else if (isBetween) {
      newValue =
        typeof condition.value === "object" && !Array.isArray(condition.value)
          ? condition.value
          : { num1: 0, num2: 0 };
    } else if (isMulti && !wasMulti) {
      const scalar = typeof condition.value === "string" ? condition.value : "";
      newValue = scalar ? [scalar] : [];
    } else if (!isMulti && wasMulti) {
      newValue = Array.isArray(condition.value) ? (condition.value[0] ?? "") : "";
    } else {
      newValue = condition.value;
    }

    onChange({ ...condition, op: newOp, value: newValue });
  }

  return (
    <div className="flex items-start gap-1.5">
      <select
        className={cn(selectCls, "w-32 shrink-0")}
        value={field ?? ""}
        onChange={(e) => setField(e.target.value)}
      >
        {Object.entries(CONDITION_FIELDS).map(([k, def]) => (
          <option key={k} value={k}>
            {def.label}
          </option>
        ))}
      </select>

      <select
        className={cn(selectCls, "w-32 shrink-0")}
        value={condition.op ?? ""}
        onChange={(e) => handleOpChange(e.target.value)}
      >
        {Object.entries(ops).map(([k, def]) => (
          <option key={k} value={k}>
            {def.label}
          </option>
        ))}
      </select>

      <ConditionValueInput condition={condition} onChange={onChange} />

      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive mt-0.5"
        onClick={onDelete}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

// ─── ActionRow ────────────────────────────────────────────────────────────────

export function ActionRow({
  action,
  onChange,
  onDelete,
}: {
  action: ConditionOrAction;
  onChange: (a: ConditionOrAction) => void;
  onDelete: () => void;
}) {
  const field = action.field;
  const fieldDef = ACTION_FIELDS[field];
  const isTemplate = action.options?.template !== undefined;

  const setField = useCallback(
    (newField: string) => {
      const newDef = ACTION_FIELDS[newField];
      onChange({ field: newField, op: "set", value: "", type: newDef?.type ?? "string" });
    },
    [onChange]
  );

  function toggleTemplateMode() {
    if (isTemplate) {
      // Switch back to text mode — restore template string as the plain value,
      // then clear options so the action is a regular text action.
      const restoredValue = action.options?.template ?? valueToString(action.value);
      onChange({ ...action, value: restoredValue, options: undefined });
    } else {
      // Switch to template mode — pre-populate options.template from current value.
      onChange({ ...action, options: { template: valueToString(action.value) } });
    }
  }

  const value = valueToString(action.value);

  return (
    <div className="flex items-start gap-1.5">
      <select
        className={cn(selectCls, "w-32 shrink-0 mt-0.5")}
        value={field ?? ""}
        onChange={(e) => setField(e.target.value)}
      >
        {Object.entries(ACTION_FIELDS).map(([k, def]) => (
          <option key={k} value={k}>
            {def.label}
          </option>
        ))}
      </select>

      <span className="shrink-0 text-xs text-muted-foreground w-10 text-center mt-2">
        {ACTION_OPS["set"]?.label ?? "set to"}
      </span>

      {isTemplate ? (
        <div className="flex flex-1 flex-col gap-0.5">
          <input
            className={inputCls}
            value={action.options?.template ?? ""}
            onChange={(e) =>
              onChange({ ...action, options: { template: e.target.value } })
            }
            placeholder="{{handlebars expression…}}"
          />
          <span className="text-[10px] text-muted-foreground">
            Handlebars template — e.g. <code>{"{{regex imported_payee 'foo' 'bar'}}"}</code>
          </span>
        </div>
      ) : fieldDef?.entity ? (
        <EntityCombobox
          entity={fieldDef.entity}
          value={value}
          onChange={(v) => onChange({ ...action, value: v })}
        />
      ) : (
        <input
          className={inputCls}
          value={value}
          onChange={(e) => onChange({ ...action, value: e.target.value })}
          placeholder="value…"
        />
      )}

      <Button
        variant="ghost"
        size="icon"
        title={isTemplate ? "Switch to text mode" : "Switch to template mode"}
        className={cn(
          "h-7 w-7 shrink-0 mt-0.5",
          isTemplate
            ? "text-action hover:text-action-hover"
            : "text-muted-foreground hover:text-foreground"
        )}
        onClick={toggleTemplateMode}
      >
        <Braces className="h-3.5 w-3.5" />
      </Button>

      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive mt-0.5"
        onClick={onDelete}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
