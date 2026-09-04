"use client";

import { useCallback } from "react";
import { Trash2, Braces } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { EntityCombobox } from "./EntityCombobox";
import { selectCls, fieldSelectCls, inputCls } from "./ConditionRow";
import { valueToString } from "../utils/rulePreview";
import {
  ACTION_FIELDS,
  ACTION_OPS,
  ACTION_OP_OPTIONS,
  ALLOCATION_METHODS,
  ALLOCATION_METHOD_OPTIONS,
  DEFAULT_ACTION_FIELD,
  getSplitActionFields,
  isAllocationMethod,
} from "../utils/ruleFields";
import { splitIndexOf } from "../lib/splitActions";
import { useStagedStore } from "@/store/staged";
import { useQuickCreateStore } from "@/features/quick-create/store/useQuickCreateStore";
import type { QuickCreateEntityType } from "@/features/quick-create/store/useQuickCreateStore";
import type { ConditionOrAction, RuleOptions } from "@/types/entities";
import type { RuleEntityOptionsMap } from "../lib/ruleEditor";

// ─── Options merging ──────────────────────────────────────────────────────────
//
// Every write to `options` merges rather than replaces. Replacing it is how a `splitIndex` used
// to vanish the moment the user retyped a value (F-118) — the row only knows about the keys it
// renders, and the rest of the bag belongs to the rule, not to this row.

function mergeOptions(
  current: RuleOptions | undefined,
  patch: Partial<Record<keyof RuleOptions, unknown>>
): RuleOptions | undefined {
  const next: Record<string, unknown> = { ...(current ?? {}) };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) delete next[key];
    else next[key] = value;
  }
  return Object.keys(next).length > 0 ? (next as RuleOptions) : undefined;
}

function withOptions(
  action: ConditionOrAction,
  patch: Partial<Record<keyof RuleOptions, unknown>>
): ConditionOrAction {
  const options = mergeOptions(action.options, patch);
  if (options === undefined) {
    const withoutOptions = { ...action };
    delete withoutOptions.options;
    return withoutOptions;
  }
  return { ...action, options };
}

/** Keys this row owns and may clear; anything else on `options` is carried through untouched. */
const MODE_KEYS = { template: undefined, formula: undefined } as const;

// ─── ActionRow ────────────────────────────────────────────────────────────────

