"use client";

import { useMemo } from "react";
import { useStagedStore } from "@/store/staged";
import type { ComboboxOption } from "@/components/ui/combobox";
import type { RuleEntityOptionsMap, RuleEntityType } from "../lib/ruleEditor";

/**
 * Returns a list of { id, name } options for the given entity type,
 * sourced from the staged store. Deleted entities are excluded.
 *
 * For "category", returns a grouped flat list with group headers interspersed
 * (preserving API order). Group headers have isGroupHeader: true and are not
 * selectable. Hidden categories and groups are included so rules that reference
 * them remain editable.
 *
 * For "payee" and "account", returns a flat alphabetically sorted list.
 */
function buildEntityOptionsMap(
  payees: ReturnType<typeof useStagedStore.getState>["payees"],
  categories: ReturnType<typeof useStagedStore.getState>["categories"],
  accounts: ReturnType<typeof useStagedStore.getState>["accounts"],
  categoryGroups: ReturnType<typeof useStagedStore.getState>["categoryGroups"]
): RuleEntityOptionsMap {
  const categoryOptions: ComboboxOption[] = [];

  const groups = Object.values(categoryGroups).filter((s) => !s.isDeleted);
  for (const g of groups) {
    const children = g.entity.categoryIds
      .map((id) => categories[id])
      .filter((s) => s !== undefined && !s.isDeleted)
      .map((s) => ({ id: s.entity.id, name: s.entity.name, hidden: s.entity.hidden || g.entity.hidden }));

    if (children.length === 0) continue;

    categoryOptions.push({ id: g.entity.id, name: g.entity.name, isGroupHeader: true, hidden: g.entity.hidden });
    categoryOptions.push(...children);
  }

  const groupedIds = new Set(categoryOptions.filter((o) => !o.isGroupHeader).map((o) => o.id));
  const orphans = Object.values(categories)
    .filter((s) => !s.isDeleted && !groupedIds.has(s.entity.id))
    .map((s) => ({ id: s.entity.id, name: s.entity.name, hidden: s.entity.hidden }));
  if (orphans.length > 0) {
    categoryOptions.push({ id: "__orphans__", name: "Uncategorized", isGroupHeader: true });
    categoryOptions.push(...orphans);
  }

  return {
    category: categoryOptions,
    categoryGroup: Object.values(categoryGroups)
      .filter((s) => !s.isDeleted)
      .map((s) => ({ id: s.entity.id, name: s.entity.name, hidden: s.entity.hidden }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    payee: Object.values(payees)
      .filter((s) => !s.isDeleted)
      .map((s) => ({ id: s.entity.id, name: s.entity.name }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    account: Object.values(accounts)
      .filter((s) => !s.isDeleted)
      .map((s) => ({ id: s.entity.id, name: s.entity.name }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

export function useEntityOptionsMap(): RuleEntityOptionsMap {
  const payees = useStagedStore((s) => s.payees);
  const categories = useStagedStore((s) => s.categories);
  const accounts = useStagedStore((s) => s.accounts);
  const categoryGroups = useStagedStore((s) => s.categoryGroups);

  return useMemo(
    () => buildEntityOptionsMap(payees, categories, accounts, categoryGroups),
    [payees, categories, accounts, categoryGroups]
  );
}

export function useEntityOptions(entity: RuleEntityType): ComboboxOption[] {
  const options = useEntityOptionsMap();
  return options[entity];
}
