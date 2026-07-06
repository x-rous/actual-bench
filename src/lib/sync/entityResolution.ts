import { normalizeName } from "./normalize";
import type { SyncFlowPlanConfig } from "./flowConfig";
import type { SyncSourceItem } from "./sourceItems";
import type { SyncPlannerCategory, SyncPlannerPayee } from "./plannedChanges";

/**
 * Match source payees/categories to target entities by normalized name
 * (RD-053 / PR-019). Source ids are meaningless in the target budget, so
 * matching is always name-based; the source id is never carried across.
 */

export type PayeeResolution = {
  /** Existing target payee id when matched, else null. */
  payeeId: string | null;
  /** Name to create on apply when no match and policy allows; else null. */
  payeeName: string | null;
  willCreateOnApply: boolean;
  /** True when the source had a payee name but we intentionally left it empty. */
  leftEmpty: boolean;
};

export type CategoryResolution = {
  categoryId: string | null;
  /** True when the source had a category name with no target match. */
  leftEmpty: boolean;
};

function buildNameIndex(
  entities: { id: string; name: string }[]
): Map<string, string> {
  const index = new Map<string, string>();
  for (const entity of entities) {
    const key = normalizeName(entity.name);
    // First match wins; keeps resolution deterministic on duplicate names.
    if (key && !index.has(key)) index.set(key, entity.id);
  }
  return index;
}

export function resolvePayee(
  item: Pick<SyncSourceItem, "payeeName">,
  config: Pick<SyncFlowPlanConfig, "missingPayee">,
  targetPayees: SyncPlannerPayee[]
): PayeeResolution {
  const normalized = normalizeName(item.payeeName);
  // No usable source payee → nothing to resolve, leave empty silently.
  if (!normalized) {
    return { payeeId: null, payeeName: null, willCreateOnApply: false, leftEmpty: false };
  }

  const match = buildNameIndex(targetPayees).get(normalized);
  if (match) {
    return { payeeId: match, payeeName: null, willCreateOnApply: false, leftEmpty: false };
  }

  if (config.missingPayee === "create") {
    // Carry the raw name so apply can create/resolve it.
    return {
      payeeId: null,
      payeeName: item.payeeName ?? null,
      willCreateOnApply: true,
      leftEmpty: false,
    };
  }

  return { payeeId: null, payeeName: null, willCreateOnApply: false, leftEmpty: true };
}

export function resolveCategory(
  item: Pick<SyncSourceItem, "categoryName">,
  targetCategories: SyncPlannerCategory[]
): CategoryResolution {
  const normalized = normalizeName(item.categoryName);
  // No source category → not a "missing" case, just empty.
  if (!normalized) return { categoryId: null, leftEmpty: false };

  const match = buildNameIndex(targetCategories).get(normalized);
  // MVP never auto-creates categories; unmatched stays empty and does not block.
  return match
    ? { categoryId: match, leftEmpty: false }
    : { categoryId: null, leftEmpty: true };
}
