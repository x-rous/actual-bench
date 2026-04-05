"use client";

import { useCallback } from "react";
import { Trash2, Braces } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { EntityCombobox } from "./EntityCombobox";
import { selectCls, inputCls } from "./ConditionRow";
import { valueToString } from "../utils/rulePreview";
import { ACTION_FIELDS, ACTION_OPS } from "../utils/ruleFields";
import type { ConditionOrAction } from "@/types/entities";

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
  const op = action.op ?? "set";
  const field = action.field ?? "";
  const fieldDef = ACTION_FIELDS[field];
  const isTemplate = op === "set" && action.options?.template !== undefined;
  const supportsTemplate = op === "set" && fieldDef?.supportsTemplate === true;

  const handleOpChange = useCallback(
    (newOp: string) => {
      if (newOp === "delete-transaction") {
        onChange({ op: "delete-transaction", value: "" });
        return;
      }
      if (newOp === "prepend-notes" || newOp === "append-notes") {
        // Force field to "notes", preserve existing string value if any
        const currentVal = typeof action.value === "string" ? action.value : "";
        onChange({ field: "notes", op: newOp, value: currentVal, type: "string" });
        return;
      }
      // Switching to "set": keep the current field unless coming from delete-transaction
      const newField = op === "delete-transaction" ? Object.keys(ACTION_FIELDS)[0] : field;
      const newDef = ACTION_FIELDS[newField];
      const defaultVal = newDef?.type === "boolean" ? false : newDef?.type === "number" ? 0 : "";
      onChange({ field: newField, op: "set", value: defaultVal, type: newDef?.type ?? "string", options: undefined });
    },
    [op, field, action.value, onChange]
  );

  const handleFieldChange = useCallback(
    (newField: string) => {
      const newDef = ACTION_FIELDS[newField];
      const defaultVal = newDef?.type === "boolean" ? false : newDef?.type === "number" ? 0 : "";
      onChange({ field: newField, op: "set", value: defaultVal, type: newDef?.type ?? "string", options: undefined });
    },
    [onChange]
  );

  function toggleTemplateMode() {
    if (isTemplate) {
      const restoredValue = action.options?.template ?? valueToString(action.value);
      onChange({ ...action, value: restoredValue, options: undefined });
    } else {
      // Enter template mode: zero value type-aware
      const zeroValue = fieldDef?.type === "number" || fieldDef?.type === "boolean" ? null : "";
      onChange({ ...action, value: zeroValue, options: { template: valueToString(action.value) } });
    }
  }

  // ── Delete transaction ────────────────────────────────────────────────────

  if (op === "delete-transaction") {
    return (
      <div className="flex items-start gap-1.5">
        <select
          className={cn(selectCls, "w-48 shrink-0")}
          value={op}
          onChange={(e) => handleOpChange(e.target.value)}
        >
          {Object.entries(ACTION_OPS).map(([k, def]) => (
            <option key={k} value={k}>{def.label}</option>
          ))}
        </select>
        <div className="flex-1" />
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

  // ── Prepend / append notes ────────────────────────────────────────────────

  if (op === "prepend-notes" || op === "append-notes") {
    return (
      <div className="flex items-start gap-1.5">
        <select
          className={cn(selectCls, "w-48 shrink-0")}
          value={op}
          onChange={(e) => handleOpChange(e.target.value)}
        >
          {Object.entries(ACTION_OPS).map(([k, def]) => (
            <option key={k} value={k}>{def.label}</option>
          ))}
        </select>
        <input
          className={inputCls}
          value={valueToString(action.value)}
          onChange={(e) => onChange({ ...action, value: e.target.value })}
          placeholder="text to prepend/append…"
        />
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

  // ── Set (default) ─────────────────────────────────────────────────────────

  return (
    <div className="flex items-start gap-1.5">
      {/* Op dropdown */}
      <select
        className={cn(selectCls, "w-32 shrink-0")}
        value={op}
        onChange={(e) => handleOpChange(e.target.value)}
      >
        {Object.entries(ACTION_OPS).map(([k, def]) => (
          <option key={k} value={k}>{def.label}</option>
        ))}
      </select>

      {/* Field dropdown */}
      <select
        className={cn(selectCls, "w-32 shrink-0")}
        value={field}
        onChange={(e) => handleFieldChange(e.target.value)}
      >
        {Object.entries(ACTION_FIELDS).map(([k, def]) => (
          <option key={k} value={k}>{def.label}</option>
        ))}
      </select>

      {/* Value input */}
      {isTemplate ? (
        <div className="flex flex-1 flex-col gap-0.5">
          <input
            className={inputCls}
            value={action.options?.template ?? ""}
            onChange={(e) => onChange({ ...action, options: { template: e.target.value } })}
            placeholder="{{handlebars expression…}}"
          />
          <span className="text-[10px] text-muted-foreground">
            Handlebars template — e.g. <code>{"{{regex imported_payee 'foo' 'bar'}}"}</code>
          </span>
        </div>
      ) : fieldDef?.type === "boolean" ? (
        <div className="flex flex-1 items-center gap-2 h-8">
          <input
            type="checkbox"
            checked={action.value === true || action.value === "true"}
            onChange={(e) => onChange({ ...action, value: e.target.checked })}
            className="h-4 w-4 cursor-pointer rounded accent-primary"
          />
          <span className="text-xs text-muted-foreground">
            {action.value === true || action.value === "true" ? "Yes (cleared)" : "No (uncleared)"}
          </span>
        </div>
      ) : fieldDef?.type === "number" ? (
        <input
          type="number"
          className={inputCls}
          value={typeof action.value === "number" ? action.value : typeof action.value === "string" ? action.value : ""}
          onChange={(e) => onChange({ ...action, value: e.target.value === "" ? "" : Number(e.target.value) })}
          placeholder="0.00"
          step="0.01"
        />
      ) : fieldDef?.type === "date" ? (
        <input
          type="date"
          className={inputCls}
          value={valueToString(action.value)}
          onChange={(e) => onChange({ ...action, value: e.target.value })}
        />
      ) : fieldDef?.entity ? (
        <EntityCombobox
          entity={fieldDef.entity}
          value={valueToString(action.value)}
          onChange={(v) => onChange({ ...action, value: v })}
        />
      ) : (
        <input
          className={inputCls}
          value={valueToString(action.value)}
          onChange={(e) => onChange({ ...action, value: e.target.value })}
          placeholder="value…"
        />
      )}

      {/* Template toggle — only for supported fields */}
      {supportsTemplate && (
        <Button
          variant="ghost"
          size="icon"
          title={isTemplate ? "Switch to text mode" : "Switch to template mode"}
          className={cn(
            "h-7 w-7 shrink-0 mt-0.5",
            isTemplate
              ? "text-amber-600 hover:text-amber-700"
              : "text-muted-foreground hover:text-foreground"
          )}
          onClick={toggleTemplateMode}
        >
          <Braces className="h-3.5 w-3.5" />
        </Button>
      )}

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
