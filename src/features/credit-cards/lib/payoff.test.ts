import { payoffPlan, type PayoffDebt } from "./payoff";

const card = { minimumPercentBps: 500, minimumFloorMinor: 2_500 };
const debts: PayoffDebt[] = [
  { id: "a", name: "Low rate, small", balanceMinor: 100_000, aprBps: 1_200, card },
  { id: "b", name: "High rate, large", balanceMinor: 400_000, aprBps: 2_999, card },
];

it("pays the highest APR first with avalanche and the smallest balance first with snowball, avalanche costing less", () => {
  const avalanche = payoffPlan(debts, 50_000, "avalanche");
  const snowball = payoffPlan(debts, 50_000, "snowball");
  if (!avalanche.feasible || !snowball.feasible) throw new Error("expected a plan");
  expect(avalanche.order.map((entry) => entry.id)).toEqual(["b", "a"]);
  expect(snowball.order.map((entry) => entry.id)).toEqual(["a", "b"]);
  expect(avalanche.interestMinor).toBeLessThan(snowball.interestMinor);
  expect(avalanche.months).toBeLessThanOrEqual(snowball.months);
});

it("refuses a monthly amount below the minimums and one that never pays down", () => {
  expect(payoffPlan(debts, 10_000, "avalanche")).toMatchObject({ feasible: false, reason: "below-minimums" });
  const noMinimum = [{ ...debts[1], card: { minimumPercentBps: null, minimumFloorMinor: null } }];
  expect(payoffPlan(noMinimum, 5_000, "avalanche")).toMatchObject({ feasible: false, reason: "never" });
  // Repaid, but only after 601 months: past the horizon, not "never".
  const slow = [{ id: "c", name: "Interest-free", balanceMinor: 60_001, aprBps: 0, card: { minimumPercentBps: null, minimumFloorMinor: null } }];
  expect(payoffPlan(slow, 100, "avalanche")).toMatchObject({ feasible: false, reason: "too-long" });
});
