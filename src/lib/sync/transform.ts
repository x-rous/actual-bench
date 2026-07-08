import { buildSyncNotesMarker, applySyncNotesMarker } from "./notesMarker";
import type { SyncFlowPlanConfig } from "./flowConfig";
import type { SyncSourceItem } from "./sourceItems";
import type {
  CategoryResolution,
  PayeeResolution,
} from "./entityResolution";
import type { PlannedTargetPayload } from "./plannedChanges";

/**
 * Pure transforms from a source item to a planned target payload
 * (RD-053 / PR-019). No Actual access, no id generation side effects.
 */

/** Reverse the sign by default; same-sign is an opt-in. */
export function transformAmount(
  amount: number,
  direction: SyncFlowPlanConfig["amountDirection"]
): number {
  return direction === "same" ? amount : -amount;
}

/** Build the target notes, applying the visible sync marker per config. */
export function transformNotes(
  sourceNotes: string | null,
  config: Pick<
    SyncFlowPlanConfig,
    "notesMarkerEnabled" | "copySourceNotes" | "sourceBudgetName" | "sourceAccountName"
  >
): string | null {
  const carried = config.copySourceNotes ? sourceNotes ?? "" : "";

  if (!config.notesMarkerEnabled) {
    const trimmed = carried.trim();
    return trimmed ? trimmed : null;
  }

  const marker = buildSyncNotesMarker({
    sourceBudgetName: config.sourceBudgetName,
    sourceAccountName: config.sourceAccountName,
  });
  return applySyncNotesMarker(carried, marker);
}

/**
 * Assemble the planned target payload from a source item, config, resolved
 * payee/category, and the durable marker. New synced rows are created uncleared
 * (`cleared: false`); target rules may adjust this on apply.
 */
export function buildPlannedTargetPayload(input: {
  item: SyncSourceItem;
  config: SyncFlowPlanConfig;
  payee: PayeeResolution;
  category: CategoryResolution;
  importedId: string | null;
}): PlannedTargetPayload {
  const { item, config, payee, category, importedId } = input;
  return {
    accountId: config.targetAccountId,
    date: item.date,
    amount: transformAmount(item.amount, config.amountDirection),
    payeeId: payee.payeeId,
    payeeName: payee.payeeName,
    categoryId: category.categoryId,
    notes: transformNotes(item.notes, config),
    cleared: false,
    importedId,
  };
}
