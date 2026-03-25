"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Plus, Trash2, ChevronsUpDown, Check, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetFooter,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { useStagedStore } from "@/store/staged";
import { valueToString } from "../utils/rulePreview";
import type { ConditionOrAction, RuleStage, ConditionsOp, AmountRange } from "@/types/entities";
import {
  CONDITION_FIELDS,
  ACTION_FIELDS,
  ACTION_OPS,
  getConditionOps,
  STAGE_OPTIONS,
  CONDITIONS_OP_OPTIONS,
} from "../utils/ruleFields";

// ─── Shared input/select styles ───────────────────────────────────────────────

const selectCls =
  "h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring/50";

const inputCls =
  "h-8 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring/50";

// ─── Shared combobox hook ─────────────────────────────────────────────────────

function useComboboxState() {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Close on outside click (registering an event listener in useEffect is fine —
  // the setState here is inside a callback, not synchronously in the effect body).
  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Call this instead of setOpen(true) — resets search and focuses the input.
  function openDropdown() {
    setSearch("");
    setOpen(true);
    requestAnimationFrame(() => searchRef.current?.focus());
  }

  function closeDropdown() {
    setOpen(false);
  }

  return { open, openDropdown, closeDropdown, search, setSearch, containerRef, searchRef };
}

// ─── SearchableCombobox (single-select) ───────────────────────────────────────

type ComboboxOption = { id: string; name: string };

function SearchableCombobox({
  options,
  value,
  onChange,
  placeholder = "— select —",
}: {
  options: ComboboxOption[];
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const { open, openDropdown, closeDropdown, search, setSearch, containerRef, searchRef } = useComboboxState();

  const selectedLabel = options.find((o) => o.id === value)?.name ?? "";
  const filtered = search.trim()
    ? options.filter((o) => o.name.toLowerCase().includes(search.toLowerCase()))
    : options;

  function select(id: string) { onChange(id); closeDropdown(); }

  return (
    <div ref={containerRef} className="relative flex-1">
      <button
        type="button"
        onClick={() => open ? closeDropdown() : openDropdown()}
        className={cn(
          "flex h-8 w-full items-center justify-between rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-2 focus:ring-ring/50",
          !selectedLabel && "text-muted-foreground"
        )}
      >
        <span className="truncate">{selectedLabel || placeholder}</span>
        <ChevronsUpDown className="ml-1 h-3 w-3 shrink-0 text-muted-foreground" />
      </button>

      {open && (
        <div className="absolute top-full left-0 z-50 mt-1 w-full min-w-[180px] rounded-md border border-border bg-popover shadow-md">
          <div className="flex items-center gap-1.5 border-b border-border px-2 py-1.5">
            <Search className="h-3 w-3 shrink-0 text-muted-foreground" />
            <input
              ref={searchRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search…"
              className="h-5 flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground focus:outline-none"
            />
          </div>
          <ul className="max-h-48 overflow-y-auto py-1">
            <li>
              <button
                type="button"
                onClick={() => select("")}
                className="flex w-full items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              >
                <Check className={cn("h-3 w-3 shrink-0", value === "" ? "opacity-100" : "opacity-0")} />
                — none —
              </button>
            </li>
            {filtered.length === 0 ? (
              <li className="px-3 py-2 text-xs text-muted-foreground italic">No results</li>
            ) : (
              filtered.map((o) => (
                <li key={o.id}>
                  <button
                    type="button"
                    onClick={() => select(o.id)}
                    className="flex w-full items-center gap-2 px-2 py-1.5 text-xs text-foreground hover:bg-accent hover:text-accent-foreground"
                  >
                    <Check className={cn("h-3 w-3 shrink-0", value === o.id ? "opacity-100" : "opacity-0")} />
                    <span className="truncate">{o.name}</span>
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

// ─── MultiSearchableCombobox (multi-select) ───────────────────────────────────

function MultiSearchableCombobox({
  options,
  values,
  onChange,
  placeholder = "— select —",
}: {
  options: ComboboxOption[];
  values: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
}) {
  const { open, openDropdown, closeDropdown, search, setSearch, containerRef, searchRef } = useComboboxState();

  const filtered = search.trim()
    ? options.filter((o) => o.name.toLowerCase().includes(search.toLowerCase()))
    : options;

  const selectedOptions = options.filter((o) => values.includes(o.id));

  function toggle(id: string) {
    onChange(values.includes(id) ? values.filter((v) => v !== id) : [...values, id]);
  }

  function remove(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    onChange(values.filter((v) => v !== id));
  }

  return (
    <div ref={containerRef} className="relative flex-1">
      {/* Trigger — shows chips + chevron */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => open ? closeDropdown() : openDropdown()}
        onKeyDown={(e) => e.key === "Enter" && (open ? closeDropdown() : openDropdown())}
        className="flex min-h-8 w-full cursor-pointer flex-wrap items-center gap-1 rounded-md border border-input bg-background px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-ring/50"
      >
        {selectedOptions.length === 0 ? (
          <span className="text-muted-foreground">{placeholder}</span>
        ) : (
          selectedOptions.map((o) => (
            <span
              key={o.id}
              className="flex items-center gap-0.5 rounded bg-accent px-1.5 py-0.5 text-[11px] font-medium text-accent-foreground"
            >
              {o.name}
              <button
                type="button"
                onClick={(e) => remove(o.id, e)}
                className="ml-0.5 text-muted-foreground hover:text-foreground"
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </span>
          ))
        )}
        <ChevronsUpDown className="ml-auto h-3 w-3 shrink-0 text-muted-foreground" />
      </div>

      {open && (
        <div className="absolute top-full left-0 z-50 mt-1 w-full min-w-[180px] rounded-md border border-border bg-popover shadow-md">
          <div className="flex items-center gap-1.5 border-b border-border px-2 py-1.5">
            <Search className="h-3 w-3 shrink-0 text-muted-foreground" />
            <input
              ref={searchRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search…"
              className="h-5 flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground focus:outline-none"
            />
          </div>
          <ul className="max-h-48 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <li className="px-3 py-2 text-xs text-muted-foreground italic">No results</li>
            ) : (
              filtered.map((o) => (
                <li key={o.id}>
                  <button
                    type="button"
                    onClick={() => toggle(o.id)}
                    className="flex w-full items-center gap-2 px-2 py-1.5 text-xs text-foreground hover:bg-accent hover:text-accent-foreground"
                  >
                    <Check className={cn("h-3 w-3 shrink-0", values.includes(o.id) ? "opacity-100" : "opacity-0")} />
                    <span className="truncate">{o.name}</span>
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

// ─── TagInput (multi-value string input) ──────────────────────────────────────

function TagInput({
  values,
  onChange,
  placeholder = "Type and press Enter…",
}: {
  values: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
}) {
  const [input, setInput] = useState("");

  function addTag() {
    const trimmed = input.trim();
    if (trimmed && !values.includes(trimmed)) {
      onChange([...values, trimmed]);
    }
    setInput("");
  }

  function removeTag(i: number) {
    onChange(values.filter((_, idx) => idx !== i));
  }

  return (
    <div className="flex flex-1 flex-wrap items-center gap-1 rounded-md border border-input bg-background px-2 py-1 min-h-8">
      {values.map((v, i) => (
        <span
          key={i}
          className="flex items-center gap-0.5 rounded bg-accent px-1.5 py-0.5 text-[11px] font-medium text-accent-foreground"
        >
          {v}
          <button
            type="button"
            onClick={() => removeTag(i)}
            className="ml-0.5 text-muted-foreground hover:text-foreground"
          >
            <X className="h-2.5 w-2.5" />
          </button>
        </span>
      ))}
      <input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addTag(); }
          if (e.key === "Backspace" && !input && values.length > 0) removeTag(values.length - 1);
        }}
        onBlur={addTag}
        placeholder={values.length === 0 ? placeholder : "add more…"}
        className="min-w-20 flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground focus:outline-none"
      />
    </div>
  );
}

// ─── EntityCombobox ───────────────────────────────────────────────────────────

function useEntityOptions(entity: "payee" | "category" | "account"): ComboboxOption[] {
  const payees     = useStagedStore((s) => s.payees);
  const categories = useStagedStore((s) => s.categories);
  const accounts   = useStagedStore((s) => s.accounts);

  const map = entity === "payee" ? payees : entity === "category" ? categories : accounts;
  return Object.values(map)
    .filter((s) => !s.isDeleted)
    .map((s) => ({ id: s.entity.id, name: s.entity.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function EntityCombobox({
  entity,
  value,
  onChange,
}: {
  entity: "payee" | "category" | "account";
  value: string;
  onChange: (v: string) => void;
}) {
  const options = useEntityOptions(entity);
  const placeholder =
    entity === "payee" ? "Select payee…" :
    entity === "category" ? "Select category…" :
    "Select account…";
  return <SearchableCombobox options={options} value={value} onChange={onChange} placeholder={placeholder} />;
}

function MultiEntityCombobox({
  entity,
  values,
  onChange,
}: {
  entity: "payee" | "category" | "account";
  values: string[];
  onChange: (v: string[]) => void;
}) {
  const options = useEntityOptions(entity);
  const placeholder =
    entity === "payee" ? "Select payees…" :
    entity === "category" ? "Select categories…" :
    "Select accounts…";
  return <MultiSearchableCombobox options={options} values={values} onChange={onChange} placeholder={placeholder} />;
}

// ─── ConditionValueInput ──────────────────────────────────────────────────────

function ConditionValueInput({
  condition,
  onChange,
}: {
  condition: ConditionOrAction;
  onChange: (c: ConditionOrAction) => void;
}) {
  const fieldDef = CONDITION_FIELDS[condition.field];
  const ops      = getConditionOps(condition.field);
  const opDef    = ops[condition.op];

  // Ops like onBudget/offBudget take no value
  if (!opDef || !opDef.hasValue) return null;

  const isMulti = condition.op === "oneOf" || condition.op === "notOneOf";

  // isbetween → dual number inputs
  if (condition.op === "isbetween") {
    const range: AmountRange =
      typeof condition.value === "object" && !Array.isArray(condition.value) && condition.value !== null
        ? (condition.value as AmountRange)
        : { num1: 0, num2: 0 };
    return (
      <div className="flex flex-1 items-center gap-1">
        <input
          type="number"
          className={inputCls}
          value={range.num1}
          onChange={(e) => onChange({ ...condition, value: { ...range, num1: Number(e.target.value) } })}
          placeholder="from"
        />
        <span className="text-xs text-muted-foreground shrink-0">–</span>
        <input
          type="number"
          className={inputCls}
          value={range.num2}
          onChange={(e) => onChange({ ...condition, value: { ...range, num2: Number(e.target.value) } })}
          placeholder="to"
        />
      </div>
    );
  }

  // oneOf / notOneOf with entity field → multi-select combobox
  if (isMulti && fieldDef?.entity) {
    const arr = Array.isArray(condition.value)
      ? (condition.value as string[])
      : condition.value ? [String(condition.value)] : [];
    return (
      <MultiEntityCombobox
        entity={fieldDef.entity}
        values={arr}
        onChange={(v) => onChange({ ...condition, value: v })}
      />
    );
  }

  // oneOf / notOneOf with string field → tag input
  if (isMulti) {
    const arr = Array.isArray(condition.value)
      ? (condition.value as string[])
      : condition.value ? [String(condition.value)] : [];
    return (
      <TagInput
        values={arr}
        onChange={(v) => onChange({ ...condition, value: v })}
        placeholder="Type and press Enter…"
      />
    );
  }

  // Single entity → single combobox
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

  // Number field → number input
  if (fieldDef?.type === "number") {
    return (
      <input
        type="number"
        className={inputCls}
        value={valueToString(condition.value)}
        onChange={(e) => onChange({ ...condition, value: e.target.value })}
        placeholder="value…"
      />
    );
  }

  // Default → text input
  return (
    <input
      className={inputCls}
      value={valueToString(condition.value)}
      onChange={(e) => onChange({ ...condition, value: e.target.value })}
      placeholder="value…"
    />
  );
}

// ─── ConditionRow ─────────────────────────────────────────────────────────────

function ConditionRow({
  condition,
  onChange,
  onDelete,
}: {
  condition: ConditionOrAction;
  onChange: (c: ConditionOrAction) => void;
  onDelete: () => void;
}) {
  const field = condition.field;
  const ops   = getConditionOps(field);

  const setField = useCallback((newField: string) => {
    const newDef  = CONDITION_FIELDS[newField];
    const firstOp = Object.keys(getConditionOps(newField))[0] ?? "is";
    onChange({ field: newField, op: firstOp, value: "", type: newDef?.type ?? "string" });
  }, [onChange]);

  function handleOpChange(newOp: string) {
    const wasMulti  = condition.op === "oneOf" || condition.op === "notOneOf";
    const isMulti   = newOp === "oneOf" || newOp === "notOneOf";
    const isBetween = newOp === "isbetween";
    const hasValue  = ops[newOp]?.hasValue !== false;

    let newValue: ConditionOrAction["value"];

    if (!hasValue) {
      newValue = "";
    } else if (isBetween) {
      newValue =
        typeof condition.value === "object" && !Array.isArray(condition.value)
          ? condition.value   // already AmountRange
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
      {/* Field selector */}
      <select
        className={cn(selectCls, "w-32 shrink-0")}
        value={field ?? ""}
        onChange={(e) => setField(e.target.value)}
      >
        {Object.entries(CONDITION_FIELDS).map(([k, def]) => (
          <option key={k} value={k}>{def.label}</option>
        ))}
      </select>

      {/* Operator selector */}
      <select
        className={cn(selectCls, "w-32 shrink-0")}
        value={condition.op ?? ""}
        onChange={(e) => handleOpChange(e.target.value)}
      >
        {Object.entries(ops).map(([k, def]) => (
          <option key={k} value={k}>{def.label}</option>
        ))}
      </select>

      {/* Value input — varies by op and field type */}
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

function ActionRow({
  action,
  onChange,
  onDelete,
}: {
  action: ConditionOrAction;
  onChange: (a: ConditionOrAction) => void;
  onDelete: () => void;
}) {
  const field    = action.field;
  const fieldDef = ACTION_FIELDS[field];

  const setField = useCallback((newField: string) => {
    const newDef = ACTION_FIELDS[newField];
    onChange({ field: newField, op: "set", value: "", type: newDef?.type ?? "string" });
  }, [onChange]);

  const value = valueToString(action.value);

  return (
    <div className="flex items-center gap-1.5">
      {/* Field selector */}
      <select
        className={cn(selectCls, "w-32 shrink-0")}
        value={field ?? ""}
        onChange={(e) => setField(e.target.value)}
      >
        {Object.entries(ACTION_FIELDS).map(([k, def]) => (
          <option key={k} value={k}>{def.label}</option>
        ))}
      </select>

      {/* Op — always "set", shown as label */}
      <span className="shrink-0 text-xs text-muted-foreground w-10 text-center">
        {ACTION_OPS["set"]?.label ?? "set to"}
      </span>

      {/* Value — entity combobox or plain text input */}
      {fieldDef?.entity ? (
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
        className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
        onClick={onDelete}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

// ─── RuleDrawer ───────────────────────────────────────────────────────────────

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** ID of the rule to edit. Null = creating a new rule. */
  ruleId: string | null;
};

export function RuleDrawer({ open, onOpenChange, ruleId }: Props) {
  const stagedRules  = useStagedStore((s) => s.rules);
  const stageNew     = useStagedStore((s) => s.stageNew);
  const stageUpdate  = useStagedStore((s) => s.stageUpdate);
  const pushUndo     = useStagedStore((s) => s.pushUndo);

  const existingRule = ruleId ? stagedRules[ruleId]?.entity : null;

  const [stage, setStage]               = useState<RuleStage>("default");
  const [conditionsOp, setConditionsOp] = useState<ConditionsOp>("and");
  const [conditions, setConditions]     = useState<ConditionOrAction[]>([]);
  const [actions, setActions]           = useState<ConditionOrAction[]>([]);

  // Populate local state whenever the drawer opens
  useEffect(() => {
    if (!open) return;
    if (existingRule) {
      setStage(existingRule.stage);
      setConditionsOp(existingRule.conditionsOp);
      setConditions(structuredClone(existingRule.conditions));
      setActions(structuredClone(existingRule.actions));
    } else {
      setStage("default");
      setConditionsOp("and");
      setConditions([{ field: "payee", op: "is", value: "", type: "id" }]);
      setActions([{ field: "category", op: "set", value: "", type: "id" }]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, ruleId]);

  function addCondition() {
    setConditions((prev) => [...prev, { field: "payee", op: "is", value: "", type: "id" }]);
  }

  function addAction() {
    setActions((prev) => [...prev, { field: "category", op: "set", value: "", type: "id" }]);
  }

  function updateCondition(i: number, c: ConditionOrAction) {
    setConditions((prev) => prev.map((x, idx) => (idx === i ? c : x)));
  }

  function updateAction(i: number, a: ConditionOrAction) {
    setActions((prev) => prev.map((x, idx) => (idx === i ? a : x)));
  }

  function handleSave() {
    pushUndo();
    if (ruleId && existingRule) {
      stageUpdate("rules", ruleId, { stage, conditionsOp, conditions, actions });
    } else {
      stageNew("rules", {
        id: crypto.randomUUID(),
        stage,
        conditionsOp,
        conditions,
        actions,
      });
    }
    onOpenChange(false);
  }

  const isNew = !ruleId;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="data-[side=right]:w-full data-[side=right]:sm:max-w-4xl flex flex-col overflow-hidden p-0 gap-0"
      >
        <SheetHeader className="border-b px-4 py-3">
          <SheetTitle>{isNew ? "New Rule" : "Edit Rule"}</SheetTitle>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-6">
          {/* Stage + Conditions Op ─────────────────────────────────────────── */}
          <div className="flex items-end gap-4">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-muted-foreground">Stage</label>
              <select
                className={selectCls}
                value={stage ?? "default"}
                onChange={(e) => setStage(e.target.value as RuleStage)}
              >
                {STAGE_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s.charAt(0).toUpperCase() + s.slice(1)}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1 flex-1">
              <label className="text-xs font-medium text-muted-foreground">Match</label>
              <select
                className={selectCls}
                value={conditionsOp ?? "and"}
                onChange={(e) => setConditionsOp(e.target.value as ConditionsOp)}
              >
                {CONDITIONS_OP_OPTIONS.map((op) => (
                  <option key={op} value={op}>
                    {op === "and" ? "ALL conditions (and)" : "ANY condition (or)"}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Conditions ───────────────────────────────────────────────────── */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Conditions
              </p>
              <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={addCondition}>
                <Plus className="h-3 w-3 mr-1" />
                Add
              </Button>
            </div>

            {conditions.length === 0 ? (
              <p className="text-xs italic text-muted-foreground">
                No conditions — rule will match all transactions.
              </p>
            ) : (
              <div className="space-y-2">
                {conditions.map((c, i) => (
                  <ConditionRow
                    key={i}
                    condition={c}
                    onChange={(updated) => updateCondition(i, updated)}
                    onDelete={() => setConditions((prev) => prev.filter((_, idx) => idx !== i))}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Actions ──────────────────────────────────────────────────────── */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Actions
              </p>
              <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={addAction}>
                <Plus className="h-3 w-3 mr-1" />
                Add
              </Button>
            </div>

            {actions.length === 0 ? (
              <p className="text-xs italic text-muted-foreground">
                No actions — rule will have no effect.
              </p>
            ) : (
              <div className="space-y-2">
                {actions.map((a, i) => (
                  <ActionRow
                    key={i}
                    action={a}
                    onChange={(updated) => updateAction(i, updated)}
                    onDelete={() => setActions((prev) => prev.filter((_, idx) => idx !== i))}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        <SheetFooter className="flex-row justify-end gap-2 border-t px-4 py-3">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave}>
            {isNew ? "Add Rule" : "Apply Changes"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
