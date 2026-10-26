import { emptyRowFilters, matchesAmount, matchesIds, optionsFrom, rowFiltersActive } from "./rowFilters";

it("compares amounts without the sign, like the picker", () => {
  expect(matchesAmount(-5000, { mode: "equals", a: 5000 })).toBe(true);
  expect(matchesAmount(4999, { mode: "equals", a: 5000 })).toBe(false);
  expect(matchesAmount(-700, { mode: "between", a: 1000, b: 500 })).toBe(true);
  expect(matchesAmount(-400, { mode: "between", a: 500, b: 1000 })).toBe(false);
  expect(matchesAmount(-6000, { mode: "more", a: 5000 })).toBe(true);
  expect(matchesAmount(-6000, { mode: "less", a: 5000 })).toBe(false);
  expect(matchesAmount(123, { mode: "any" })).toBe(true);
});
it("keeps everything for an empty choice, and inverts for is not", () => {
  expect(matchesIds("a", { ids: [], not: false })).toBe(true);
  expect(matchesIds("a", { ids: ["a"], not: false })).toBe(true);
  expect(matchesIds(null, { ids: ["a"], not: false })).toBe(false);
  expect(matchesIds("a", { ids: ["a"], not: true })).toBe(false);
  expect(matchesIds(null, { ids: ["a"], not: true })).toBe(true);
});
it("lists distinct choices by name and knows when a filter is set", () => {
  expect(optionsFrom([["x", "Zed"], ["y", "Amy"], ["x", "Zed"]]).map((o) => o.name)).toEqual(["Amy", "Zed"]);
  const filters = emptyRowFilters(); expect(rowFiltersActive(filters)).toBe(false);
  expect(rowFiltersActive({ ...filters, types: { ids: ["revaluation"], not: false } })).toBe(true);
});
