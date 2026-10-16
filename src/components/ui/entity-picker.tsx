"use client";

import type { ReactNode } from "react";
import { SearchableCombobox, type ComboboxOption } from "@/components/ui/combobox";
import { cn } from "@/lib/utils";
import {
  buildAccountOptions,
  buildCategoryGroupOptions,
  buildCategoryOptions,
  buildPayeeOptions,
  type AccountItem,
  type AccountOptionsConfig,
  type CategoryGroupItem,
  type CategoryGroupOptionsConfig,
  type CategoryItem,
  type CategoryOptionsConfig,
  type PayeeItem,
  type PayeeOptionsConfig,
} from "@/components/ui/entity-options";

/**
 * The app's pickers for accounts, categories, category groups and payees: one
 * searchable list, grouped the same way everywhere (see `entity-options.ts`).
 * Use these for any of those four; use `Select` for short fixed choices.
 *
 * Each takes its data as props, so a feature can pass the staged store, a
 * remote server's accounts or a loan directory alike, plus the restrictions it
 * needs (`exclude`, `filter`, `closed`, `side`, ...). `allowNone` adds a row
 * that clears the field; a filter names it with `noneLabel` ("All accounts").
 */
type PickerProps = {
  value: string;
  onChange: (id: string) => void;
  /** Required: the trigger is a button, so no `<label>` can name it. */
  ariaLabel: string;
  ariaDescribedBy?: string;
  placeholder?: string;
  allowNone?: boolean;
  noneLabel?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** `sm` is the compact form for dense rows and filter bars. */
  size?: "default" | "sm";
  className?: string;
  footer?: (search: string) => ReactNode;
  /** Fixed rows ahead of the list, such as "Uncategorized only". */
  extra?: { id: string; name: string }[];
};

function Picker({ size, className, allowNone = false, extra = [], options, ...props }: PickerProps & { options: ComboboxOption[] }) {
  return (
    <SearchableCombobox
      {...props}
      options={[...extra, ...options]}
      allowNone={allowNone}
      triggerClassName={cn(size === "sm" && "h-7", className)}
    />
  );
}

export type AccountPickerProps<T extends AccountItem = AccountItem> = PickerProps &
  AccountOptionsConfig<T> & { accounts: readonly T[]; groups?: readonly { id: string; name: string }[] };

export function AccountPicker<T extends AccountItem>({
  accounts,
  groups,
  closed,
  budget,
  exclude,
  filter,
  placeholder = "Select account…",
  ...props
}: AccountPickerProps<T>) {
  const options = buildAccountOptions(accounts, groups, { closed, budget, exclude, filter });
  return <Picker {...props} placeholder={placeholder} options={options} />;
}

export type CategoryPickerProps<T extends CategoryItem = CategoryItem> = PickerProps &
  CategoryOptionsConfig<T> & { categories: readonly T[]; groups?: readonly CategoryGroupItem[] };

export function CategoryPicker<T extends CategoryItem>({
  categories,
  groups,
  hidden,
  side,
  exclude,
  filter,
  trailing,
  placeholder = "Select category…",
  ...props
}: CategoryPickerProps<T>) {
  const options = buildCategoryOptions(categories, groups, { hidden, side, exclude, filter, trailing });
  return <Picker {...props} placeholder={placeholder} options={options} />;
}

export function CategoryGroupPicker<T extends CategoryGroupItem>({
  groups,
  hidden,
  side,
  exclude,
  filter,
  placeholder = "Select category group…",
  ...props
}: PickerProps & CategoryGroupOptionsConfig<T> & { groups: readonly T[] }) {
  const options = buildCategoryGroupOptions(groups, { hidden, side, exclude, filter });
  return <Picker {...props} placeholder={placeholder} options={options} />;
}

export function PayeePicker<T extends PayeeItem>({
  payees,
  transfers,
  exclude,
  filter,
  placeholder = "Select payee…",
  ...props
}: PickerProps & PayeeOptionsConfig<T> & { payees: readonly T[] }) {
  const options = buildPayeeOptions(payees, { transfers, exclude, filter });
  return <Picker {...props} placeholder={placeholder} options={options} />;
}
