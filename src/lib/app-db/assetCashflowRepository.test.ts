import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getAppDb, resetAppDbForTests } from "./connection";
import { saveAsset, saveBookMetadata, readRegistry } from "./assetRepository";
import { applyAccountClassChanges } from "./accountClassRepository";
import { saveAssetCashflows } from "./assetCashflowRepository";
import { testAsset, testRow } from "@/lib/asset-registry/testing";
import { normalizeActivity } from "@/features/credit-cards/lib/activity";
import { sourceEvidence, type CashflowChange } from "@/lib/asset-registry/cashflows";
function fixture() {
  const db = getAppDb(join(mkdtempSync(join(tmpdir(), "asset-cashflow-")), "app.sqlite"));
  applyAccountClassChanges(db, { budgetSyncId: "budget", changes: [{ scope: "account", id: "vehicles", accountClass: "vehicle" }] });
  for (const id of ["byd", "toyota"]) {
    const a = testAsset(id);
    saveAsset(db, { budgetSyncId: "budget", asset: { id, actualAccountId: "vehicles", assetType: "vehicle", assetTag: a.assetTag, name: id, description: null, status: "active", revision: 0, ownership: a.ownership }, accountDirectory: [{ id: "vehicles", name: "Vehicles", offBudget: true, closed: false }] });
  }
  const sources = sourceEvidence(normalizeActivity([testRow("expense", -2000000, { accountId: "bank", categoryId: "renovation" }), testRow("book", 2000000, { notes: "#asset_byd" }), testRow("proceeds", 11000000, { accountId: "bank" }), testRow("removal", -10000000, { notes: "#asset_byd" }), testRow("fee", -200000, { accountId: "bank", date: "2026-02-01" })]).rows);
  const save = (changes: CashflowChange[], live = sources) => saveAssetCashflows(db, { budgetSyncId: "budget", changes, sources: live });
  const link: CashflowChange = { role: "cashflow", actualTransactionId: "expense", actualAccountId: "bank", assetId: "byd", classification: "capital-expenditure", revision: 0 };
  return { db, save, link, sources };
}
afterEach(resetAppDbForTests);
it("links whole external rows, rejects theft/stale revisions and refuses parent-child overlap", () => {
  const { save, link, sources } = fixture();
  expect(save([link]).cashflows).toHaveLength(1);
  expect(() => save([link])).toThrow(/changed/);
  expect(() => save([{ ...link, revision: 1, assetId: "toyota" }])).toThrow(/another asset/);
  expect(() => save([{ ...link, revision: 1 }], [...sources, { ...sources[0], id: "child", parentId: "expense" }])).toThrow(/parent\/child/);
  expect(() => save([{ ...link, revision: 1, actualAccountId: "moved" }])).toThrow(/account changed/);
});
it("pairs CapEx atomically, enforces unique capitalized sources and retains its classification", () => {
  const { db, save, link, sources } = fixture();
  const pair: CashflowChange = { role: "book", actualTransactionId: "book", actualAccountId: "vehicles", assetId: "byd", classification: "capital-expenditure", capitalizedFromTransactionId: "expense", revision: 0 };
  expect(() => save([link, pair], sources.map((r) => r.id === "book" ? { ...r, amountMinor: 1 } : r))).toThrow(/inconsistent/);
  expect(readRegistry(db, "budget").cashflows).toBeUndefined();
  save([link, pair]);
  expect(() => save([{ ...pair, actualTransactionId: "another" }], [...sources, { ...sources.find((r) => r.id === "book")!, id: "another" }])).toThrow(/already capitalized/);
  expect(() => save([{ ...link, revision: 1, classification: "operating-expense" }])).toThrow(/retain/);
  const result = save([{ ...link, revision: 1, remove: true }]);
  expect(result.metadata[0].capitalizedFromTransactionId).toBe("expense");
});
it("stores one disposal anchor and separately linked selling costs; refuses inconsistent companion reuse", () => {
  const { save, sources } = fixture();
  const anchor: CashflowChange = { role: "cashflow", actualTransactionId: "proceeds", actualAccountId: "bank", assetId: "byd", classification: "disposal-proceeds", revision: 0, context: { version: 1, data: { kind: "disposal", representation: "external-receipt", carryingRemovedMinor: 10000000, bookAdjustmentTransactionId: "removal", proceedsBasis: "gross" } } };
  const removal: CashflowChange = { role: "book", actualTransactionId: "removal", actualAccountId: "vehicles", assetId: "byd", classification: "disposal", revision: 0 };
  const fee: CashflowChange = { role: "cashflow", actualTransactionId: "fee", actualAccountId: "bank", assetId: "byd", classification: "other-excluded", revision: 0, context: { version: 1, data: { kind: "selling-cost", disposalTransactionId: "proceeds" } } };
  const result = save([anchor, removal, fee]); expect(result.cashflows).toHaveLength(2);
  expect(() => save([{ ...anchor, actualTransactionId: "second", revision: 0 }], [...sources, { ...sources[2], id: "second" }])).toThrow(/already used/);
  expect(() => save([{ ...fee, revision: 1, classification: "operating-expense" }])).toThrow(/Selling cost/);
});
it("keeps capital/disposal book rows bound to their treatment when metadata is cleared or moved", () => {
  const { save, link, db } = fixture();
  const pair: CashflowChange = { role: "book", actualTransactionId: "book", actualAccountId: "vehicles", assetId: "byd", classification: "capital-expenditure", capitalizedFromTransactionId: "expense", revision: 0 };
  save([link, pair]);
  const book = (change: object) => () => saveBookMetadata(db, { budgetSyncId: "budget", changes: [{ actualTransactionId: "book", actualAccountId: "vehicles", assetId: "byd", classification: "capital-expenditure", revision: 1, ...change }] });
  expect(book({ remove: true })).toThrow(/capital\/disposal/);
  expect(book({ assetId: null })).toThrow(/capital\/disposal/);
  expect(book({ classification: "revaluation" })).toThrow(/capital\/disposal/);
  expect(book({})).not.toThrow();
});
it("keeps one posted depreciation month per asset across schedule edits and protects its book row", () => {
  const { db, save } = fixture();
  const month = (id: string, period = "2026-01"): CashflowChange => ({ role: "book", actualTransactionId: id, actualAccountId: "vehicles", assetId: "byd", classification: "depreciation", depreciationPeriod: period, revision: 0 });
  const live = [...normalizeActivity([testRow("jan", -100000, { notes: "#asset_byd" }), testRow("jan-again", -100000, { notes: "#asset_byd" }), testRow("gain", 5, { notes: "#asset_byd" })]).rows].map(({ id, accountId, date, amountMinor, parentId, transferId, categoryId, notes }) => ({ id, accountId, date, amountMinor, parentId, transferId, categoryId, notes }));
  save([month("jan")], live);
  expect(() => save([month("jan-again")], live)).toThrow(/already posted/);
  expect(() => save([month("gain", "2026-02")], live)).toThrow(/negative depreciation/);
  const book = (change: object) => () => saveBookMetadata(db, { budgetSyncId: "budget", changes: [{ actualTransactionId: "jan", actualAccountId: "vehicles", assetId: "byd", classification: "depreciation", revision: 1, ...change }] });
  expect(book({ remove: true })).toThrow(/capital\/disposal/);
  expect(book({ classification: "revaluation" })).toThrow(/capital\/disposal/);
  // A deleted Actual row is replaced deliberately: remove the stale association and record the new month in one batch.
  const replaced = save([{ ...month("jan"), revision: 1, remove: true }, month("jan-again")], live);
  expect(replaced.metadata.filter((m) => m.depreciationPeriod === "2026-01").map((m) => m.actualTransactionId)).toEqual(["jan-again"]);
});
it("matches an existing, already classified book row to its CapEx expense without writing anything else", () => {
  const { db, save, link, sources } = fixture();
  const existing: CashflowChange = { role: "book", actualTransactionId: "book", actualAccountId: "vehicles", assetId: "byd", classification: "capital-expenditure", revision: 0 };
  save([existing, link]); // both classified on their own; no relationship yet
  expect(readRegistry(db, "budget").metadata[0].capitalizedFromTransactionId ?? null).toBeNull();
  const matched = save([{ ...existing, capitalizedFromTransactionId: "expense", revision: 1 }]);
  expect(matched.metadata[0]).toMatchObject({ actualTransactionId: "book", capitalizedFromTransactionId: "expense", revision: 2 });
  expect(matched.cashflows).toHaveLength(1);
  // a second adjustment cannot claim the same expense
  const live = [...sources, { ...sources.find((r) => r.id === "book")!, id: "other-book" }];
  expect(() => save([{ ...existing, actualTransactionId: "other-book", capitalizedFromTransactionId: "expense", revision: 0 }], live)).toThrow(/already capitalized/);
});
