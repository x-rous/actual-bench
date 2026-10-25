import type { SqliteDatabase } from "./types";
import { AppDbConflictError, AppDbValidationError } from "./errors";
import { readRegistry } from "./assetRepository";
import { cashflowChoices, cashflowSaveSchema } from "@/lib/asset-registry/cashflows";
import type { AssetContext, BookMetadata } from "@/lib/asset-registry/models";

/** Scoped metadata transaction only. Live source evidence is read by the active transport; never stored. */
export function saveAssetCashflows(db: SqliteDatabase, input: unknown) {
  const parsed = cashflowSaveSchema.safeParse(input);
  if (!parsed.success) throw new AppDbValidationError(parsed.error.issues.map((issue) => issue.message).join("; "));
  const { budgetSyncId: budget, changes, sources } = parsed.data;
  if (new Set(changes.map((c) => c.actualTransactionId)).size !== changes.length) throw new AppDbValidationError("Duplicate transaction in batch");
  if (new Set(sources.map((s) => s.id)).size !== sources.length || sources.some((s) => s.parentId && sources.some((p) => p.id === s.parentId))) throw new AppDbValidationError("Duplicate or overlapping parent/child source rows");
  return db.transaction(() => {
    const registry = readRegistry(db, budget);
    type Entry = BookMetadata & { role: "book" | "cashflow" };
    const existing = new Map<string, Entry>([...registry.metadata.map((m): Entry => ({ ...m, role: "book" })), ...(registry.cashflows ?? []).map((m): Entry => ({ ...m, role: "cashflow" }))].map((m) => [m.actualTransactionId, m]));
    const final = new Map(existing);
    const fail = (message: string): never => { throw new AppDbValidationError(message); };
    for (const change of changes) {
      const old = existing.get(change.actualTransactionId);
      if ((old?.revision ?? 0) !== change.revision) throw new AppDbConflictError("Transaction links changed. Refresh; your draft is preserved.");
      if (old && (old.role !== change.role || (old.assetId && old.assetId !== change.assetId))) fail("Transaction already belongs to another asset or role");
      if (old && old.actualAccountId !== change.actualAccountId) fail("Source account changed. Unlink the moved association before linking again.");
      const asset = registry.assets.find((a) => a.id === change.assetId) ?? fail("Asset is unavailable in this budget");
      if (change.remove) { final.delete(change.actualTransactionId); continue; }
      const source = sources.find((s) => s.id === change.actualTransactionId && s.accountId === change.actualAccountId) ?? fail("Source transaction is missing or moved");
      if (change.role === "book" ? asset.actualAccountId !== source.accountId : registry.assets.some((a) => a.actualAccountId === source.accountId)) fail("Source is in the wrong account for its role");
      if (change.role === "cashflow" && (source.transferId || (change.classification && !cashflowChoices(source.amountMinor).includes(change.classification as never)))) fail("Choose a sign-compatible external cashflow; transfers belong in Account Transactions");
      final.set(change.actualTransactionId, { ...old, ...change, revision: change.revision + 1 });
    }
    if (sources.some((row) => row.parentId && final.has(row.id) && final.has(row.parentId))) fail("Parent and child transactions cannot both be linked");
    for (const change of changes.filter((c) => !c.remove)) {
      const entry = final.get(change.actualTransactionId)!;
      const row = sources.find((r) => r.id === entry.actualTransactionId)!;
      if (entry.capitalizedFromTransactionId) {
        if (entry.role !== "book" || entry.classification !== "capital-expenditure" || row.amountMinor <= 0) fail("Capitalization requires one positive CapEx book row");
        const source = sources.find((r) => r.id === entry.capitalizedFromTransactionId);
        const link = final.get(entry.capitalizedFromTransactionId);
        if (!source || source.amountMinor >= 0 || !source.categoryId || source.transferId || -source.amountMinor !== row.amountMinor || link?.role !== "cashflow" || link.assetId !== entry.assetId || link.classification !== "capital-expenditure") fail("Capitalization source/pair is missing or inconsistent");
        if ([...final.values()].some((m) => m.actualTransactionId !== entry.actualTransactionId && m.capitalizedFromTransactionId === entry.capitalizedFromTransactionId)) fail("This expense is already capitalized");
      }
      if (entry.depreciationPeriod) {
        if (entry.role !== "book" || entry.classification !== "depreciation" || entry.capitalizedFromTransactionId || row.amountMinor >= 0) fail("A scheduled depreciation month needs one negative depreciation book row");
        if ([...final.values()].some((m) => m.actualTransactionId !== entry.actualTransactionId && m.assetId === entry.assetId && m.depreciationPeriod === entry.depreciationPeriod)) fail("This depreciation month is already posted");
      }
      if (entry.role === "cashflow" && entry.classification !== "capital-expenditure" && [...final.values()].some((m) => m.capitalizedFromTransactionId === entry.actualTransactionId)) fail("A capitalized expense must retain its CapEx classification");
      const context = entry.context?.data;
      if (context?.kind === "selling-cost") {
        const anchor = final.get(context.disposalTransactionId);
        if (entry.role !== "cashflow" || entry.classification !== "other-excluded" || row.amountMinor >= 0 || anchor?.assetId !== entry.assetId || anchor.context?.data.kind !== "disposal") fail("Selling cost must reference one disposal for the same asset");
      }
      if (context?.kind === "disposal") {
        const receipt = context.representation === "external-receipt";
        if (entry.classification !== (receipt ? "disposal-proceeds" : "disposal") || entry.role !== (receipt ? "cashflow" : "book")) fail("Disposal anchor has the wrong role/type");
        if (receipt ? row.amountMinor <= 0 || !!row.transferId : context.representation === "asset-transfer" ? row.amountMinor >= 0 || !row.transferId : row.amountMinor !== -context.carryingRemovedMinor) fail("Disposal anchor amount or representation is inconsistent");
        const delta = receipt || context.representation === "write-off" ? -context.carryingRemovedMinor : -row.amountMinor - context.carryingRemovedMinor;
        if (context.representation !== "write-off") {
          if (delta === 0 ? context.bookAdjustmentTransactionId !== null : !context.bookAdjustmentTransactionId) fail("Disposal adjustment identity is inconsistent");
          if (context.bookAdjustmentTransactionId) {
            const pair = final.get(context.bookAdjustmentTransactionId); const actual = sources.find((r) => r.id === context.bookAdjustmentTransactionId);
            if (pair?.role !== "book" || pair.assetId !== entry.assetId || pair.classification !== "disposal" || pair.context || actual?.amountMinor !== delta || actual.date !== row.date) fail("Disposal companion is missing or inconsistent");
            if ([...final.values()].some((m) => m.actualTransactionId !== entry.actualTransactionId && m.context?.data.kind === "disposal" && m.context.data.bookAdjustmentTransactionId === context.bookAdjustmentTransactionId)) fail("Disposal companion is already used");
          }
        }
      }
    }
    const now = new Date().toISOString();
    for (const change of changes) {
      if (change.remove) { db.prepare("DELETE FROM asset_transaction_metadata WHERE budget_sync_id=? AND actual_transaction_id=?").run(budget, change.actualTransactionId); continue; }
      const m = final.get(change.actualTransactionId)!;
      db.prepare(`INSERT INTO asset_transaction_metadata(budget_sync_id,actual_transaction_id,actual_account_id,role,asset_id,classification,capitalized_from_transaction_id,context_json,depreciation_period,revision,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,1,?,?) ON CONFLICT(budget_sync_id,actual_transaction_id) DO UPDATE SET asset_id=excluded.asset_id,classification=excluded.classification,capitalized_from_transaction_id=excluded.capitalized_from_transaction_id,context_json=excluded.context_json,depreciation_period=excluded.depreciation_period,revision=asset_transaction_metadata.revision+1,updated_at=excluded.updated_at`)
        .run(budget, m.actualTransactionId, m.actualAccountId, m.role, m.assetId, m.classification, m.capitalizedFromTransactionId ?? null, m.context ? JSON.stringify(m.context as AssetContext) : null, m.depreciationPeriod ?? null, now, now);
    }
    return readRegistry(db, budget);
  })();
}
