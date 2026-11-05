import { DEFAULT_BUFFER_SETTINGS, median, parseBufferSettings, NO_ADJUSTMENTS, UNCATEGORIZED_KEY, adjustedBuffer, isUnadjusted, parseAdjustments, parseScenarioResult, scenarioAmount, tidyAdjustments, type BufferAdjustments, type BufferCategoryRow } from "./bufferScenario";
import type { CashBuffer } from "./measures";

const rows: BufferCategoryRow[] = [
  { id: "rent", name: "Rent", group: "Housing", hidden: false, avgMinor: 200_000 },
  { id: "food", name: "Food", group: "Daily", hidden: false, avgMinor: 80_000 },
  { id: "fun", name: "Fun", group: "Leisure", hidden: false, avgMinor: 40_000 },
  { id: null, name: "Uncategorized", group: "Uncategorized", hidden: false, avgMinor: 10_000 },
];
// The categories add up to 330,000; the buffer's spending is 5,000 less (loan interest taken out), which is always kept.
const buffer: CashBuffer = {
  months: 0, cashMinor: 3_250_000, monthlyNeedMinor: 0, spendingMinor: 325_000, spendingMonths: 12,
  loans: [{ accountId: "mortgage", name: "Mortgage", monthlyMinor: 100_000, source: "schedule" }],
} as CashBuffer;
const adjust = (over: Partial<BufferAdjustments>): BufferAdjustments => ({ ...NO_ADJUSTMENTS, ...over });
const ready = (a: BufferAdjustments) => {
  const r = adjustedBuffer(buffer, rows, a);
  if (r.state !== "ready") throw new Error(r.reason);
  return r.value;
};

describe("cash buffer scenarios", () => {
  it("with nothing adjusted, equals the real buffer", () => {
    const v = ready(NO_ADJUSTMENTS);
    expect(v.spendingMinor).toBe(325_000);
    expect(v.monthlyNeedMinor).toBe(425_000);
    expect(v.months).toBeCloseTo(3_250_000 / 425_000, 10);
    expect(v.leftOut).toBe(0);
    expect(v.edited).toBe(0);
  });

  it("leaves a category out, and keeps what no category holds", () => {
    const v = ready(adjust({ excluded: ["fun", UNCATEGORIZED_KEY] }));
    expect(v.spendingMinor).toBe(325_000 - 40_000 - 10_000);
    expect(v.leftOut).toBe(2);
  });

  it("replaces an amount, and an amount for a category left out counts for nothing", () => {
    expect(ready(adjust({ amounts: { food: 50_000 } })).spendingMinor).toBe(295_000);
    expect(ready(adjust({ excluded: ["food"], amounts: { food: 50_000 } })).spendingMinor).toBe(245_000);
    expect(scenarioAmount(rows[1], adjust({ amounts: { food: 50_000 } }))).toBe(50_000);
  });

  it("leaves a loan out, or changes its repayment", () => {
    expect(ready(adjust({ loansExcluded: ["mortgage"] })).monthlyNeedMinor).toBe(325_000);
    const v = ready(adjust({ loanAmounts: { mortgage: 120_000 } }));
    expect(v.monthlyNeedMinor).toBe(445_000);
    expect(v.edited).toBe(1);
    expect(v.loans[0]).toMatchObject({ typicalMinor: 100_000, monthlyMinor: 120_000, included: true });
  });

  it("is unavailable, not infinite, when nothing is left to spend", () => {
    const all = adjust({ excluded: ["rent", "food", "fun", UNCATEGORIZED_KEY], loansExcluded: ["mortgage"], amounts: {} });
    // Nothing is left but the fixed part, which here is zero.
    expect(adjustedBuffer({ ...buffer, spendingMinor: 330_000 }, rows, all).state).toBe("unavailable");
  });

  it("tidies away entries that say nothing, and entries for what no longer exists", () => {
    const tidy = tidyAdjustments(rows, buffer.loans, adjust({ excluded: ["fun", "gone"], amounts: { food: 80_000, rent: 190_000, fun: 1, gone: 5 }, loansExcluded: ["old"], loanAmounts: { mortgage: 100_000 } }));
    expect(tidy).toEqual({ excluded: ["fun"], amounts: { rent: 190_000 }, loansExcluded: [], loanAmounts: {} });
    expect(isUnadjusted(tidyAdjustments(rows, buffer.loans, NO_ADJUSTMENTS))).toBe(true);
  });

  it("reads stored adjustments only in the expected shape", () => {
    const ok = { excluded: ["a", "a"], amounts: { b: 5 }, loansExcluded: [], loanAmounts: {} };
    expect(parseAdjustments(ok)).toEqual({ excluded: ["a"], amounts: { b: 5 }, loansExcluded: [], loanAmounts: {} });
    expect(parseAdjustments({ ...ok, amounts: { b: -1 } })).toBeNull();
    expect(parseAdjustments({ ...ok, amounts: { b: 1.5 } })).toBeNull();
    expect(parseAdjustments({ ...ok, excluded: [1] })).toBeNull();
    expect(parseAdjustments(null)).toBeNull();
    expect(parseScenarioResult({ months: 2, cashMinor: 1, monthlyNeedMinor: 1, actualMonths: 3, at: "2026-11-04T00:00:00Z" })).not.toBeNull();
    expect(parseScenarioResult({ months: "2" })).toBeNull();
  });

  it("takes the middle value of a list, the mean of the two in the middle for an even one", () => {
    expect(median([])).toBe(0);
    expect(median([5])).toBe(5);
    expect(median([100, 100, 1_000, 100, 100])).toBe(100);
    expect(median([10, 20, 30, 41])).toBe(25);
  });

  it("reads buffer settings only in the expected shape", () => {
    expect(parseBufferSettings({ goalMonths: 6, averageMonths: 3, method: "median" })).toEqual({ goalMonths: 6, averageMonths: 3, method: "median" });
    expect(parseBufferSettings({ goalMonths: null, averageMonths: 12, method: "average" })).toEqual(DEFAULT_BUFFER_SETTINGS);
    const ok = { goalMonths: null, averageMonths: 12, method: "average" };
    for (const bad of [{ goalMonths: 0 }, { goalMonths: 121 }, { goalMonths: 1.5 }, { averageMonths: 5 }, { method: "mode" }]) {
      expect(parseBufferSettings({ ...ok, ...bad })).toBeNull();
    }
    expect(parseBufferSettings(null)).toBeNull();
  });
});
