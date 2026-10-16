"use client";

import { useMemo } from "react";
import { useStagedStore } from "@/store/staged";
import type { BaseEntity } from "@/types/entities";
import type { StagedMap } from "@/types/staged";

/** The live (not deleted) entities of a staged map, in the order they were loaded. */
function live<T extends BaseEntity>(map: StagedMap<T>): T[] {
  return Object.values(map)
    .filter((staged) => !staged.isDeleted)
    .map((staged) => staged.entity);
}

/**
 * The staged accounts, categories and payees, ready for the pickers in
 * `@/components/ui/entity-picker`. Unsaved edits are included, deletions are
 * not, and the order is Actual's.
 */
export function useStagedAccounts() {
  const accounts = useStagedStore((s) => s.accounts);
  const groups = useStagedStore((s) => s.accountGroups);
  return useMemo(() => ({ accounts: live(accounts), groups: live(groups) }), [accounts, groups]);
}

export function useStagedCategories() {
  const categories = useStagedStore((s) => s.categories);
  const groups = useStagedStore((s) => s.categoryGroups);
  return useMemo(() => ({ categories: live(categories), groups: live(groups) }), [categories, groups]);
}

export function useStagedPayees() {
  const payees = useStagedStore((s) => s.payees);
  return useMemo(() => live(payees), [payees]);
}
