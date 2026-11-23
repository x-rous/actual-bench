import { normalizeName } from "./normalize";
import { allKeysOf, expandSourceTransactions } from "./sourceItems";
import { isRevaluationKey } from "./fxPosition";
import type { SyncSourceTransaction } from "@/lib/actual/transport";
import type { SyncMapping } from "@/lib/app-db/types";

/**
 * Categories set in the target budget, sent back to the source rows they came
 * from. Only an empty source category is filled: a category someone chose in the
 * source budget is never replaced. Pure; the write lives with the caller.
 */

export type CategoryReturnRow = {
  mappingId: string;
  sourceItemKey: string;
  /** The source transaction or split line to write. */
  sourceId: string;
  date: string;
  amount: number;
  payeeId: string | null;
  payeeName: string | null;
  categoryId: string;
  categoryName: string;
};

export type CategoryReturnPlan = {
  rows: CategoryReturnRow[];
  /** Target category has no category of the same name in the source budget. */
  noMatchingCategory: number;
  /** The source row changed since it was synced; a preview should handle it first. */
  sourceChanged: number;
};

type NamedCategory = { id: string; name: string };

export function planCategoryReturn(input: {
  sourceTransactions: SyncSourceTransaction[];
  targetTransactions: Pick<SyncSourceTransaction, "id" | "categoryId">[];
  mappings: SyncMapping[];
  sourceCategories: NamedCategory[];
  targetCategories: NamedCategory[];
  groupSplits: boolean;
}): CategoryReturnPlan {
  const targetCategoryName = new Map(input.targetCategories.map((category) => [category.id, category.name]));
  const sourceByName = new Map<string, NamedCategory>();
  for (const category of input.sourceCategories) {
    const key = normalizeName(category.name);
    if (key && !sourceByName.has(key)) sourceByName.set(key, category);
  }
  const targetCategory = new Map(input.targetTransactions.map((row) => [row.id, row.categoryId]));
  const items = new Map(
    expandSourceTransactions(input.sourceTransactions, { groupSplits: input.groupSplits })
      .flatMap((item) => allKeysOf(item).map((key) => [key, item] as const))
  );

  const plan: CategoryReturnPlan = { rows: [], noMatchingCategory: 0, sourceChanged: 0 };
  for (const mapping of input.mappings) {
    if (mapping.status !== "active" || !mapping.targetTransactionId || isRevaluationKey(mapping.sourceItemKey)) continue;
    const item = items.get(mapping.sourceItemKey);
    if (!item || item.categoryId || item.reconciled || item.isTransfer || item.splitLines?.length) continue;
    // A positional split line has no id of its own to write to.
    if (item.kind === "split_line" && !item.sourceSplitId) continue;
    const categoryId = targetCategory.get(mapping.targetTransactionId);
    const name = categoryId ? targetCategoryName.get(categoryId) : undefined;
    if (!name) continue;
    if (mapping.sourceFingerprint !== item.fingerprint && !item.legacyFingerprints?.includes(mapping.sourceFingerprint)) {
      plan.sourceChanged += 1;
      continue;
    }
    const category = sourceByName.get(normalizeName(name));
    if (!category) {
      plan.noMatchingCategory += 1;
      continue;
    }
    plan.rows.push({
      mappingId: mapping.id,
      sourceItemKey: mapping.sourceItemKey,
      sourceId: item.sourceSplitId ?? item.sourceTransactionId,
      date: item.date,
      amount: item.amount,
      payeeId: item.payeeId,
      payeeName: item.payeeName,
      categoryId: category.id,
      categoryName: category.name,
    });
  }
  return plan;
}
