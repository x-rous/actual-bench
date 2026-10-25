import { saleModel } from "./saleReview";

const base = { sourceLabel: "Buyer · 2026-10-01 · 90,000.00", adjustmentMinor: 0, date: "2026-10-01", feeLabels: [], basis: "gross" as const, netProceedsMinor: 9000000, gainMinor: 1000000 };
it("says the deposit stays untouched and what single noncash entry is added", () => {
  const m = saleModel({ ...base, representation: "external-receipt", adjustmentMinor: -8000000 });
  expect(m.actual[0]).toMatch(/Your deposit Buyer · 2026-10-01 · 90,000.00 stays exactly as it is/);
  expect(m.actual[1]).toMatch(/One new entry of -80,000.00 is added to the asset's own account on 2026-10-01.*noncash.*#disposal.*not a transaction in your bank/);
  expect(m.bench.at(-1)).toMatch(/90,000.00 received after costs and a gain of 10,000.00/);
});
it("explains a transfer sale, a write-off and selling costs", () => {
  expect(saleModel({ ...base, representation: "asset-transfer", sourceLabel: "(Transfer · 2026-10-01 · -90,000.00)" }).actual[1]).toMatch(/No new entry is needed/);
  expect(saleModel({ ...base, representation: "write-off", sourceLabel: null, adjustmentMinor: -500000, netProceedsMinor: 0, gainMinor: -500000 }).actual[0]).toMatch(/No money moves/);
  const withCosts = saleModel({ ...base, representation: "external-receipt", feeLabels: ["Agent · 2026-10-02 · -2,000.00"], netProceedsMinor: 8800000 });
  expect(withCosts.actual[2]).toMatch(/The expense Agent.*stays in your budget unchanged/);
  expect(withCosts.bench[0]).toMatch(/before costs, so the costs are subtracted/);
});
