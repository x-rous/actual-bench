"use client";

import { Plus } from "lucide-react";
import { SearchableCombobox, MultiSearchableCombobox } from "@/components/ui/combobox";
import type { ComboboxOption } from "@/components/ui/combobox";
import type { RuleEntityType } from "../lib/ruleEditor";

const ENTITY_LABEL: Record<RuleEntityType, string> = {
  payee: "Payee",
  category: "Category",
  categoryGroup: "Category group",
  account: "Account",
};

const MISSING_LABEL: Record<RuleEntityType, string> = {
  payee: "[deleted payee]",
  category: "[deleted category]",
  categoryGroup: "[deleted group]",
  account: "[deleted account]",
};

/**
 * Rows for ids the rule holds but the budget no longer has (a deleted payee,
 * account, category or group). Without them the picker drew nothing for such
 * an id - no chip, no label - while the rule kept it, so it could be neither
 * seen nor removed. Listed first, marked, so they can be cleared or replaced.
 */
export function withMissingOptions(entity: RuleEntityType, options: ComboboxOption[], ids: string[]): ComboboxOption[] {
  const known = new Set(options.map((o) => o.id));
  const missing = ids.filter((id) => id && !known.has(id));
  if (missing.length === 0) return options;
  return [
    ...missing.map((id) => ({ id, name: MISSING_LABEL[entity], trailing: "not in this budget" })),
    ...options,
  ];
}

/** The rule editor's entity pickers: the shared lists, plus a "Create …" footer. */
export function EntityCombobox({
  entity,
  options,
  value,
  onChange,
  onQuickCreate,
  compact = false,
}: {
  entity: RuleEntityType;
  options: ComboboxOption[];
  value: string;
  onChange: (v: string) => void;
  onQuickCreate?: (name: string) => void;
  compact?: boolean;
}) {
  const placeholder =
    entity === "payee"
      ? "Select payee…"
      : entity === "category"
      ? "Select category…"
      : entity === "categoryGroup"
      ? "Select category group…"
      : "Select account…";

  const ariaLabel = ENTITY_LABEL[entity];
  const canQuickCreate = onQuickCreate && (entity === "payee" || entity === "category");
  const entityLabel = entity === "payee" ? "payee" : "category";

  return (
    <SearchableCombobox
      options={withMissingOptions(entity, options, [value])}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      ariaLabel={ariaLabel}
      triggerClassName={compact ? "h-7" : undefined}
      footer={
        canQuickCreate
          ? (search) =>
              search.trim() ? (
                <button
                  type="button"
                  className="flex w-full items-center gap-1.5 px-3 py-2 text-xs text-primary hover:bg-accent hover:text-accent-foreground"
                  onClick={() => onQuickCreate!(search.trim())}
                >
                  <Plus className="h-3 w-3 shrink-0" />
                  Create {entityLabel} &ldquo;{search.trim()}&rdquo;
                </button>
              ) : null
          : undefined
      }
    />
  );
}

export function MultiEntityCombobox({
  entity,
  options,
  values,
  onChange,
  compact = false,
}: {
  entity: RuleEntityType;
  options: ComboboxOption[];
  values: string[];
  onChange: (v: string[]) => void;
  compact?: boolean;
}) {
  const placeholder =
    entity === "payee"
      ? "Select payees…"
      : entity === "category"
      ? "Select categories…"
      : entity === "categoryGroup"
      ? "Select category groups…"
      : "Select accounts…";
  return (
    <MultiSearchableCombobox
      options={withMissingOptions(entity, options, values)}
      values={values}
      onChange={onChange}
      placeholder={placeholder}
      ariaLabel={ENTITY_LABEL[entity]}
      triggerClassName={compact ? "h-7" : undefined}
    />
  );
}
