import { assetHashtags, attributeBook, readBook } from "./ledger";
import { testAsset, testRow } from "./testing";
import { eligibility, ASSET_TYPES, ownershipAt } from "./models";
import type { ActualBenchTransport } from "@/lib/actual/transport";
const assets = [testAsset(), testAsset("toyota", { status: "archived", archivedAt: "now" })];
function transport(rows = [testRow("byd", 11000000, { notes: "#asset_byd" }), testRow("toyota", 7500000, { notes: "#asset_toyota" }), testRow("other", 500000)]) {
  return { mode: "http-api", getSyncCapabilities: () => ({ capabilities: { listTransactions: true, readSplitLines: true } }), listTransactionsForSync: jest.fn(async () => rows), getAccountBalances: jest.fn(async () => new Map([["vehicles", rows.reduce((s, r) => s + r.amount, 0) / 100]])), canVerifyTransferLinks: jest.fn(async () => true) } as unknown as ActualBenchTransport;
}
it("reconciles shared Vehicles, archived tags and dedicated adoption without a write", async () => {
  const t = transport(); const snapshot = await readBook(t, "vehicles", "2026-10-24");
  const book = attributeBook(snapshot, assets, []);
  expect([...book.totals.values()]).toEqual([11000000, 7500000]);
  expect(book.unassignedMinor).toBe(500000); expect(snapshot.balanceMinor).toBe(19000000);
  const dedicated = await readBook(transport([testRow("opening", -123)]), "vehicles", "2026-10-24");
  expect(attributeBook(dedicated, [assets[0]], []).totals.get("byd")).toBe(-123);
  expect(t.listTransactionsForSync).toHaveBeenCalledTimes(1);
});
it("uses exact tags, explicit maps for transfers and leaves conflicts/unknown tags Unassigned", async () => {
  const rows = [testRow("a", 10, { notes: "#asset_byd #asset_toyota" }), testRow("b", -20, { transferId: "peer" }), testRow("c", 30, { notes: "#asset_byd" }), testRow("d", 40, { notes: "#asset_byd_suffix" })];
  const snapshot = await readBook(transport(rows), "vehicles", "2026-10-24");
  const book = attributeBook(snapshot, assets, [{ actualTransactionId: "b", actualAccountId: "vehicles", assetId: "byd", classification: null, revision: 1 }, { actualTransactionId: "c", actualAccountId: "vehicles", assetId: "toyota", classification: null, revision: 1 }]);
  expect(book.totals.get("byd")).toBe(-20); expect(book.unassignedMinor).toBe(80);
  expect(book.rows.filter((r) => r.assetId)).toHaveLength(1);
});
it("counts complete split children once and aligns cutoff including future rows", async () => {
  const parent = testRow("p", 100, { isParent: true, splitLines: [{ id: "c1", amount: 60, notes: "#asset_byd", payeeId: null, payeeName: null, categoryId: null, categoryName: null }, { id: "c2", amount: 40, notes: "#asset_toyota", payeeId: null, payeeName: null, categoryId: null, categoryName: null }] });
  const snapshot = await readBook(transport([parent, testRow("future", 20, { date: "2027-01-01" })]), "vehicles", "2026-10-24");
  const book = attributeBook(snapshot, assets, []);
  expect(snapshot.balanceMinor).toBe(100); expect([...book.totals.values()]).toEqual([60, 40]); expect(book.rows.map((r) => r.id)).toEqual(["c1", "c2"]);
  const incomplete = await readBook(transport([{ ...parent, splitLines: parent.splitLines.slice(0, 1) }]), "vehicles", "2026-10-24");
  expect(incomplete.balanceMinor).toBeNull(); expect(incomplete.issues.length).toBeGreaterThan(0);
});
it("never treats missing balance, mismatched sums or dangling associations as verified zero", async () => {
  const t = transport(); t.getAccountBalances = async () => new Map();
  expect((await readBook(t, "vehicles", "2026-10-24")).balanceMinor).toBeNull();
  t.getAccountBalances = async () => new Map([["vehicles", 0]]);
  expect((await readBook(t, "vehicles", "2026-10-24")).balanceMinor).toBeNull();
  const snapshot = await readBook(transport(), "vehicles", "2026-10-24");
  expect(attributeBook(snapshot, assets, [{ actualTransactionId: "missing", actualAccountId: "vehicles", assetId: "byd", classification: null, revision: 1 }]).issues).toEqual([expect.stringContaining("Missing or moved")]);
});
it("honors all eight classes, group inheritance, budget placement and effective ownership", () => {
  for (const [key, type] of Object.entries(ASSET_TYPES)) {
    const maps = { accounts: new Map([["a", "bank" as const]]), groups: new Map([["g", type.accountClass]]) };
    const account = { id: "a", name: "A", offBudget: true, closed: false, groupId: "g" };
    expect(eligibility(account, key, maps)).toBeNull();
    expect(eligibility({ ...account, offBudget: false }, key, maps)).toMatch(/off-budget/);
    expect(eligibility({ ...account, closed: true }, key, maps)).toMatch(/closed/);
  }
  expect(ownershipAt(assets[0], "2024-01-01")).toBeNull(); expect(ownershipAt(assets[0], "2026-01-01")).toBe(10000);
});

it("recognizes a confirmed empty HTTP account without inventing a missing nonempty balance", async () => {
  const t = transport([]); t.getAccountBalances = async () => new Map();
  t.getAccounts = async () => [{ id: "vehicles", name: "Vehicles", offBudget: true, closed: false }];
  expect((await readBook(t, "vehicles", "2026-10-24")).balanceMinor).toBe(0);
  t.getAccounts = async () => [];
  expect((await readBook(t, "vehicles", "2026-10-24")).balanceMinor).toBeNull();
});

it("compares full Unicode hashtag tokens rather than matching an asset tag prefix", () => {
  expect(assetHashtags("#asset_bydé #asset_byd_suffix text#asset_byd #asset_byd"))
    .toEqual(["#asset_bydé", "#asset_byd_suffix", "#asset_byd"]);
});

it("suppresses a dedicated value when contradictory tags prevent the full-account invariant", async () => {
  const snapshot = await readBook(transport([testRow("conflict", 100, { notes: "#asset_foreign" })]), "vehicles", "2026-10-24");
  const book = attributeBook(snapshot, [assets[0]], []);
  expect(book.available).toBe(false); expect(book.unassignedMinor).toBe(100);
  expect(book.issues).toContain("Dedicated account attribution conflicts require review");
});
it("reads a type from the Notes tag when Bench holds no classification, and prefers Bench's own", async () => {
  const t = transport([testRow("tagged", 100, { notes: "Wear #depreciation" }), testRow("mapped", 100, { notes: "Wear #depreciation" })]);
  const snapshot = await readBook(t, "vehicles", "2026-10-24");
  const rows = attributeBook(snapshot, [assets[0]], [{ actualTransactionId: "mapped", actualAccountId: "vehicles", assetId: "byd", classification: "revaluation", revision: 1 }]).rows;
  expect(rows.find((r) => r.id === "tagged")?.classification).toBe("depreciation");
  expect(rows.find((r) => r.id === "mapped")?.classification).toBe("revaluation");
});
