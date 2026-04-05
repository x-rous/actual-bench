"use client";

import { useStagedStore } from "@/store/staged";
import type { ComboboxOption } from "@/components/ui/combobox";

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
export function useEntityOptions(entity: "payee" | "category" | "account"): ComboboxOption[] {
  const payees = useStagedStore((s) => s.payees);
  const categories = useStagedStore((s) => s.categories);
  const accounts = useStagedStore((s) => s.accounts);
  const categoryGroups = useStagedStore((s) => s.categoryGroups);

  if (entity === "category") {
    const groups = Object.values(categoryGroups).filter((s) => !s.isDeleted);
    const result: ComboboxOption[] = [];

    for (const g of groups) {
      const children = g.entity.categoryIds
        .map((id) => categories[id])
        .filter((s) => s !== undefined && !s.isDeleted)
        .map((s) => ({ id: s.entity.id, name: s.entity.name, hidden: s.entity.hidden || g.entity.hidden }));

      if (children.length === 0) continue;

      result.push({ id: g.entity.id, name: g.entity.name, isGroupHeader: true, hidden: g.entity.hidden });
      result.push(...children);
    }

    // Orphaned categories (groupId not in any known group) appended at the end.
    const groupedIds = new Set(result.filter((o) => !o.isGroupHeader).map((o) => o.id));
    const orphans = Object.values(categories)
      .filter((s) => !s.isDeleted && !groupedIds.has(s.entity.id))
      .map((s) => ({ id: s.entity.id, name: s.entity.name, hidden: s.entity.hidden }));
    if (orphans.length > 0) {
      result.push({ id: "__orphans__", name: "Uncategorized", isGroupHeader: true });
      result.push(...orphans);
    }

    return result;
  }

  const map = entity === "payee" ? payees : accounts;
  return Object.values(map)
    .filter((s) => !s.isDeleted)
    .map((s) => ({ id: s.entity.id, name: s.entity.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
