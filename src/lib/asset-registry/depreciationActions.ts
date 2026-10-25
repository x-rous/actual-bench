import { normalizeActivity } from "@/features/credit-cards/lib/activity";
import { executeAction, prepareAction, type ActionContext, type ActionResult, type PreparedAction } from "./actions";
import { depreciationSchedule, forecastMonths, type ScheduleRow } from "./depreciation";
import { sourceEvidence, type CashflowChange } from "./cashflows";
import type { BookMetadata } from "./models";
import { DEPRECIATION_TAG } from "./tags";

export { DEPRECIATION_TAG };

export type DepreciationPrepared = {
  period: string; /** The period's own calendar last day, never today or the batch date. */ date: string;
  /** Signed integer minor units; negative. */ amountMinor: number;
  /** A saved month whose Actual row is gone; a deliberate repost replaces its association. */ replaces: BookMetadata | null;
  action: PreparedAction;
};
/**
 * One selected, ended month through the normal single-row book action. Everything is recomputed from the fresh context:
 * the saved schedule, the month association and whether its Actual row still exists. Nothing is written here.
 */
export function prepareDepreciation(context: ActionContext, period: string, today: string): DepreciationPrepared {
  const settings = context.registry.depreciation?.find((s) => s.assetId === context.asset.id);
  if (!settings) throw new Error("Save a depreciation schedule first");
  const row: ScheduleRow | undefined = depreciationSchedule(settings, forecastMonths(settings, today)).find((r) => r.period === period);
  if (!row) throw new Error("That month is not in the saved schedule");
  if (row.amountMinor <= 0) throw new Error("No depreciation is planned for that month");
  if (row.postDate > today) throw new Error("That month has not ended; it remains a forecast");
  const actualIds = new Set(context.snapshot.source.map((r) => r.id));
  const association = context.registry.metadata.find((m) => m.assetId === context.asset.id && m.depreciationPeriod === period) ?? null;
  if (association && actualIds.has(association.actualTransactionId)) throw new Error("That month is already posted");
  const action = prepareAction(context, { kind: "create", date: row.postDate, amountMinor: -row.amountMinor, notes: `Depreciation ${period} ${DEPRECIATION_TAG}`, payeeId: null });
  return { period, date: row.postDate, amountMinor: -row.amountMinor, replaces: association, action };
}
export const executeDepreciation = (prepared: DepreciationPrepared, fresh: () => Promise<ActionContext>): Promise<ActionResult> => executeAction(prepared.action, fresh);
/** A missing month's old association is removed in the same metadata transaction that records the new row. */
export function depreciationMetadata(prepared: DepreciationPrepared, result: ActionResult, context: ActionContext): CashflowChange[] {
  const { asset } = context;
  const changes: CashflowChange[] = [];
  if (prepared.replaces) changes.push({ role: "book", actualTransactionId: prepared.replaces.actualTransactionId, actualAccountId: prepared.replaces.actualAccountId, assetId: asset.id, classification: "depreciation", revision: prepared.replaces.revision, remove: true });
  changes.push({ role: "book", actualTransactionId: result.transactionId!, actualAccountId: asset.actualAccountId, assetId: asset.id, classification: "depreciation", depreciationPeriod: prepared.period, revision: 0 });
  return changes;
}
export const depreciationEvidence = (context: ActionContext) => sourceEvidence(normalizeActivity(context.snapshot.source).rows);
