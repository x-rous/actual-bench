import { z } from "zod";
import { AppDbConflictError, AppDbValidationError } from "./errors";
import { readRegistry } from "./assetRepository";
import { listDebtSummaries } from "@/lib/assets-debt/services/debtConfigService";
import { AllocationError, changePair, checkLoanLimits, loanFingerprint, type AssetDebtLink } from "@/lib/asset-registry/financing";
import { dateSchema, idSchema } from "@/lib/asset-registry/models";
import type { SqliteDatabase } from "./types";

const operation = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("set"), effectiveFrom: dateSchema, effectiveTo: dateSchema.nullable().optional(), allocationBps: z.number().int().min(1).max(10000), note: z.string().max(2000).nullable().optional() }).strict(),
  z.object({ kind: z.literal("end"), effectiveFrom: dateSchema }).strict(),
]);
const saveSchema = z.object({
  budgetSyncId: idSchema, assetId: idSchema, debtId: idSchema, operation,
  /** The loan's period set the editor loaded (`loanFingerprint`); another asset's concurrent change is refused. */
  expectedFingerprint: z.string().max(100000),
}).strict();
/** Metadata only: never reads or writes Actual, and never changes the loan. */
export function saveAssetDebtAllocation(db: SqliteDatabase, input: unknown) {
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) throw new AppDbValidationError(parsed.error.issues.map((issue) => issue.message).join("; "));
  const { budgetSyncId: budget, assetId, debtId, operation: op, expectedFingerprint } = parsed.data;
  return db.transaction(() => {
    const registry = readRegistry(db, budget);
    const asset = registry.assets.find((a) => a.id === assetId);
    if (!asset) throw new AppDbValidationError("Asset is unavailable in this budget");
    const debt = listDebtSummaries(db, budget, true).find((d) => d.id === debtId);
    if (!debt) throw new AppDbValidationError("Loan is unavailable in this budget");
    if (op.kind === "set") {
      if (asset.status !== "active") throw new AppDbValidationError("Restore the asset before changing its allocations");
      if (debt.status !== "active" || debt.blocked || !debt.liabilityAccountId) throw new AppDbValidationError("Link an active loan that is bound to an Actual liability account");
    }
    const all = registry.debtLinks ?? [];
    if (loanFingerprint(all, debtId) !== expectedFingerprint) throw new AppDbConflictError("This loan's allocations changed. Refresh; your draft is preserved.");
    let pair: AssetDebtLink[];
    try {
      pair = changePair(all.filter((l) => l.assetId === assetId && l.debtId === debtId), op.kind === "set" ? { ...op, assetId, debtId } : { ...op, assetId, debtId });
    } catch (error) { if (error instanceof AllocationError) throw new AppDbValidationError(error.message); throw error; }
    const problem = checkLoanLimits([...all.filter((l) => !(l.assetId === assetId && l.debtId === debtId)), ...pair]);
    if (problem) throw new AppDbValidationError(problem);
    const now = new Date().toISOString();
    const keep = new Set(pair.map((l) => l.effectiveFrom));
    for (const old of all.filter((l) => l.assetId === assetId && l.debtId === debtId && !keep.has(l.effectiveFrom))) {
      db.prepare("DELETE FROM asset_debt_links WHERE asset_id=? AND debt_id=? AND effective_from=?").run(assetId, debtId, old.effectiveFrom);
    }
    // Shrink or move periods first so a transient overlap can never be observed by a constraint.
    for (const l of pair) {
      db.prepare(`INSERT INTO asset_debt_links(asset_id,debt_id,budget_sync_id,allocation_bps,effective_from,effective_to,note,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)
        ON CONFLICT(asset_id,debt_id,effective_from) DO UPDATE SET allocation_bps=excluded.allocation_bps,effective_to=excluded.effective_to,note=excluded.note,updated_at=excluded.updated_at`)
        .run(assetId, debtId, budget, l.allocationBps, l.effectiveFrom, l.effectiveTo, l.note, now, now);
    }
    return readRegistry(db, budget);
  })();
}
