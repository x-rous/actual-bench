import { normalizeActivity } from "@/features/credit-cards/lib/activity";
import { capitalizationIssues } from "./capitalization";
import { performance } from "./performance";
import { testAsset, testRow } from "./testing";
import type { BookSnapshot } from "./ledger";
import type { Registry } from "./models";

/** A 10,000 asset since 2025, then a 2,000 renovation paid from the bank in October 2026 and capitalized. */
function fixture(options: { paired?: boolean; bookAmount?: number } = {}) {
  const { paired = true, bookAmount = 2000 } = options;
  const asset = testAsset("flat", { assetTag: null });
  const source = [testRow("opening", 10000, { date: "2025-01-10" }), testRow("pair", bookAmount, { date: "2026-10-01" })];
  const rows = normalizeActivity(source).rows;
  const snapshot: BookSnapshot = { accountId: "vehicles", date: "2026-10-24", source, rows, balanceMinor: rows.reduce((s, r) => s + r.amountMinor, 0), issues: [], fetchedAt: "read", transferKnown: true };
  const registry: Registry = { assets: [asset], metadata: [
    { actualTransactionId: "opening", actualAccountId: "vehicles", assetId: "flat", classification: "opening-balance", revision: 1 },
    { actualTransactionId: "pair", actualAccountId: "vehicles", assetId: "flat", classification: "capital-expenditure", revision: 1, ...(paired ? { capitalizedFromTransactionId: "roof" } : {}) },
  ], cashflows: [{ actualTransactionId: "roof", actualAccountId: "bank", assetId: "flat", classification: "capital-expenditure", revision: 1 }] };
  const external = { accounts: [], issues: [], fetchedAt: "read", rows: normalizeActivity([testRow("roof", -2000, { accountId: "bank", date: "2026-10-01", categoryId: "reno" })]).rows };
  return { asset, snapshot, registry, external, run: (from: string, to: string) => performance(asset, registry, snapshot, external, from, to), issues: () => capitalizationIssues(asset, registry, snapshot, external) };
}

it("a matched capitalization raises nothing, and a later one never makes an earlier period incomplete", () => {
  const f = fixture();
  expect(f.issues()).toEqual([]);
  expect(f.run("2026-01-01", "2026-10-24")).toMatchObject({ capitalAddedMinor: 2000, gaps: [] });
  expect(f.run("2025-01-01", "2025-12-31")).toMatchObject({ openingMinor: 0, capitalAddedMinor: 10000, closingMinor: 10000, totalMinor: 0, gaps: [] }); // the October 2026 pair is outside 2025
});
it("an expense marked CapEx without a recorded companion is one finding, with the matching book row offered, and only for periods that reach it", () => {
  const f = fixture({ paired: false });
  const [issue] = f.issues();
  expect(f.issues()).toHaveLength(1);
  expect(issue).toMatchObject({ sourceId: "roof", reason: "no-companion", expectedMinor: 2000, candidates: [{ id: "pair", amountMinor: 2000 }] });
  expect(f.run("2026-01-01", "2026-10-24").gaps).toEqual(["Capitalization needs review"]); // one message, not two
  expect(f.run("2025-01-01", "2025-12-31").gaps).toEqual([]);
});
it("reports an unmatched expense with no candidate in plain terms", () => {
  const [issue] = fixture({ paired: false, bookAmount: 1500 }).issues();
  expect(issue.candidates).toEqual([]); expect(issue.detail).toMatch(/value is understated/);
});
it("reports a companion that no longer equals the expense", () => {
  const [issue] = fixture({ bookAmount: 1500 }).issues();
  expect(issue).toMatchObject({ reason: "mismatch", companion: { id: "pair", amountMinor: 1500 } });
});
