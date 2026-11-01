import { reviewAssetEntries, valueChangeRows, type AssetEntry } from "./assetReview";
import { resolvePeriod } from "./period";

const period = resolvePeriod({ kind: "custom", startMonth: "2026-09", endMonth: "2026-09" }, "2026-11-18", null);
const entry = (id: string, extra: Partial<AssetEntry> = {}): AssetEntry => ({ id, date: "2026-09-10", accountId: "house", categoryId: null, amountMinor: 100_000, notes: null, ...extra });
const saved = (id: string, classification: string | null, accountId = "house") => ({ actualTransactionId: id, actualAccountId: accountId, classification });

describe("asset entries, as the Asset Registry classifies them", () => {
  it("never asks for review about an ordinary or unclassified movement", () => {
    const rows = [entry("a"), entry("b", { amountMinor: -5_000 }), entry("c", { categoryId: "fees" }), entry("d", { notes: "no tag here" })];
    expect(reviewAssetEntries(rows, [], period)).toEqual([]);
  });

  it("asks for review only about capital without a recorded transfer, from a saved type or a Notes tag", () => {
    const review = reviewAssetEntries([entry("a"), entry("b"), entry("c", { notes: "#added-capital" }), entry("d")], [saved("b", "acquisition"), saved("d", "revaluation")], period);
    expect(review.map((r) => [r.id, r.reason])).toEqual([
      ["b", "Classified as Acquisition / Purchase, but not paid by a recorded transfer"],
      ["c", "Classified as Added Capital, but not paid by a recorded transfer"],
    ]);
  });

  it("takes value changes out, wherever their category or amount points", () => {
    const rows = [entry("a"), entry("b", { notes: "year end #revaluation", categoryId: "misc" }), entry("c"), entry("d", { amountMinor: -9_000 }), entry("e")];
    const changes = valueChangeRows(rows, [saved("a", "revaluation"), saved("c", "depreciation"), saved("d", "disposal"), saved("e", "acquisition")]);
    expect(changes.map((r) => r.amountMinor)).toEqual([100_000, 100_000, 100_000, -9_000]);
    expect(changes[1]).toMatchObject({ categoryId: "misc", month: "2026-09", to: "valueChange" });
  });

  it("ignores a saved classification that belongs to another account, and rows outside the period", () => {
    const review = reviewAssetEntries([entry("a"), entry("late", { date: "2026-10-01", notes: "#acquisition" }), entry("early", { date: "2026-08-31", notes: "#acquisition" })], [saved("a", "acquisition", "elsewhere")], period);
    expect(review).toEqual([]);
  });
});
