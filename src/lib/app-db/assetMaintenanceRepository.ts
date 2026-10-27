import { z } from "zod";
import { planPrune, pruneEvidenceSchema, pruneSize } from "@/lib/asset-registry/prune";
import { idSchema } from "@/lib/asset-registry/models";
import { AppDbValidationError } from "./errors";
import { readRegistry } from "./assetRepository";
import type { SqliteDatabase } from "./types";

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new AppDbValidationError(result.error.issues.map((i) => i.message).join("; "));
  return result.data;
}
/**
 * Drops what Bench saved about transactions that are gone from Actual, from evidence of complete reads. It never trusts an
 * account the caller did not list as read completely, and repeating it changes nothing.
 */
export function pruneStaleAssetMetadata(db: SqliteDatabase, input: unknown) {
  const evidence = parse(pruneEvidenceSchema, input);
  return db.transaction(() => {
    const plan = planPrune(readRegistry(db, evidence.budgetSyncId), evidence);
    const budget = evidence.budgetSyncId;
    const remove = db.prepare("DELETE FROM asset_transaction_metadata WHERE budget_sync_id=? AND actual_transaction_id=?");
    for (const id of [...plan.removeBook, ...plan.removeCashflow]) remove.run(budget, id);
    return { registry: readRegistry(db, budget), dropped: pruneSize(plan) };
  })();
}

const deleteSchema = z.object({ budgetSyncId: idSchema, assetId: idSchema }).strict();
/**
 * Permanently deletes an archived asset and everything Bench stored for it. Actual is not touched: the account, its
 * transactions and any transfer Bench created stay exactly as they are.
 */
export function deleteArchivedAsset(db: SqliteDatabase, input: unknown) {
  const { budgetSyncId: budget, assetId } = parse(deleteSchema, input);
  return db.transaction(() => {
    const registry = readRegistry(db, budget);
    const asset = registry.assets.find((a) => a.id === assetId);
    if (!asset) throw new AppDbValidationError("Asset not found");
    if (asset.status !== "archived") throw new AppDbValidationError("Archive the asset before deleting it permanently");
    db.prepare("DELETE FROM asset_transaction_metadata WHERE budget_sync_id=? AND asset_id=?").run(budget, assetId);
    db.prepare("DELETE FROM asset_debt_links WHERE budget_sync_id=? AND asset_id=?").run(budget, assetId);
    db.prepare("DELETE FROM asset_link_rules WHERE budget_sync_id=? AND asset_id=?").run(budget, assetId);
    db.prepare("DELETE FROM asset_depreciation_settings WHERE asset_id=?").run(assetId);
    // Rows saved for the account with no asset (a type chosen on a row) go with the last asset that used the account.
    if (!registry.assets.some((a) => a.id !== assetId && a.actualAccountId === asset.actualAccountId)) {
      db.prepare("DELETE FROM asset_transaction_metadata WHERE budget_sync_id=? AND actual_account_id=?").run(budget, asset.actualAccountId);
    }
    db.prepare("DELETE FROM assets WHERE id=? AND budget_sync_id=?").run(assetId, budget);
    return readRegistry(db, budget);
  })();
}
