import { z } from "zod";
import { AppDbConflictError, AppDbValidationError } from "./errors";
import { readRegistry } from "./assetRepository";
import { depreciationInputSchema } from "@/lib/asset-registry/depreciation";
import { idSchema } from "@/lib/asset-registry/models";
import type { SqliteDatabase } from "./types";

const saveSchema = z.object({
  budgetSyncId: idSchema, assetId: idSchema, assetRevision: z.number().int().min(0),
  /** `updatedAt` of the settings the editor loaded; null when it saw none. Rejects a stale overwrite. */
  expectedUpdatedAt: z.string().nullable(),
  /** Null removes the schedule. Posted months and their associations are never touched. */
  settings: depreciationInputSchema.nullable(),
}).strict();
/** One current schedule per asset. Scoped metadata only: nothing is written to Actual. */
export function saveDepreciationSettings(db: SqliteDatabase, input: unknown) {
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) throw new AppDbValidationError(parsed.error.issues.map((issue) => issue.message).join("; "));
  const { budgetSyncId: budget, assetId, assetRevision, expectedUpdatedAt, settings } = parsed.data;
  return db.transaction(() => {
    const asset = readRegistry(db, budget).assets.find((a) => a.id === assetId);
    if (!asset) throw new AppDbValidationError("Asset is unavailable in this budget");
    if (asset.revision !== assetRevision) throw new AppDbConflictError("The asset changed. Refresh; your schedule draft is preserved.");
    if (asset.status !== "active") throw new AppDbValidationError("Restore the asset before changing its depreciation schedule");
    const current = db.prepare("SELECT updated_at FROM asset_depreciation_settings WHERE asset_id=?").get<{ updated_at: string }>(assetId);
    if ((current?.updated_at ?? null) !== expectedUpdatedAt) throw new AppDbConflictError("The depreciation schedule changed. Refresh; your draft is preserved.");
    if (!settings) db.prepare("DELETE FROM asset_depreciation_settings WHERE asset_id=?").run(assetId);
    else {
      const now = new Date().toISOString();
      db.prepare(`INSERT INTO asset_depreciation_settings(asset_id,method,basis_minor,residual_minor,start_date,life_months,annual_rate_bps,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)
        ON CONFLICT(asset_id) DO UPDATE SET method=excluded.method,basis_minor=excluded.basis_minor,residual_minor=excluded.residual_minor,start_date=excluded.start_date,life_months=excluded.life_months,annual_rate_bps=excluded.annual_rate_bps,updated_at=excluded.updated_at`)
        .run(assetId, settings.method, settings.basisMinor, settings.residualMinor, settings.startDate, settings.lifeMonths, settings.annualRateBps, now, now);
    }
    return readRegistry(db, budget);
  })();
}
