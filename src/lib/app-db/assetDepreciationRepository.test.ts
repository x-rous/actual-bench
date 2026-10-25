import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getAppDb, resetAppDbForTests } from "./connection";
import { saveAsset, readRegistry } from "./assetRepository";
import { applyAccountClassChanges } from "./accountClassRepository";
import { saveDepreciationSettings } from "./assetDepreciationRepository";
import { testAsset } from "@/lib/asset-registry/testing";

const settings = { method: "straight-line", basisMinor: 120000, residualMinor: 0, startDate: "2026-01-01", lifeMonths: 12, annualRateBps: null };
function fixture() {
  const db = getAppDb(join(mkdtempSync(join(tmpdir(), "asset-dep-")), "app.sqlite"));
  applyAccountClassChanges(db, { budgetSyncId: "budget", changes: [{ scope: "account", id: "vehicles", accountClass: "vehicle" }] });
  const a = testAsset("byd");
  saveAsset(db, { budgetSyncId: "budget", asset: { id: "byd", actualAccountId: "vehicles", assetType: "vehicle", assetTag: a.assetTag, name: "byd", description: null, status: "active", revision: 0, ownership: a.ownership }, accountDirectory: [{ id: "vehicles", name: "Vehicles", offBudget: true, closed: false }] });
  const revision = () => readRegistry(db, "budget").assets[0].revision;
  const save = (over: object = {}, expectedUpdatedAt: string | null = null) => saveDepreciationSettings(db, { budgetSyncId: "budget", assetId: "byd", assetRevision: revision(), expectedUpdatedAt, settings, ...over });
  return { db, save };
}
afterEach(resetAppDbForTests);
it("stores one current schedule per asset, edits it prospectively and removes it without touching anything else", () => {
  const { save } = fixture();
  const first = save().depreciation![0];
  expect(first).toMatchObject({ assetId: "byd", basisMinor: 120000, lifeMonths: 12 });
  expect(() => save({}, null)).toThrow(/changed/); // stale: the editor saw no schedule
  const edited = save({ settings: { ...settings, basisMinor: 240000, lifeMonths: 24 } }, first.updatedAt).depreciation!;
  expect(edited).toHaveLength(1); expect(edited[0].basisMinor).toBe(240000);
  expect(save({ settings: null }, edited[0].updatedAt).depreciation).toBeUndefined();
});
it("refuses a stale asset revision, a wrong method shape, a residual above basis and an archived asset", () => {
  const { save, db } = fixture();
  expect(() => save({ assetRevision: 99 })).toThrow(/asset changed/);
  expect(() => save({ settings: { ...settings, annualRateBps: 500 } })).toThrow();
  expect(() => save({ settings: { ...settings, residualMinor: 130000 } })).toThrow(/Residual/);
  db.prepare("UPDATE assets SET status='archived', archived_at='t'").run();
  expect(() => save({ assetRevision: readRegistry(db, "budget").assets[0].revision })).toThrow(/Restore/);
});
