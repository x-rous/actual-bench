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
    { actualTransactionId: "rent", actualAccountId: "bank", assetId: asset.id, classification: "rental-income", revision: 1 },
    { actualTransactionId: "maintenance", actualAccountId: "bank", assetId: asset.id, classification: "operating-expense", revision: 1 },
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
it("keeps independently computable operating amounts while suppressing incomplete total returns", () => {
  const f = calculate();
  f.registry.metadata.find((m) => m.actualTransactionId === "capital")!.classification = null;
  expect(f.run()).toMatchObject({ operatingMinor: 300, totalMinor: null, simpleReturn: null });
  f.external.rows = f.external.rows.filter((r) => r.id !== "rent");
  expect(f.run()).toMatchObject({ operatingMinor: null, totalMinor: null });
});
it("flags changed CapEx companions, moved sources, unclassified cashflows and a nonpositive base", () => {
  const f = calculate();
  f.registry.metadata.find((m) => m.actualTransactionId === "capital")!.capitalizedFromTransactionId = "maintenance";
  expect(f.run().gaps.join(" ")).toMatch(/Capitalization/);
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
it("lists investments, capitalized expenses and nothing noncash as capital movements", () => {
  const transfer = testRow("buy", 50000, { transferId: "bank-peer", date: "2026-02-01" });
  const f = calculate([testRow("opening", 10000, { date: "2025-12-31" }), transfer, testRow("cap-pair", 2000, { date: "2026-03-01" })]);
  f.registry.metadata = [{ actualTransactionId: "buy", actualAccountId: "vehicles", assetId: "asset", classification: "acquisition", revision: 1 }, { actualTransactionId: "cap-pair", actualAccountId: "vehicles", assetId: "asset", classification: "capital-expenditure", capitalizedFromTransactionId: "roof", revision: 1 }];
  f.registry.cashflows = [{ actualTransactionId: "roof", actualAccountId: "bank", assetId: "asset", classification: "capital-expenditure", revision: 1 }];
  f.external.rows = normalizeActivity([testRow("roof", -2000, { accountId: "bank", date: "2026-03-01" })]).rows;
  expect(capitalMovements(f.asset, f.registry, f.snapshot, f.external)).toEqual([
    { date: "2026-02-01", kind: "investment", amountMinor: -50000, rowIds: ["buy"] },
    { date: "2026-03-01", kind: "capex", amountMinor: -2000, rowIds: ["roof"] }, // the noncash book pair is not a movement
  ]);
});
