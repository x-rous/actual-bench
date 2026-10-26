import { normalizeActivity } from "@/features/credit-cards/lib/activity";
import { performance } from "./performance";
import { capitalMovements } from "./capitalMovements";
import { testAsset, testRow } from "./testing";
import type { BookSnapshot } from "./ledger";
import type { Registry, AssetContext } from "./models";

function calculate(bookRows = [testRow("opening", 10000, { date: "2025-12-31" }), testRow("capital", 2000), testRow("revaluation", 1500)]) {
  const asset = testAsset("asset", { assetTag: null });
  const rows = normalizeActivity(bookRows).rows;
  const snapshot: BookSnapshot = { accountId: "vehicles", date: "2026-10-24", source: bookRows, rows, balanceMinor: rows.reduce((s, r) => s + r.amountMinor, 0), issues: [], fetchedAt: "read", transferKnown: true };
  const registry: Registry = { assets: [asset], metadata: bookRows.map((r) => ({ actualTransactionId: r.id, actualAccountId: "vehicles", assetId: asset.id, classification: r.id === "opening" ? "opening-balance" : r.id === "capital" ? "acquisition" : "revaluation", revision: 1 })), cashflows: [
    { actualTransactionId: "rent", actualAccountId: "bank", assetId: asset.id, classification: null, revision: 1 },
    { actualTransactionId: "maintenance", actualAccountId: "bank", assetId: asset.id, classification: null, revision: 1 },
  ] };
  const external = { accounts: [], issues: [], fetchedAt: "read", rows: normalizeActivity([testRow("rent", 500, { accountId: "bank" }), testRow("maintenance", -200, { accountId: "bank" })]).rows };
  const run = (from = "2026-01-01", to = "2026-10-24") => performance(asset, registry, snapshot, external, from, to);
  return { registry, snapshot, external, run, asset };
}
it("calculates the approved 100+20→135 / income5-expense2 example and new periods automatically", () => {
  const f = calculate();
  expect(f.run()).toMatchObject({ openingMinor: 10000, capitalAddedMinor: 2000, closingMinor: 13500, operatingMinor: 300, totalMinor: 1800, operatingYield: 2.5, simpleReturn: 15, gaps: [] });
  expect(f.run("2026-02-01")).toMatchObject({ openingMinor: 13500, capitalAddedMinor: 0, operatingMinor: 0, totalMinor: 0 });
});
it.each(["external-receipt", "asset-transfer"] as const)("deducts gross selling costs once and keeps already-net proceeds unchanged for %s", (representation) => {
  for (const basis of ["gross", "net"] as const) {
    const p = basis === "gross" ? 11000 : 10800;
    const source = testRow("sale", representation === "asset-transfer" ? -p : p, { accountId: representation === "asset-transfer" ? "vehicles" : "bank", transferId: representation === "asset-transfer" ? "bank-peer" : null });
    const delta = representation === "asset-transfer" ? p - 10000 : -10000;
    const f = calculate([testRow("opening", 10000, { date: "2025-12-31" }), ...(representation === "asset-transfer" ? [source] : []), testRow("adjustment", delta)]);
    f.registry.cashflows = [{ actualTransactionId: "cost", actualAccountId: "bank", assetId: "asset", classification: "other-excluded", context: { version: 1, data: { kind: "selling-cost", disposalTransactionId: "sale" } }, revision: 1 }];
    f.external.rows = normalizeActivity([...(representation === "external-receipt" ? [source] : []), testRow("cost", -200, { accountId: "bank", date: "2026-11-01" })]).rows;
    const context: AssetContext = { version: 1, data: { kind: "disposal", representation, carryingRemovedMinor: 10000, bookAdjustmentTransactionId: "adjustment", proceedsBasis: basis } };
    f.registry.metadata.find((m) => m.actualTransactionId === "adjustment")!.classification = "disposal";
    if (representation === "asset-transfer") Object.assign(f.registry.metadata.find((m) => m.actualTransactionId === "sale")!, { classification: "disposal", context });
    else f.registry.cashflows.push({ actualTransactionId: "sale", actualAccountId: "bank", assetId: "asset", classification: "disposal-proceeds", context, revision: 1 });
    expect(f.run()).toMatchObject({ closingMinor: 0, netProceedsMinor: 10800, operatingMinor: 0, totalMinor: 800, simpleReturn: 8, gaps: [] });
    // The chart's capital movements carry the same net proceeds, with the cost deducted once and never as its own movement.
    expect(capitalMovements(f.asset, f.registry, f.snapshot, f.external)).toEqual([expect.objectContaining({ kind: "disposal", amountMinor: 10800, rowIds: ["sale"] })]);
    // The fee's real November date does not move October disposal costs into November P&L.
    expect(f.run("2026-11-01", "2026-11-30")).toMatchObject({ operatingMinor: 0, netProceedsMinor: 0, totalMinor: 0 });
  }
});
it("annualizes money-weighted only over a period long enough, and not while incomplete", () => {
  const f = calculate();
  expect(f.run("2026-01-01", "2026-10-24").irr).toEqual(expect.any(Number));
  expect(f.run("2026-10-01", "2026-10-24").irr).toBeNull(); // three weeks is too short to annualize
});
it("withholds total returns while a row is unclassified, and ignores a link whose transaction is gone", () => {
  const f = calculate([testRow("opening", 10000, { date: "2025-12-31" }), testRow("capital", -2000, { transferId: "peer" }), testRow("revaluation", 1500)]);
  f.registry.metadata = f.registry.metadata.filter((m) => m.actualTransactionId !== "capital"); // money out by transfer has no suggestion
  expect(f.run()).toMatchObject({ operatingMinor: 300, totalMinor: null, simpleReturn: null, gaps: ["Unclassified entries"] });
  const g = calculate();
  g.external.rows = g.external.rows.filter((r) => r.id !== "rent"); // deleted in Actual: no longer counted, and nothing to review
  expect(g.run()).toMatchObject({ operatingMinor: -200, gaps: [] });
});
it("does not flag a moved source; a hand-picked Disposal with no sale recorded is a gap, and a nonpositive base withholds returns", () => {
  const f = calculate();
  f.registry.metadata.find((m) => m.actualTransactionId === "capital")!.classification = "disposal"; // a hand-picked Disposal is the one gap Bench cannot resolve itself
  expect(f.run().gaps).toEqual(["Disposal treatment is missing"]);
  const zero = calculate([testRow("opening", 0, { date: "2025-01-01" })]);
  zero.registry.cashflows = []; zero.external.rows = [];
  expect(zero.run()).toMatchObject({ totalMinor: 0, operatingYield: null, simpleReturn: null });
});
it("limits an unreadable external account to assets that link to it", () => {
  const f = calculate();
  const unrelated = { ...f.external, issues: ["Other: Could not read Other."], accountIssues: { other: ["Other: Could not read Other."] } };
  expect(performance(f.asset, f.registry, f.snapshot, unrelated, "2026-01-01", "2026-10-24")).toMatchObject({ totalMinor: 1800, simpleReturn: 15, gaps: [] });
  const linked = { ...f.external, issues: ["Bank: Could not read Bank."], accountIssues: { bank: ["Bank: Could not read Bank."] } };
  expect(performance(f.asset, f.registry, f.snapshot, linked, "2026-01-01", "2026-10-24")).toMatchObject({ totalMinor: null, simpleReturn: null, gaps: ["Bank: Could not read Bank."] });
});
it("counts a posted depreciation month once, through closing value only, and revaluation does not repeat it", () => {
  const f = calculate([testRow("opening", 10000, { date: "2025-12-31" }), testRow("dep", -1000, { date: "2026-01-31" }), testRow("reval", 1500, { date: "2026-02-10" })]);
  f.registry.metadata = [
    { actualTransactionId: "opening", actualAccountId: "vehicles", assetId: "asset", classification: "opening-balance", revision: 1 },
    { actualTransactionId: "dep", actualAccountId: "vehicles", assetId: "asset", classification: "depreciation", depreciationPeriod: "2026-01", revision: 1 },
    { actualTransactionId: "reval", actualAccountId: "vehicles", assetId: "asset", classification: "revaluation", revision: 1 },
  ];
  f.registry.cashflows = []; f.external.rows = [];
  expect(f.run()).toMatchObject({ openingMinor: 10000, closingMinor: 10500, capitalAddedMinor: 0, operatingMinor: 0, totalMinor: 500, gaps: [] });
});
it("lists a transfer in as an investment, and nothing noncash as a capital movement", () => {
  const transfer = testRow("buy", 50000, { transferId: "bank-peer", date: "2026-02-01" });
  const f = calculate([testRow("opening", 10000, { date: "2025-12-31" }), transfer, testRow("adjust", 2000, { date: "2026-03-01" })]);
  f.registry.metadata = [{ actualTransactionId: "buy", actualAccountId: "vehicles", assetId: "asset", classification: "acquisition", revision: 1 }, { actualTransactionId: "adjust", actualAccountId: "vehicles", assetId: "asset", classification: "revaluation", revision: 1 }];
  f.registry.cashflows = []; f.external.rows = [];
  expect(capitalMovements(f.asset, f.registry, f.snapshot, f.external)).toEqual([{ date: "2026-02-01", kind: "investment", amountMinor: -50000, rowIds: ["buy"] }]); // the noncash adjustment is not a movement
});
