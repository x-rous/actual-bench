import { z } from "zod";
import { generateId } from "@/lib/uuid";
import { AppDbValidationError } from "./errors";
import { readRegistry } from "./assetRepository";
import { linkRuleInputSchema } from "@/lib/asset-registry/linkRules";
import { idSchema } from "@/lib/asset-registry/models";
import type { SqliteDatabase } from "./types";

const saveSchema = z.object({
  budgetSyncId: idSchema, assetId: idSchema,
  operation: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("save"), rule: linkRuleInputSchema }).strict(),
    z.object({ kind: z.literal("delete"), id: idSchema }).strict(),
  ]),
}).strict();
/** Saved rules are Bench metadata only; they never touch Actual and link nothing on their own. */
export function saveLinkRule(db: SqliteDatabase, input: unknown) {
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) throw new AppDbValidationError(parsed.error.issues.map((issue) => issue.message).join("; "));
  const { budgetSyncId: budget, assetId, operation } = parsed.data;
  return db.transaction(() => {
    const asset = readRegistry(db, budget).assets.find((a) => a.id === assetId);
    if (!asset) throw new AppDbValidationError("Asset is unavailable in this budget");
    if (operation.kind === "delete") db.prepare("DELETE FROM asset_link_rules WHERE id=? AND asset_id=? AND budget_sync_id=?").run(operation.id, assetId, budget);
    else {
      if (asset.status !== "active") throw new AppDbValidationError("Restore the asset before changing its link rules");
      const { rule } = operation; const now = new Date().toISOString();
      const id = rule.id ?? generateId();
      const exists = db.prepare("SELECT 1 AS x FROM asset_link_rules WHERE id=? AND asset_id=? AND budget_sync_id=?").get(id, assetId, budget);
      if (rule.id && !exists) throw new AppDbValidationError("That rule no longer exists. Refresh and try again.");
      const values = [rule.name, rule.match, JSON.stringify(rule.conditions), now];
      if (exists) db.prepare("UPDATE asset_link_rules SET name=?,match=?,conditions=?,updated_at=? WHERE id=?").run(...values, id);
      else db.prepare("INSERT INTO asset_link_rules(name,match,conditions,updated_at,id,asset_id,budget_sync_id,created_at) VALUES(?,?,?,?,?,?,?,?)").run(...values, id, assetId, budget, now);
    }
    return readRegistry(db, budget);
  })();
}
