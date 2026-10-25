import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getAppDb, resetAppDbForTests } from "./connection";
import { ASSET_REGISTRY_SQL } from "./schema";
import { runMigrations } from "./migrations";
import { saveAsset, saveBookMetadata, readRegistry } from "./assetRepository";
import { applyAccountClassChanges } from "./accountClassRepository";
import { testAsset } from "@/lib/asset-registry/testing";
import type { AssetInput } from "@/lib/asset-registry/models";
function setup() {
  const db = getAppDb(join(mkdtempSync(join(tmpdir(), "asset-registry-")), "metadata.sqlite"));
  applyAccountClassChanges(db, { budgetSyncId: "budget", changes: [{ scope: "group", id: "g", accountClass: "vehicle" }] });
  const a = testAsset();
  const asset: AssetInput = { id: a.id, name: a.name, assetType: "vehicle", actualAccountId: a.actualAccountId, description: null, status: "active", revision: 0, ownership: a.ownership, assetTag: "#asset_byd" };
  const payload = { budgetSyncId: "budget", asset, accountDirectory: [{ id: "vehicles", name: "Vehicles", offBudget: true, closed: false, groupId: "g" }] };
  return { db, payload };
}
afterEach(() => resetAppDbForTests());
it("upgrades v50 additively and has bootstrap parity/idempotence", () => {
  const { db } = setup();
  db.exec("DROP TABLE asset_transaction_metadata; DROP TABLE asset_ownership_periods; DROP TABLE assets; UPDATE app_meta SET value='50' WHERE key='schema_version'");
  expect(runMigrations(db).schemaVersion).toBe(58); expect(runMigrations(db).schemaVersion).toBe(58);
  expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  expect(readRegistry(db, "budget")).toEqual({ assets: [], metadata: [] });
});
it("saves shared assets, preserves archived unique tags/identity and guards stale ownership changes", () => {
  const { db, payload } = setup();
  const first = saveAsset(db, payload).assets[0];
  expect(first.assetTag).toMatch(/^#asset_[a-z0-9_-]+$/); expect(first.ownership).toEqual(payload.asset.ownership);
  saveAsset(db, { ...payload, asset: { ...payload.asset, id: "toyota", assetTag: "#asset_toyota" } });
  const archived = saveAsset(db, { ...payload, asset: { ...payload.asset, revision: 1, status: "archived" } }).assets.find((a) => a.id === first.id)!;
  expect(archived.assetTag).toBe(first.assetTag); expect(archived.archivedAt).not.toBeNull();
  expect(readRegistry(db, "budget").assets).toHaveLength(2);
  expect(() => saveAsset(db, { ...payload, asset: { ...payload.asset, revision: 1 } })).toThrow(/changed/);
  expect(() => db.prepare("UPDATE assets SET actual_account_id='other' WHERE id=?").run(first.id)).toThrow(/identity/);
  expect(readRegistry(db, "other").assets).toEqual([]);
});
it("rejects unsaved, closed, on-budget and incompatible accounts, and rolls back duplicate ownership dates", () => {
  const { db, payload } = setup();
  expect(() => saveAsset(db, { ...payload, accountDirectory: [] })).toThrow(/unavailable/);
  for (const extra of [{ closed: true }, { offBudget: false }, { groupId: null }]) expect(() => saveAsset(db, { ...payload, accountDirectory: [{ ...payload.accountDirectory[0], ...extra }] })).toThrow();
  expect(() => saveAsset(db, { ...payload, asset: { ...payload.asset, ownership: [...payload.asset.ownership, ...payload.asset.ownership] } })).toThrow(/unique/);
  expect(readRegistry(db, "budget").assets).toEqual([]);
});
it("scopes whole-row assignments, guards revisions and applies metadata batches atomically", () => {
  const { db, payload } = setup(); saveAsset(db, payload);
  const c = { actualTransactionId: "row", actualAccountId: "vehicles", assetId: "byd", classification: "opening-balance", revision: 0 };
  saveBookMetadata(db, { budgetSyncId: "budget", changes: [c] });
  expect(() => saveBookMetadata(db, { budgetSyncId: "budget", changes: [c] })).toThrow(/changed/);
  expect(() => saveBookMetadata(db, { budgetSyncId: "budget", changes: [{ ...c, actualTransactionId: "new" }, { ...c, actualTransactionId: "wrong", assetId: "foreign" }] })).toThrow(/budget and account/);
  expect(readRegistry(db, "budget").metadata).toHaveLength(1);
  saveBookMetadata(db, { budgetSyncId: "budget", changes: [{ ...c, revision: 1, remove: true }] });
  expect(readRegistry(db, "budget").metadata).toEqual([]);
});

it("accepts manual unique hashtags and stores no hashtag for dedicated accounts", () => {
  const { db, payload } = setup();
  const dedicated = saveAsset(db, { ...payload, asset: { ...payload.asset, assetTag: null } }).assets[0];
  expect(dedicated.assetTag).toBeNull();
  expect(() => saveAsset(db, { ...payload, asset: { ...payload.asset, id: "other", assetTag: null } })).toThrow(/Shared/);
  const shared = saveAsset(db, { ...payload, asset: { ...payload.asset, id: "other", assetTag: "#asset_family_car" } }).assets.find((a) => a.id === "other");
  expect(shared?.assetTag).toBe("#asset_family_car");
  expect(() => saveAsset(db, { ...payload, asset: { ...payload.asset, id: "duplicate", assetTag: "#asset_family_car" } })).toThrow(/already used/);
});

it("preserves saved tags, ownership and classification when upgrading existing v51 assets", () => {
  const { db } = setup();
  db.exec("DROP TABLE asset_transaction_metadata; DROP TABLE asset_ownership_periods; DROP TABLE assets");
  for (const sql of ASSET_REGISTRY_SQL) db.exec(sql);
  db.prepare("INSERT INTO assets(id,budget_sync_id,actual_account_id,name,asset_type,asset_tag,description,status,revision,created_at,updated_at,archived_at) VALUES('byd','budget','vehicles','byd','vehicle','#asset_byd',NULL,'active',1,'t','t',NULL)").run();
  db.prepare("INSERT INTO asset_ownership_periods VALUES('byd','2025-01-01',10000,'t','t')").run();
  db.prepare("INSERT INTO asset_transaction_metadata VALUES('budget','opening','vehicles','book','byd','opening-balance',NULL,1,'t','t')").run();
  db.exec("UPDATE app_meta SET value='51' WHERE key='schema_version'");
  runMigrations(db);
  const before = readRegistry(db, "budget");
  expect(runMigrations(db).schemaVersion).toBe(58);
  expect(readRegistry(db, "budget")).toEqual(before);
  expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
});
it("defaults income generation from the asset type and keeps an explicit choice", () => {
  const { db, payload } = setup();
  expect(saveAsset(db, payload).assets[0].incomeGenerating).toBe(false); // vehicle
  const kept = saveAsset(db, { ...payload, asset: { ...payload.asset, revision: 1, incomeGenerating: true } }).assets[0];
  expect(kept.incomeGenerating).toBe(true);
  expect(saveAsset(db, { ...payload, asset: { ...payload.asset, revision: 2, incomeGenerating: false } }).assets[0].incomeGenerating).toBe(false);
});
