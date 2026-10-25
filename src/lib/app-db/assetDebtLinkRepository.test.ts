import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getAppDb, resetAppDbForTests } from "./connection";
import { saveAsset, readRegistry } from "./assetRepository";
import { applyAccountClassChanges } from "./accountClassRepository";
import { saveAssetDebtAllocation } from "./assetDebtLinkRepository";
import { createDebtConfiguration, deleteArchivedDebtPermanently } from "@/lib/assets-debt/services/debtConfigService";
import { BUDGET, directory, saveInput } from "@/lib/assets-debt/testing/debtFixtures";
import { loanFingerprint } from "@/lib/asset-registry/financing";
import { testAsset } from "@/lib/asset-registry/testing";

function fixture() {
  const db = getAppDb(join(mkdtempSync(join(tmpdir(), "asset-debt-")), "app.sqlite"));
  applyAccountClassChanges(db, { budgetSyncId: BUDGET, changes: [{ scope: "account", id: "acc-car", accountClass: "vehicle" }] });
  for (const id of ["byd", "toyota"]) {
    const a = testAsset(id);
    saveAsset(db, { budgetSyncId: BUDGET, asset: { id, actualAccountId: "acc-car", assetType: "vehicle", assetTag: a.assetTag, name: id, description: null, status: "active", revision: 0, ownership: a.ownership }, accountDirectory: [{ id: "acc-car", name: "Car", offBudget: true, closed: false }] });
  }
  const debtId = createDebtConfiguration(db, saveInput(), directory()).debt.id;
  db.prepare("UPDATE debts SET status='active'").run();
  const save = (assetId: string, operation: object, fingerprint?: string) => saveAssetDebtAllocation(db, { budgetSyncId: BUDGET, assetId, debtId, operation, expectedFingerprint: fingerprint ?? loanFingerprint(readRegistry(db, BUDGET).debtLinks ?? [], debtId) });
  return { db, save, debtId };
}
afterEach(resetAppDbForTests);
it("preserves history on change/end/reopen and refuses over-allocation atomically, archived assets included", () => {
  const { db, save } = fixture();
  save("byd", { kind: "set", effectiveFrom: "2026-01-01", allocationBps: 10000 });
  const changed = save("byd", { kind: "set", effectiveFrom: "2026-07-01", allocationBps: 6000 }).debtLinks!;
  expect(changed.map((l) => [l.effectiveFrom, l.effectiveTo, l.allocationBps])).toEqual([["2026-01-01", "2026-07-01", 10000], ["2026-07-01", null, 6000]]);
  expect(() => save("toyota", { kind: "set", effectiveFrom: "2026-07-01", allocationBps: 5000 })).toThrow(/exceed 100%/);
  expect(readRegistry(db, BUDGET).debtLinks).toEqual(changed); // refused as one unit
  save("toyota", { kind: "set", effectiveFrom: "2026-07-01", allocationBps: 4000 });
  db.prepare("UPDATE assets SET status='archived', archived_at='t' WHERE id='toyota'").run(); // archived share still reserves
  expect(() => save("byd", { kind: "set", effectiveFrom: "2026-07-01", allocationBps: 7000 })).toThrow(/exceed 100%/);
  const ended = save("byd", { kind: "end", effectiveFrom: "2027-01-01" }).debtLinks!;
  expect(ended.filter((l) => l.assetId === "byd").at(-1)).toMatchObject({ effectiveFrom: "2026-07-01", effectiveTo: "2027-01-01" });
});
it("rejects a stale loan view so another asset's concurrent change is never overwritten", () => {
  const { save, db, debtId } = fixture();
  const stale = loanFingerprint(readRegistry(db, BUDGET).debtLinks ?? [], debtId);
  save("byd", { kind: "set", effectiveFrom: "2026-01-01", allocationBps: 5000 });
  expect(() => save("toyota", { kind: "set", effectiveFrom: "2026-01-01", allocationBps: 5000 }, stale)).toThrow(/changed/);
});
it("blocks permanent deletion of a linked loan with a clear message and does not touch the loan", () => {
  const { save, db, debtId } = fixture();
  save("byd", { kind: "set", effectiveFrom: "2026-01-01", allocationBps: 10000 });
  db.prepare("UPDATE debts SET status='archived', archived_at='t'").run();
  expect(() => deleteArchivedDebtPermanently(db, debtId)).toThrow(/asset allocations/);
  expect(db.prepare("SELECT COUNT(*) AS n FROM debts").get<{ n: number }>()!.n).toBe(1);
});
