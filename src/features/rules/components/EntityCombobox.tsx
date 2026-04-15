"use client";

import { SearchableCombobox, MultiSearchableCombobox } from "@/components/ui/combobox";
import type { ComboboxOption } from "@/components/ui/combobox";
import type { RuleEntityType } from "../lib/ruleEditor";

export function EntityCombobox({
  entity,
  options,
  value,
  onChange,
}: {
  entity: RuleEntityType;
  options: ComboboxOption[];
  value: string;
  onChange: (v: string) => void;
}) {
  const placeholder =
    entity === "payee"
      ? "Select payee…"
      : entity === "category"
      ? "Select category…"
      : entity === "categoryGroup"
      ? "Select category group…"
      : "Select account…";
  return (
    <SearchableCombobox options={options} value={value} onChange={onChange} placeholder={placeholder} />
  );
}

export function MultiEntityCombobox({
  entity,
  options,
  values,
  onChange,
}: {
  entity: RuleEntityType;
  options: ComboboxOption[];
  values: string[];
  onChange: (v: string[]) => void;
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
      options={options}
      values={values}
      onChange={onChange}
      placeholder={placeholder}
    />
  );
}
