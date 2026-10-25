import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getAppDb, resetAppDbForTests } from "./connection";
import { saveAsset } from "./assetRepository";
import { applyAccountClassChanges } from "./accountClassRepository";
import { saveLinkRule } from "./assetLinkRuleRepository";
import { testAsset } from "@/lib/asset-registry/testing";

const rule = { name: "Rent", match: "all", conditions: [{ field: "payee", operator: "equals", value: "tenant" }, { field: "notes", operator: "hasTag", value: "#unit-4" }], classification: "rental-income" };
function fixture() {
  const db = getAppDb(join(mkdtempSync(join(tmpdir(), "asset-rules-")), "app.sqlite"));
  applyAccountClassChanges(db, { budgetSyncId: "budget", changes: [{ scope: "account", id: "vehicles", accountClass: "vehicle" }] });
  const a = testAsset("byd");
  saveAsset(db, { budgetSyncId: "budget", asset: { id: "byd", actualAccountId: "vehicles", assetType: "vehicle", assetTag: a.assetTag, name: "byd", description: null, status: "active", revision: 0, ownership: a.ownership }, accountDirectory: [{ id: "vehicles", name: "Vehicles", offBudget: true, closed: false }] });
  const save = (operation: object, assetId = "byd") => saveLinkRule(db, { budgetSyncId: "budget", assetId, operation });
  return { save };
}
afterEach(resetAppDbForTests);
it("creates, edits and deletes a rule without touching anything else", () => {
  const { save } = fixture();
  const created = save({ kind: "save", rule }).linkRules!;
  expect(created).toHaveLength(1); expect(created[0]).toMatchObject({ assetId: "byd", name: "Rent", match: "all", classification: "rental-income", conditions: [{ field: "payee", operator: "equals", value: "tenant" }, expect.objectContaining({ operator: "hasTag" })] });
  const edited = save({ kind: "save", rule: { ...rule, id: created[0].id, name: "Rent unit 4", match: "any" } }).linkRules!;
  expect(edited).toHaveLength(1); expect(edited[0]).toMatchObject({ name: "Rent unit 4", match: "any" });
  expect(save({ kind: "delete", id: created[0].id }).linkRules).toBeUndefined();
});
it("requires a condition, a known asset and an existing rule to edit", () => {
  const { save } = fixture();
  expect(() => save({ kind: "save", rule: { ...rule, conditions: [] } })).toThrow(/at least one condition/);
  expect(() => save({ kind: "save", rule: { ...rule, conditions: [{ field: "account", operator: "contains", value: "x" }] } })).toThrow(/cannot be compared/);
  expect(() => save({ kind: "save", rule: { ...rule, conditions: [{ field: "amount", operator: "between", value: "5", value2: "1" }] } })).toThrow(/must not exceed/);
  expect(() => save({ kind: "save", rule }, "missing")).toThrow(/unavailable/);
  expect(() => save({ kind: "save", rule: { ...rule, id: "gone" } })).toThrow(/no longer exists/);
  expect(() => save({ kind: "save", rule: { ...rule, classification: "bogus" } })).toThrow();
});
