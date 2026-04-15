"use client";

import { useAccountsSave } from "@/features/accounts/hooks/useAccountsSave";
import { usePayeesSave } from "@/features/payees/hooks/usePayeesSave";
import { useCategoryGroupsSave } from "@/features/categories/hooks/useCategoryGroupsSave";
import { useCategoriesSave } from "@/features/categories/hooks/useCategoriesSave";
import { useRulesSave } from "@/features/rules/hooks/useRulesSave";
import { useSchedulesSave } from "@/features/schedules/hooks/useSchedulesSave";
import { useTagsSave } from "@/features/tags/hooks/useTagsSave";
import type { SaveSummary } from "@/types/diff";

const EMPTY_SAVE_SUMMARY: SaveSummary = {
  succeeded: [],
  failed: [],
  idMap: {},
};

type BudgetSavePipelineResult = {
  results: {
    accounts: SaveSummary;
    payees: SaveSummary;
    categoryGroups: SaveSummary;
    categories: SaveSummary;
    rules: SaveSummary;
    schedules: SaveSummary;
    tags: SaveSummary;
  };
  totalSucceeded: number;
  totalFailed: number;
};

function countSaveSummary(summary: SaveSummary) {
  return {
    succeeded: summary.succeeded.length,
    failed: summary.failed.length,
  };
}

/**
 * Shared staged-save orchestration for the connected budget.
 *
 * Keeps entity dependency order in one place:
 * 1. save independent entities in parallel
 * 2. save categories after groups to resolve new group IDs
 * 3. save rules after accounts/payees/categories to resolve entity references
 */
export function useBudgetSavePipeline() {
  const {
    save: saveAccounts,
    isSaving: isSavingAccounts,
    hasPendingChanges: hasPendingAccounts,
  } = useAccountsSave();
  const {
    save: savePayees,
    isSaving: isSavingPayees,
    hasPendingChanges: hasPendingPayees,
  } = usePayeesSave();
  const {
    save: saveCategoryGroups,
    isSaving: isSavingGroups,
    hasPendingChanges: hasPendingGroups,
  } = useCategoryGroupsSave();
  const {
    save: saveCategories,
    isSaving: isSavingCategories,
    hasPendingChanges: hasPendingCategories,
  } = useCategoriesSave();
  const {
    save: saveRules,
    isSaving: isSavingRules,
    hasPendingChanges: hasPendingRules,
  } = useRulesSave();
  const {
    save: saveSchedules,
    isSaving: isSavingSchedules,
    hasPendingChanges: hasPendingSchedules,
  } = useSchedulesSave();
  const {
    save: saveTags,
    isSaving: isSavingTags,
    hasPendingChanges: hasPendingTags,
  } = useTagsSave();

  const isSaving =
    isSavingAccounts ||
    isSavingPayees ||
    isSavingGroups ||
    isSavingCategories ||
    isSavingRules ||
    isSavingSchedules ||
    isSavingTags;

  async function saveAll(): Promise<BudgetSavePipelineResult> {
    const [
      accounts,
      payees,
      categoryGroups,
      tags,
      schedules,
    ] = await Promise.all([
      hasPendingAccounts ? saveAccounts() : Promise.resolve(EMPTY_SAVE_SUMMARY),
      hasPendingPayees ? savePayees() : Promise.resolve(EMPTY_SAVE_SUMMARY),
      hasPendingGroups ? saveCategoryGroups() : Promise.resolve(EMPTY_SAVE_SUMMARY),
      hasPendingTags ? saveTags() : Promise.resolve(EMPTY_SAVE_SUMMARY),
      hasPendingSchedules ? saveSchedules() : Promise.resolve(EMPTY_SAVE_SUMMARY),
    ]);

    const categories = hasPendingCategories
      ? await saveCategories(categoryGroups.idMap)
      : EMPTY_SAVE_SUMMARY;
    const rules = hasPendingRules
      ? await saveRules({
          ...payees.idMap,
          ...accounts.idMap,
          ...categoryGroups.idMap,
          ...categories.idMap,
        })
      : EMPTY_SAVE_SUMMARY;

    const counts = [
      countSaveSummary(accounts),
      countSaveSummary(payees),
      countSaveSummary(categoryGroups),
      countSaveSummary(categories),
      countSaveSummary(rules),
      countSaveSummary(schedules),
      countSaveSummary(tags),
    ];

    return {
      results: {
        accounts,
        payees,
        categoryGroups,
        categories,
        rules,
        schedules,
        tags,
      },
      totalSucceeded: counts.reduce((sum, count) => sum + count.succeeded, 0),
      totalFailed: counts.reduce((sum, count) => sum + count.failed, 0),
    };
  }

  return { saveAll, isSaving };
}