export function ActionRow({
  action,
  entityOptions,
  error,
  onChange,
  onDelete,
  compact = false,
}: {
  action: ConditionOrAction;
  entityOptions: RuleEntityOptionsMap;
  error?: string;
  onChange: (a: ConditionOrAction) => void;
  onDelete: () => void;
  compact?: boolean;
}) {
  const op = action.op ?? "set";
  const field = action.field ?? "";
  const fieldDef = ACTION_FIELDS[field];
  const isTemplate = op === "set" && action.options?.template !== undefined;
  const isFormula = op === "set" && action.options?.formula !== undefined;
  const supportsTemplate = op === "set" && fieldDef?.supportsTemplate === true;
  const supportsFormula = op === "set" && fieldDef?.supportsFormula === true;
  const inSplit = splitIndexOf(action) > 0;
  // Amount, cleared, account and date belong to the whole transaction; Actual does not let a
  // split child set them.
  const availableFields = inSplit ? getSplitActionFields() : ACTION_FIELDS;
  const stagedSchedules = useStagedStore((s) => s.schedules);
  const openQuickCreate = useQuickCreateStore((s) => s.open);

  const handleOpChange = useCallback(
    (newOp: string) => {
      if (newOp === "delete-transaction") {
        onChange(withOptions({ op: "delete-transaction", value: "" }, {}));
        return;
      }
      if (newOp === "prepend-notes" || newOp === "append-notes") {
        // Force field to "notes", preserve existing string value if any
        const currentVal = typeof action.value === "string" ? action.value : "";
        onChange(
          withOptions({ field: "notes", op: newOp, value: currentVal, type: "string" }, {
            ...MODE_KEYS,
            splitIndex: action.options?.splitIndex,
          })
        );
        return;
      }
      // Switching to "set": keep the current field unless coming from an op that has none.
      const newField = availableFields[field] ? field : DEFAULT_ACTION_FIELD;
      const newDef = ACTION_FIELDS[newField];
      const defaultVal = newDef?.type === "boolean" ? false : newDef?.type === "number" ? 0 : "";
      onChange(
        withOptions(
          { field: newField, op: "set", value: defaultVal, type: newDef?.type ?? "string" },
          { ...MODE_KEYS, splitIndex: action.options?.splitIndex }
        )
      );
    },
    [action.value, action.options?.splitIndex, availableFields, field, onChange]
  );

  const handleFieldChange = useCallback(
    (newField: string) => {
      const newDef = ACTION_FIELDS[newField];
      const defaultVal = newDef?.type === "boolean" ? false : newDef?.type === "number" ? 0 : "";
      onChange(
        withOptions(
          { field: newField, op: "set", value: defaultVal, type: newDef?.type ?? "string" },
          { ...MODE_KEYS, splitIndex: action.options?.splitIndex }
        )
      );
    },
    [action.options?.splitIndex, onChange]
  );

  function toggleTemplateMode() {
    if (isTemplate) {
      const restoredValue = action.options?.template ?? valueToString(action.value);
      onChange({ ...withOptions(action, MODE_KEYS), value: restoredValue });
    } else {
      // Enter template mode (exits formula mode if active)
      const zeroValue = fieldDef?.type === "number" || fieldDef?.type === "boolean" ? null : "";
      onChange({
        ...withOptions(action, { formula: undefined, template: valueToString(action.value) }),
        value: zeroValue,
      });
    }
  }

  function toggleFormulaMode() {
    if (isFormula) {
      const restoredValue = action.options?.formula ?? valueToString(action.value);
      onChange({ ...withOptions(action, MODE_KEYS), value: restoredValue });
    } else {
      // Enter formula mode (exits template mode if active)
      onChange({
        ...withOptions(action, { template: undefined, formula: valueToString(action.value) }),
        value: "",
      });
    }
  }

  // ── Link schedule — read-only, created by backend only ───────────────────

  if (op === "link-schedule") {
    const scheduleId = typeof action.value === "string" ? action.value : "";
    const scheduleName = stagedSchedules[scheduleId]?.entity.name ?? scheduleId;
    return (
      <div className="space-y-1">
        <div className="flex items-center gap-1.5 rounded border border-border bg-muted/30 px-2 py-1.5">
          <span className="text-[11px] font-medium text-muted-foreground">linked to schedule</span>
          <span className="text-[11px] text-muted-foreground">→</span>
          <span className="rounded bg-sky-50 px-1 py-0.5 text-[11px] font-medium text-sky-700 dark:bg-sky-950/30 dark:text-sky-400">
            {scheduleName}
          </span>
          <span className="ml-auto text-[10px] italic text-muted-foreground/60">managed by schedule</span>
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    );
  }

  // ── Allocate (set-split-amount) — how much of the transaction this split takes ──

  if (op === "set-split-amount") {
    const method = isAllocationMethod(action.options?.method) ? action.options.method : undefined;
    return (
      <div className="space-y-1">
        <div className="flex items-start gap-1.5">
          <div
            className={cn(
              selectCls,
              compact && "h-7",
              "flex w-32 shrink-0 items-center bg-muted/30 font-medium text-muted-foreground"
            )}
          >
            Allocate
          </div>

          <select
            className={cn(selectCls, compact && "h-7", "w-56 shrink-0")}
            value={method ?? ""}
            aria-label="Allocation method"
            onChange={(e) =>
              onChange({
                ...withOptions(action, { method: e.target.value, formula: undefined }),
                value: null,
              })
            }
          >
            {method === undefined && <option value="">Choose a method…</option>}
            {ALLOCATION_METHOD_OPTIONS.map((m) => (
              <option key={m} value={m}>
                {ALLOCATION_METHODS[m]}
              </option>
            ))}
          </select>

          {method === "formula" ? (
            <div className="flex flex-1 flex-col gap-0.5">
              <input
                className={cn(inputCls, compact && "h-7")}
                value={action.options?.formula ?? ""}
                aria-label="Split amount formula"
                onChange={(e) => onChange(withOptions(action, { formula: e.target.value }))}
                placeholder="=amount * 0.2"
              />
              <span className="text-[10px] text-muted-foreground">
                Excel formula - e.g. <code>{"=amount * 0.2"}</code>
              </span>
            </div>
          ) : method === "fixed-amount" || method === "fixed-percent" ? (
            <div className="flex flex-1 items-center gap-1">
              <input
                type="number"
                className={cn(inputCls, compact && "h-7")}
                value={typeof action.value === "number" ? action.value : ""}
                aria-label={method === "fixed-percent" ? "Split percentage" : "Split amount"}
                onChange={(e) =>
                  onChange({
                    ...action,
                    value: e.target.value === "" ? null : Number(e.target.value),
                  })
                }
                placeholder={method === "fixed-percent" ? "25" : "0.00"}
                step={method === "fixed-percent" ? "1" : "0.01"}
                min={method === "fixed-percent" ? 0 : undefined}
                max={method === "fixed-percent" ? 100 : undefined}
              />
              {method === "fixed-percent" && (
                <span className="shrink-0 text-xs text-muted-foreground">%</span>
              )}
            </div>
          ) : (
            <div className="flex-1" />
          )}

          <Button
            variant="ghost"
            size="icon"
            className="mt-0.5 h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
            onClick={onDelete}
            aria-label="Delete allocation"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    );
  }

  // ── Delete transaction ────────────────────────────────────────────────────

  if (op === "delete-transaction") {
    return (
      <div className="space-y-1">
        <div className="flex items-start gap-1.5">
          <select
            className={cn(selectCls, compact && "h-7", "w-48 shrink-0")}
            value={op}
            aria-label="Action type"
            onChange={(e) => handleOpChange(e.target.value)}
          >
            {ACTION_OP_OPTIONS.map((k) => (
              <option key={k} value={k}>{ACTION_OPS[k].label}</option>
            ))}
          </select>
          <div className="flex-1" />
          <Button
            variant="ghost"
            size="icon"
            className="mt-0.5 h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
            onClick={onDelete}
            aria-label="Delete action"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    );
  }

  // ── Prepend / append notes ────────────────────────────────────────────────

  if (op === "prepend-notes" || op === "append-notes") {
    return (
      <div className="space-y-1">
        <div className="flex items-start gap-1.5">
          <select
            className={cn(selectCls, compact && "h-7", "w-48 shrink-0")}
            value={op}
            aria-label="Action type"
            onChange={(e) => handleOpChange(e.target.value)}
          >
            {ACTION_OP_OPTIONS.map((k) => (
              <option key={k} value={k}>{ACTION_OPS[k].label}</option>
            ))}
          </select>
          <input
            className={cn(inputCls, compact && "h-7")}
            value={valueToString(action.value)}
            aria-label="Notes text"
            onChange={(e) => onChange({ ...action, value: e.target.value })}
            placeholder="text to prepend/append…"
          />
          <Button
            variant="ghost"
            size="icon"
            className="mt-0.5 h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
            onClick={onDelete}
            aria-label="Delete action"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    );
  }

  // ── Set (default) ─────────────────────────────────────────────────────────

  return (
    <div className="space-y-1">
      <div className="flex items-start gap-1.5">
        <select
          className={cn(selectCls, compact && "h-7", "w-32 shrink-0")}
          value={op}
          aria-label="Action type"
          onChange={(e) => handleOpChange(e.target.value)}
        >
          {ACTION_OP_OPTIONS.map((k) => (
            <option key={k} value={k}>{ACTION_OPS[k].label}</option>
          ))}
        </select>

        <select
          className={cn(fieldSelectCls, compact && "h-7", "w-32 shrink-0")}
          value={field}
          aria-label="Action field"
          onChange={(e) => handleFieldChange(e.target.value)}
        >
          {Object.entries(availableFields).map(([k, def]) => (
            <option key={k} value={k}>{def.label}</option>
          ))}
        </select>

        {isFormula ? (
          <div className="flex flex-1 flex-col gap-0.5">
            <input
              className={cn(inputCls, compact && "h-7")}
              value={action.options?.formula ?? ""}
              aria-label="Formula"
              onChange={(e) => onChange(withOptions(action, { formula: e.target.value }))}
              placeholder="=IF(ISBLANK(notes), …)"
            />
            <span className="text-[10px] text-muted-foreground">
              Excel formula - e.g. <code>{"=IF(ISBLANK(notes), imported_payee, notes)"}</code>
            </span>
          </div>
        ) : isTemplate ? (
          <div className="flex flex-1 flex-col gap-0.5">
            <input
              className={cn(inputCls, compact && "h-7")}
              value={action.options?.template ?? ""}
              aria-label="Template"
              onChange={(e) => onChange(withOptions(action, { template: e.target.value }))}
              placeholder="{{handlebars expression…}}"
            />
            <span className="text-[10px] text-muted-foreground">
              Handlebars template - e.g. <code>{"{{regex imported_payee 'foo' 'bar'}}"}</code>
            </span>
          </div>
        ) : fieldDef?.type === "boolean" ? (
          <div className={cn("flex h-8 flex-1 items-center gap-2", compact && "h-7")}>
            <input
              type="checkbox"
              checked={action.value === true || action.value === "true"}
              aria-label={`Set ${fieldDef.label}`}
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
            className={cn(inputCls, compact && "h-7")}
            value={typeof action.value === "number" ? action.value : typeof action.value === "string" ? action.value : ""}
            aria-label={`Set ${fieldDef.label}`}
            onChange={(e) => onChange({ ...action, value: e.target.value === "" ? "" : Number(e.target.value) })}
            placeholder="0.00"
            step="0.01"
          />
        ) : fieldDef?.type === "date" ? (
          <input
            type="date"
            className={cn(inputCls, compact && "h-7")}
            value={valueToString(action.value)}
            aria-label={`Set ${fieldDef.label}`}
            onChange={(e) => onChange({ ...action, value: e.target.value })}
          />
        ) : fieldDef?.entity ? (
          <EntityCombobox
            entity={fieldDef.entity}
            options={entityOptions[fieldDef.entity]}
            value={valueToString(action.value)}
            onChange={(v) => onChange({ ...action, value: v })}
            onQuickCreate={(name) => openQuickCreate(fieldDef.entity as QuickCreateEntityType, name)}
            compact={compact}
          />
        ) : (
          <input
            className={cn(inputCls, compact && "h-7")}
            value={valueToString(action.value)}
            aria-label="Action value"
            onChange={(e) => onChange({ ...action, value: e.target.value })}
            placeholder="value…"
          />
        )}

        {supportsFormula && !isTemplate && (
          <Button
            variant="ghost"
            size="icon"
            title={isFormula ? "Switch to text mode" : "Switch to formula mode"}
            aria-label={isFormula ? "Switch to text mode" : "Switch to formula mode"}
            aria-pressed={isFormula}
            className={cn(
              "mt-0.5 h-7 w-7 shrink-0 font-mono text-base leading-none",
              isFormula
                ? "text-amber-600 hover:text-amber-700"
                : "text-muted-foreground hover:text-foreground"
            )}
            onClick={toggleFormulaMode}
          >
            ƒ
          </Button>
        )}

        {supportsTemplate && !isFormula && (
          <Button
            variant="ghost"
            size="icon"
            title={isTemplate ? "Switch to text mode" : "Switch to template mode"}
            aria-label={isTemplate ? "Switch to text mode" : "Switch to template mode"}
            aria-pressed={isTemplate}
            className={cn(
              "mt-0.5 h-7 w-7 shrink-0",
              isTemplate
                ? "text-amber-600 hover:text-amber-700"
                : "text-muted-foreground hover:text-foreground"
            )}
            onClick={toggleTemplateMode}
          >
            <Braces className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
        )}

        <Button
          variant="ghost"
          size="icon"
          className="mt-0.5 h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
          onClick={onDelete}
          aria-label="Delete action"
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
