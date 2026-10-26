import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getAppDb, resetAppDbForTests } from "./connection";
import { saveAsset, saveBookMetadata, readRegistry } from "./assetRepository";
import { applyAccountClassChanges } from "./accountClassRepository";
import { saveAssetCashflows } from "./assetCashflowRepository";
import { deleteArchivedAsset, pruneStaleAssetMetadata } from "./assetMaintenanceRepository";
import { testAsset, testRow } from "@/lib/asset-registry/testing";
import { normalizeActivity } from "@/features/credit-cards/lib/activity";
import { sourceEvidence } from "@/lib/asset-registry/cashflows";

afterEach(() => resetAppDbForTests());
function fixture() {
  const db = getAppDb(join(mkdtempSync(join(tmpdir(), "asset-maintenance-")), "app.sqlite"));
  applyAccountClassChanges(db, { budgetSyncId: "budget", changes: [{ scope: "account", id: "vehicles", accountClass: "vehicle" }] });
  const a = testAsset("byd");
  const directory = [{ id: "vehicles", name: "Vehicles", offBudget: true, closed: false }, { id: "bank", name: "Bank", offBudget: false, closed: false }];
  const save = (status: "active" | "archived", revision: number) => saveAsset(db, { budgetSyncId: "budget", asset: { id: "byd", actualAccountId: "vehicles", assetType: "vehicle", assetTag: null, name: "byd", description: null, status, revision, ownership: a.ownership }, accountDirectory: directory });
  save("active", 0);
  const sources = sourceEvidence(normalizeActivity([testRow("rent", 500, { accountId: "bank" }), testRow("typed", 100)]).rows);
  // typed: a saved type; rent: a plain link.
  saveBookMetadata(db, { budgetSyncId: "budget", changes: [{ actualTransactionId: "typed", actualAccountId: "vehicles", assetId: null, classification: "revaluation", revision: 0 }] });
  saveAssetCashflows(db, { budgetSyncId: "budget", sources, changes: [
    { role: "cashflow", actualTransactionId: "rent", actualAccountId: "bank", assetId: "byd", classification: null, revision: 0 },
  ] });
  return { db, save, directory: directory.map((d) => d.id) };
}
const live = (accountId: string, ids: string[]) => ({ accountId, ids });

it("drops saved links to transactions Actual no longer has", () => {
  const { db, directory } = fixture();
  const { registry, dropped } = pruneStaleAssetMetadata(db, { budgetSyncId: "budget", directory, accounts: [live("vehicles", []), live("bank", [])] });
  expect(registry.metadata).toEqual([]); expect(registry.cashflows).toBeUndefined();
  expect(dropped).toBe(2);
  expect(pruneStaleAssetMetadata(db, { budgetSyncId: "budget", directory, accounts: [live("vehicles", []), live("bank", [])] }).dropped).toBe(0); // repeating changes nothing
});
it("never prunes an account that was not read completely, and drops links to an account Actual no longer has", () => {
  const { db, directory } = fixture();
  expect(pruneStaleAssetMetadata(db, { budgetSyncId: "budget", directory, accounts: [] }).dropped).toBe(0);
  const { registry } = pruneStaleAssetMetadata(db, { budgetSyncId: "budget", directory: directory.filter((id) => id !== "bank"), accounts: [] });
  expect(registry.cashflows).toBeUndefined();
});
it("deletes only an archived asset and everything Bench stored for it", () => {
  const { db, save } = fixture();
  expect(() => deleteArchivedAsset(db, { budgetSyncId: "budget", assetId: "byd" })).toThrow(/Archive/);
  save("archived", 1);
  const registry = deleteArchivedAsset(db, { budgetSyncId: "budget", assetId: "byd" });
  expect(registry.assets).toEqual([]); expect(registry.metadata).toEqual([]); expect(registry.cashflows).toBeUndefined();
  expect(readRegistry(db, "budget").assets).toEqual([]);
});
