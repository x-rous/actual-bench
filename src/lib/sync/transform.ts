import { buildSyncNotesMarker, applySyncNotesMarker } from "./notesMarker";
import { convertMinorUnits } from "@/lib/fx/fxMath";
import type { SyncFlowPlanConfig } from "./flowConfig";
import type { SyncSourceItem } from "./sourceItems";
import type {
  CategoryResolution,
  PayeeResolution,
} from "./entityResolution";
import type { FxRateInfo, PlannedSplitChild, PlannedTargetPayload } from "./plannedChanges";

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
    "notesMarkerEnabled" | "notesMarker" | "copySourceNotes" | "sourceBudgetName" | "sourceAccountName"
  >
): string | null {
  const carried = config.copySourceNotes ? sourceNotes ?? "" : "";

  if (!config.notesMarkerEnabled) {
    const trimmed = carried.trim();
    return trimmed ? trimmed : null;
  }

  // A custom marker (RD-057 polish) wins over the default `[Synced from …]`.
  const custom = config.notesMarker.trim();
  const marker = custom
    ? custom
    : buildSyncNotesMarker({
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
  /** Resolved split children for a grouped target split (RD-057 §6). */
  subtransactions?: PlannedSplitChild[] | null;
  /** Resolved FX rate info for this item's date (RD-056). Null/absent leaves the
   * amount in the source currency. */
  fx?: FxRateInfo | null;
}): PlannedTargetPayload {
  const { item, config, payee, category, importedId, subtransactions, fx } = input;
  const directed = transformAmount(item.amount, config.amountDirection);
  const amount = fx ? convertMinorUnits(directed, fx.rate) : directed;
  const baseNotes = transformNotes(item.notes, config);
  return {
    accountId: config.targetAccountId,
    date: item.date,
    amount,
    payeeId: payee.payeeId,
    payeeName: payee.payeeName,
    categoryId: category.categoryId,
    notes: fx ? appendFxNote(baseNotes, item.amount, config.fxSourceCurrency, fx.rate) : baseNotes,
    cleared: false,
    importedId,
    subtransactions: subtransactions && subtransactions.length > 0 ? subtransactions : null,
    fx: fx
      ? {
          sourceAmount: item.amount,
          sourceCurrency: config.fxSourceCurrency,
          targetCurrency: config.fxTargetCurrency,
          rate: fx.rate,
          requestedDate: item.date,
          effectiveDate: fx.effectiveDate,
          source: fx.source,
          provider: fx.provider,
          fxRateId: fx.fxRateId,
        }
      : null,
  };
}

/** Append a compact FX audit line to the target notes, e.g. `[AED -10.00 @ 0.4162]`. */
function appendFxNote(notes: string | null, sourceMinor: number, sourceCurrency: string, rate: string): string {
  const original = `${sourceCurrency} ${(sourceMinor / 100).toFixed(2)} @ ${rate}`;
  const marker = `[${original}]`;
  const trimmed = (notes ?? "").trim();
  return trimmed ? `${trimmed} ${marker}` : marker;
}
