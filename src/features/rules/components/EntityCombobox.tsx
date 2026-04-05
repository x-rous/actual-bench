"use client";

import { SearchableCombobox, MultiSearchableCombobox } from "@/components/ui/combobox";
import { useEntityOptions } from "../hooks/useEntityOptions";

export function EntityCombobox({
  entity,
  value,
  onChange,
}: {
  entity: "payee" | "category" | "account" | "categoryGroup";
  value: string;
  onChange: (v: string) => void;
}) {
  const options = useEntityOptions(entity);
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
  values,
  onChange,
}: {
  entity: "payee" | "category" | "account" | "categoryGroup";
  values: string[];
  onChange: (v: string[]) => void;
}) {
  const options = useEntityOptions(entity);
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
