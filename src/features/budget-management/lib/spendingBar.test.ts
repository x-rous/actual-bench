import { computeSpendingBar, NEAR_THRESHOLD } from "./spendingBar";

describe("computeSpendingBar", () => {
  it("returns no bar when nothing is budgeted or spent", () => {
    expect(computeSpendingBar(0, 0)).toEqual({ tier: "none", fill: 0, overflow: 0 });
  });

  it("treats spending against a zero budget as unbudgeted", () => {
    expect(computeSpendingBar(0, 5000)).toEqual({ tier: "unbudgeted", fill: 1, overflow: 0 });
    // Negative budget is also 'no budget'.
    expect(computeSpendingBar(-100, 5000).tier).toBe("unbudgeted");
  });

  it("shows an empty under-bar when budgeted but nothing spent", () => {
    expect(computeSpendingBar(60000, 0)).toEqual({ tier: "under", fill: 0, overflow: 0 });
  });

  it("fills proportionally and stays under below the near threshold", () => {
    const bar = computeSpendingBar(100_00, 50_00); // 50%
    expect(bar.tier).toBe("under");
    expect(bar.fill).toBeCloseTo(0.5);
    expect(bar.overflow).toBe(0);
  });

  it("flips to near within ~90–100%", () => {
    expect(computeSpendingBar(100_00, 95_00).tier).toBe("near");
    // Exactly at the threshold is 'near'.
    expect(computeSpendingBar(100_00, NEAR_THRESHOLD * 100_00).tier).toBe("near");
    // Exactly at budget is still 'near' (not over).
    expect(computeSpendingBar(100_00, 100_00).tier).toBe("near");
    expect(computeSpendingBar(100_00, 100_00).fill).toBe(1);
  });

  it("marks over budget with a clamped overflow segment", () => {
    const slight = computeSpendingBar(600_00, 640_00); // 106.7%
    expect(slight.tier).toBe("over");
    expect(slight.fill).toBe(1);
    expect(slight.overflow).toBeCloseTo(0.0667, 3);

    // A big overspend clamps overflow to 1 (never renders off the track).
    const big = computeSpendingBar(100_00, 500_00);
    expect(big.overflow).toBe(1);
  });

  it("ignores a net inflow (negative spent already normalised by caller → 0)", () => {
    expect(computeSpendingBar(100_00, 0).tier).toBe("under");
    // Defensive: a stray negative spent is treated as zero.
    expect(computeSpendingBar(100_00, -50_00)).toEqual({ tier: "under", fill: 0, overflow: 0 });
  });

  it("is robust to non-finite input", () => {
    expect(computeSpendingBar(NaN, NaN)).toEqual({ tier: "none", fill: 0, overflow: 0 });
  });
});
