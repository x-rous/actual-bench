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

function mergeSummaries(a: SaveSummary, b: SaveSummary): SaveSummary {
  return { succeeded: [...a.succeeded, ...b.succeeded], failed: [...a.failed, ...b.failed], idMap: { ...a.idMap, ...b.idMap } };
}

/**
 * Shared staged-save orchestration for the connected budget.
 *
 * Keeps entity dependency order in one place, one entity type at a time
 * (Direct writes stay serialized, and each step can use the ids the steps
 * before it created):
 * 1. accounts, payees and tags
 * 2. category group creates and renames, then categories (new group ids), then
 *    group deletes, once categories have been moved out of them
 * 3. schedules, after accounts and payees (new payee and account ids)
 * 4. rules, after everything they can reference
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
    const accounts = hasPendingAccounts ? await saveAccounts() : EMPTY_SAVE_SUMMARY;
    const payees = hasPendingPayees ? await savePayees() : EMPTY_SAVE_SUMMARY;
    const tags = hasPendingTags ? await saveTags() : EMPTY_SAVE_SUMMARY;

    const groupUpserts = hasPendingGroups ? await saveCategoryGroups("upsert") : EMPTY_SAVE_SUMMARY;
    const categories = hasPendingCategories
      ? await saveCategories(groupUpserts.idMap)
      : EMPTY_SAVE_SUMMARY;
    const groupDeletes = hasPendingGroups ? await saveCategoryGroups("delete") : EMPTY_SAVE_SUMMARY;
    const categoryGroups = mergeSummaries(groupUpserts, groupDeletes);

    const schedules = hasPendingSchedules
      ? await saveSchedules({ ...payees.idMap, ...accounts.idMap })
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
