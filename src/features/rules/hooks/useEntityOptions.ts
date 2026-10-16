"use client";

import { useMemo } from "react";
import {
  buildAccountOptions,
  buildCategoryGroupOptions,
  buildCategoryOptions,
  buildPayeeOptions,
} from "@/components/ui/entity-options";
import { useStagedAccounts, useStagedCategories, useStagedPayees } from "@/hooks/useStagedEntities";
import type { RuleEntityOptionsMap } from "../lib/ruleEditor";

/**
 * The picker options for every rule entity, from the staged store. Hidden
 * categories and closed accounts stay in (dimmed and marked), so rules that
 * reference them remain editable.
 */
export function useEntityOptionsMap(): RuleEntityOptionsMap {
  const { accounts, groups: accountGroups } = useStagedAccounts();
  const { categories, groups: categoryGroups } = useStagedCategories();
  const payees = useStagedPayees();

  return useMemo(
    () => ({
      account: buildAccountOptions(accounts, accountGroups),
      category: buildCategoryOptions(categories, categoryGroups),
      categoryGroup: buildCategoryGroupOptions(categoryGroups),
      payee: buildPayeeOptions(payees),
    }),
    [accounts, accountGroups, categories, categoryGroups, payees]
  );
}
