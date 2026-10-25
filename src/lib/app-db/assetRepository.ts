import { z } from "zod";
import type { DepreciationSettings } from "@/lib/asset-registry/depreciation";
import type { AssetDebtLink } from "@/lib/asset-registry/financing";
import type { LinkRule } from "@/lib/asset-registry/linkRules";
import { accountDirectorySchema, assetInputSchema, defaultIncomeGenerating, eligibility, idSchema, metadataChangeSchema, type Asset, type BookMetadata, type CashflowMetadata, type AssetContext, type Registry } from "@/lib/asset-registry/models";
import { listAccountClasses } from "./accountClassRepository";
import { AppDbConflictError, AppDbValidationError } from "./errors";
import type { SqliteDatabase } from "./types";

type AssetRow = {
  id: string; budget_sync_id: string; actual_account_id: string; name: string; asset_type: string;
  asset_tag: string | null; description: string | null; status: string; revision: number;
  created_at: string; updated_at: string; archived_at: string | null; income_generating: number;
};
function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new AppDbValidationError(result.error.issues.map((i) => i.message).join("; "));
  return result.data;
}
export function readRegistry(db: SqliteDatabase, budget: string): Registry {
  parse(idSchema, budget);
  const assets = db.prepare("SELECT * FROM assets WHERE budget_sync_id=? ORDER BY name,id").all<AssetRow>(budget).map((r): Asset => ({
    id: r.id, budgetSyncId: r.budget_sync_id, actualAccountId: r.actual_account_id,
    name: r.name, assetType: r.asset_type, assetTag: r.asset_tag, description: r.description, status: r.status,
    revision: r.revision, createdAt: r.created_at, updatedAt: r.updated_at, archivedAt: r.archived_at, incomeGenerating: r.income_generating === 1,
    ownership: db.prepare("SELECT effective_from AS effectiveFrom, ownership_bps AS ownershipBps FROM asset_ownership_periods WHERE asset_id=? ORDER BY effective_from").all(r.id),
  }));
  type MetadataRow = BookMetadata & { role: string; capitalizedFromTransactionId: string | null; contextJson: string | null; depreciationPeriod: string | null };
  const rows = db.prepare(`SELECT actual_transaction_id AS actualTransactionId, actual_account_id AS actualAccountId,
    asset_id AS assetId, classification, revision, role, capitalized_from_transaction_id AS capitalizedFromTransactionId, context_json AS contextJson, depreciation_period AS depreciationPeriod
    FROM asset_transaction_metadata WHERE budget_sync_id=? ORDER BY actual_transaction_id`).all<MetadataRow>(budget);
  const convert = (r: MetadataRow): BookMetadata => ({ actualTransactionId: r.actualTransactionId, actualAccountId: r.actualAccountId,
    assetId: r.assetId, classification: r.classification, revision: r.revision,
    ...(r.capitalizedFromTransactionId ? { capitalizedFromTransactionId: r.capitalizedFromTransactionId } : {}), ...(r.contextJson ? { context: JSON.parse(r.contextJson) as AssetContext } : {}), ...(r.depreciationPeriod ? { depreciationPeriod: r.depreciationPeriod } : {}) });
  const metadata = rows.filter((row) => row.role === "book").map(convert);
  const cashflows = rows.filter((row) => row.role === "cashflow").map(convert) as CashflowMetadata[];
  const depreciation = db.prepare(`SELECT s.asset_id AS assetId, s.method, s.basis_minor AS basisMinor, s.residual_minor AS residualMinor, s.start_date AS startDate,
    s.life_months AS lifeMonths, s.annual_rate_bps AS annualRateBps, s.updated_at AS updatedAt FROM asset_depreciation_settings s JOIN assets a ON a.id=s.asset_id WHERE a.budget_sync_id=? ORDER BY s.asset_id`).all<DepreciationSettings>(budget);
  const debtLinks = db.prepare(`SELECT asset_id AS assetId, debt_id AS debtId, allocation_bps AS allocationBps, effective_from AS effectiveFrom, effective_to AS effectiveTo, note
    FROM asset_debt_links WHERE budget_sync_id=? ORDER BY debt_id, asset_id, effective_from`).all<AssetDebtLink>(budget);
  const linkRules = db.prepare(`SELECT r.id, r.asset_id AS assetId, r.name, r.match, r.conditions, r.classification, r.updated_at AS updatedAt
    FROM asset_link_rules r WHERE r.budget_sync_id=? ORDER BY r.name, r.id`).all<Omit<LinkRule, "conditions"> & { conditions: string }>(budget)
    .map((r): LinkRule => ({ ...r, conditions: JSON.parse(r.conditions) }));
  return { assets, metadata, ...(linkRules.length ? { linkRules } : {}), ...(cashflows.length ? { cashflows } : {}), ...(depreciation.length ? { depreciation } : {}), ...(debtLinks.length ? { debtLinks } : {}) };
}
const saveSchema = z.object({ budgetSyncId: idSchema, asset: assetInputSchema, accountDirectory: accountDirectorySchema }).strict();
/** Directory is read by the active browser transport, as for Loans; classes are checked from the DB. */
export function saveAsset(db: SqliteDatabase, input: unknown): Registry {
  const { budgetSyncId: budget, asset, accountDirectory } = parse(saveSchema, input);
  return db.transaction(() => {
    const current = readRegistry(db, budget).assets.find((a) => a.id === asset.id);
    if ((current?.revision ?? 0) !== asset.revision) throw new AppDbConflictError("Asset changed. Refresh before saving; your draft is preserved.");
    if (current && current.actualAccountId !== asset.actualAccountId) throw new AppDbValidationError("Settings cannot relink account history");
    if (current && asset.assetTag !== undefined && current.assetTag !== asset.assetTag) throw new AppDbValidationError("The saved asset hashtag cannot change");
    const members = readRegistry(db, budget).assets.filter((a) => a.actualAccountId === asset.actualAccountId && a.id !== asset.id);
    if (!current && members.length && !asset.assetTag) throw new AppDbValidationError("Choose Shared Asset Account and enter a hashtag for this account");
    if (!current && asset.assetTag && readRegistry(db, budget).assets.some((a) => a.assetTag === asset.assetTag)) throw new AppDbValidationError("This hashtag is already used, including archived assets. Choose another.");
    const records = listAccountClasses(db, budget);
    const maps = { accounts: new Map(records.filter((c) => c.scope === "account").map((c) => [c.accountId, c.accountClass])), groups: new Map(records.filter((c) => c.scope === "group").map((c) => [c.accountId, c.accountClass])) };
    const reason = eligibility(accountDirectory.find((a) => a.id === asset.actualAccountId), asset.assetType, maps);
    // Archiving remains possible after account/class drift; it never writes Actual.
    if (reason && !(current && asset.status === "archived" && asset.assetType === current.assetType)) throw new AppDbValidationError(reason);
    if (new Set(asset.ownership.map((p) => p.effectiveFrom)).size !== asset.ownership.length) throw new AppDbValidationError("Ownership dates must be unique");
    const now = new Date().toISOString();
    if (!current) {
      db.prepare(`INSERT INTO assets(id,budget_sync_id,actual_account_id,name,asset_type,asset_tag,description,status,revision,created_at,updated_at,archived_at,income_generating)
        VALUES(?,?,?,?,?,?,?,?,1,?,?,?,?)`).run(asset.id, budget, asset.actualAccountId, asset.name, asset.assetType, asset.assetTag ?? null, asset.description, asset.status, now, now, asset.status === "archived" ? now : null, (asset.incomeGenerating ?? defaultIncomeGenerating(asset.assetType)) ? 1 : 0);
    } else {
      db.prepare("UPDATE assets SET name=?,asset_type=?,description=?,status=?,income_generating=?,revision=revision+1,updated_at=?,archived_at=? WHERE id=? AND budget_sync_id=?").run(asset.name, asset.assetType, asset.description, asset.status, (asset.incomeGenerating ?? current.incomeGenerating) ? 1 : 0, now, asset.status === "archived" ? current.archivedAt ?? now : null, asset.id, budget);
    }
    db.prepare("DELETE FROM asset_ownership_periods WHERE asset_id=?").run(asset.id);
    const insert = db.prepare("INSERT INTO asset_ownership_periods(asset_id,effective_from,ownership_bps,created_at,updated_at) VALUES(?,?,?,?,?)");
    for (const p of asset.ownership) insert.run(asset.id, p.effectiveFrom, p.ownershipBps, now, now);
    return readRegistry(db, budget);
  })();
}
const changesSchema = z.object({ budgetSyncId: idSchema, changes: z.array(metadataChangeSchema).min(1).max(500) }).strict();
export function saveBookMetadata(db: SqliteDatabase, input: unknown): Registry {
  const { budgetSyncId: budget, changes } = parse(changesSchema, input);
  if (new Set(changes.map((c) => c.actualTransactionId)).size !== changes.length) throw new AppDbValidationError("Duplicate transaction in batch");
  return db.transaction(() => {
    const registry = readRegistry(db, budget);
    const now = new Date().toISOString();
    for (const change of changes) {
      const existing = db.prepare("SELECT revision,role FROM asset_transaction_metadata WHERE budget_sync_id=? AND actual_transaction_id=?").get<{ revision: number; role: string }>(budget, change.actualTransactionId);
      if ((existing?.revision ?? 0) !== change.revision || (existing && existing.role !== "book")) throw new AppDbConflictError("Transaction metadata changed; refresh before saving");
      if (!registry.assets.some((a) => a.actualAccountId === change.actualAccountId)) throw new AppDbValidationError("No registered asset for that account");
      if (change.assetId && !registry.assets.some((a) => a.id === change.assetId && a.actualAccountId === change.actualAccountId)) throw new AppDbValidationError("Assignment must use an asset in this budget and account");
      const paired = registry.metadata.find((m) => m.actualTransactionId === change.actualTransactionId);
      const bound = paired?.depreciationPeriod ? "depreciation" : paired?.capitalizedFromTransactionId ? "capital-expenditure" : paired?.context?.data.kind === "disposal" || [...registry.metadata, ...(registry.cashflows ?? [])].some((m) => m.context?.data.kind === "disposal" && m.context.data.bookAdjustmentTransactionId === change.actualTransactionId) ? "disposal" : null;
      if (bound && (change.remove || change.classification !== bound || (paired && change.assetId !== paired.assetId))) throw new AppDbValidationError("This row belongs to a capital/disposal treatment; inspect its linked sources first");
      if (change.remove) {
        db.prepare("DELETE FROM asset_transaction_metadata WHERE budget_sync_id=? AND actual_transaction_id=?").run(budget, change.actualTransactionId);
        continue;
      }
      db.prepare(`INSERT INTO asset_transaction_metadata(budget_sync_id,actual_transaction_id,actual_account_id,role,asset_id,classification,revision,created_at,updated_at)
        VALUES(?,?,?,'book',?,?,1,?,?) ON CONFLICT(budget_sync_id,actual_transaction_id) DO UPDATE SET
        actual_account_id=excluded.actual_account_id,asset_id=excluded.asset_id,classification=excluded.classification,revision=asset_transaction_metadata.revision+1,updated_at=excluded.updated_at`)
        .run(budget, change.actualTransactionId, change.actualAccountId, change.assetId, change.classification, now, now);
    }
    return readRegistry(db, budget);
  })();
}
