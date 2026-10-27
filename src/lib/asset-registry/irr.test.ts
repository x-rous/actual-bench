import { xirr } from "./irr";

it("finds the annual return of one payment and its closing value", () => {
  expect(xirr([{ date: "2024-01-01", amountMinor: -100000 }, { date: "2025-01-01", amountMinor: 110000 }])).toBeCloseTo(10, 0);
});
it("weights instalments by when they were paid", () => {
  const spread = xirr([{ date: "2020-01-01", amountMinor: -50000 }, { date: "2022-01-01", amountMinor: -50000 }, { date: "2024-01-01", amountMinor: 150000 }])!;
  const upfront = xirr([{ date: "2020-01-01", amountMinor: -100000 }, { date: "2024-01-01", amountMinor: 150000 }])!;
  expect(spread).toBeGreaterThan(upfront); // the same total gains more per year when the money went in later
});
it("is unknown with no money in, none back, or a span too short to annualize", () => {
  expect(xirr([{ date: "2024-01-01", amountMinor: 100 }, { date: "2025-01-01", amountMinor: 100 }])).toBeNull();
  expect(xirr([{ date: "2024-01-01", amountMinor: -100 }, { date: "2024-02-01", amountMinor: 120 }])).toBeNull();
  expect(xirr([{ date: "2024-01-01", amountMinor: -100 }])).toBeNull();
});
