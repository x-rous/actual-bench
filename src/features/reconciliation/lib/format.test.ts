import { amountRatio } from "./format";

describe("amountRatio", () => {
  it("reports the factor when a recorded amount is a bad conversion", () => {
    // Real case: SAR65 posted as -66.15, recorded as -24.38 by an automation
    // that applied the wrong currency factor. Seeing 0.375 recur across rows
    // points at the converter rather than at individual transactions.
    expect(amountRatio(-6615, -2438)).toBe("0.369");
  });

  it("reports a factor above one", () => {
    expect(amountRatio(-2036, -7504)).toBe("3.69");
  });

  it("says nothing when the amounts are close enough to be rounding", () => {
    expect(amountRatio(-6615, -6600)).toBeNull();
  });

  it("says nothing when the sign flips, where a quotient is meaningless", () => {
    expect(amountRatio(-6615, 2438)).toBeNull();
  });

  it("says nothing about a zero statement amount", () => {
    expect(amountRatio(0, -2438)).toBeNull();
  });
});
