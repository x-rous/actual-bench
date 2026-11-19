import type { ActualBenchTransport } from "@/lib/actual/transport";
import { executeAction, freshActionContext, prepareAction } from "@/lib/asset-registry/actions";
import type { Registry } from "@/lib/asset-registry/models";
import { withTypeTag } from "@/lib/asset-registry/tags";
import { registryRequest } from "./api";

/**
 * Records an asset's starting value: one Opening Balance row in its account in Actual, then its type in Bench. Uses the same
 * guarded create as every other entry, so a failed or uncertain write is never repeated here. `amountMinor` is positive integer minor units.
 */
export async function recordStartingValue(args: { transport: ActualBenchTransport; budgetSyncId: string; assetId: string; shared: boolean; date: string; amountMinor: number }): Promise<Registry> {
  const { transport, budgetSyncId, assetId, shared, date, amountMinor } = args;
  const context = () => freshActionContext(transport, assetId, date, () => registryRequest(budgetSyncId));
  const base = await context();
  const prepared = prepareAction(base, { kind: "create", date, amountMinor, notes: withTypeTag("", "opening-balance"), payeeId: null });
  const result = await executeAction(prepared, context);
  try {
    return await registryRequest(budgetSyncId, "PATCH", { changes: [{ actualTransactionId: result.transactionId!, actualAccountId: base.asset.actualAccountId, assetId: shared ? assetId : null, classification: "opening-balance", revision: 0 }] });
  } catch (e) { throw new StartingValueSavedError(e instanceof Error ? e.message : "the save failed"); }
}
/**
 * The opening value is in Actual, but Bench's own record of its type was not saved. The row's Notes carry the
 * #opening-balance hashtag (and the asset hashtag in a shared account), so it still reads as this asset's opening balance:
 * it must not be entered again.
 */
export class StartingValueSavedError extends Error { override name = "StartingValueSavedError"; }
