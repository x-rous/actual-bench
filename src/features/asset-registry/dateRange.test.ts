import { ALL_TIME, effectiveRange, inRange } from "./dateRange";

const today = "2026-10-26";
it("means the whole history by default", () => {
  expect(effectiveRange(ALL_TIME, today, "2020-11-26")).toMatchObject({ from: "2020-11-26", to: today });
  expect(inRange(ALL_TIME, today, "1999-01-01")).toBe(true);
});
it("follows the picker's presets and never reaches before the history or into the future", () => {
  expect(effectiveRange({ preset: "this-year" }, today, "2020-11-26")).toMatchObject({ from: "2026-01-01", to: today });
  expect(effectiveRange({ preset: "last-year" }, today, "2020-11-26")).toMatchObject({ from: "2025-01-01", to: "2025-12-31" });
  expect(effectiveRange({ preset: "this-year" }, today, "2026-03-01")).toMatchObject({ from: "2026-03-01" });
  expect(effectiveRange({ preset: "custom", from: "2019-01-01", to: "2030-01-01" }, today, "2020-11-26")).toMatchObject({ from: "2020-11-26", to: today });
  expect(effectiveRange({ preset: "last-year" }, today, "2020-11-26").years).toBeCloseTo(1, 1);
});
it("filters rows by the same range", () => {
  expect(inRange({ preset: "last-year" }, today, "2025-06-30")).toBe(true);
  expect(inRange({ preset: "last-year" }, today, "2026-01-01")).toBe(false);
  expect(inRange({ preset: "custom", from: "2026-02-01" }, today, "2026-01-31")).toBe(false);
});
