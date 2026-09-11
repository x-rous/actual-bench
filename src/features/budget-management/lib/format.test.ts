import {
  formatGridMinor,
  formatMinor,
  formatCurrency,
  formatSigned,
  formatDelta,
  formatSummary,
  minorToDecimalString,
  decimalStringToMinor,
} from "./format";

describe("formatMinor", () => {
  it("formats positive minor units with two decimals + locale grouping", () => {
    expect(formatMinor(15000)).toBe("150.00");
    expect(formatMinor(123456789)).toBe("1,234,567.89");
  });

  it("preserves a leading minus for negatives", () => {
    expect(formatMinor(-1234)).toBe("-12.34");
  });

  it("formats zero", () => {
    expect(formatMinor(0)).toBe("0.00");
  });
});

describe("formatCurrency", () => {
  it("prepends a dollar sign", () => {
    expect(formatCurrency(15000)).toBe("$150.00");
  });

  it("places the dollar sign before the negative sign", () => {
    expect(formatCurrency(-1234)).toBe("$-12.34");
  });
});

describe("formatSigned", () => {
  it("uses a typographic minus for negatives", () => {
    expect(formatSigned(-1234)).toBe("−12.34");
  });

  it("has no sign prefix for positives", () => {
    expect(formatSigned(15000)).toBe("150.00");
  });

  it("has no sign prefix for zero", () => {
    expect(formatSigned(0)).toBe("0.00");
  });
});

describe("formatDelta", () => {
  it("prefixes positive values with +", () => {
    expect(formatDelta(15000)).toBe("+150.00");
  });

  it("prefixes negative values with the typographic minus", () => {
    expect(formatDelta(-1234)).toBe("−12.34");
  });

  it("has no sign for zero", () => {
    expect(formatDelta(0)).toBe("0.00");
  });
});

describe("formatSummary", () => {
  it("rounds to whole dollars and groups", () => {
    expect(formatSummary(150049)).toBe("1,500");
    expect(formatSummary(150050)).toBe("1,501");
    expect(formatSummary(0)).toBe("0");
  });

  it("handles negatives", () => {
    expect(formatSummary(-12345)).toBe("-123");
  });
});

describe("minorToDecimalString / decimalStringToMinor", () => {
  it("round-trips integer values", () => {
    expect(minorToDecimalString(15000)).toBe("150.00");
    expect(decimalStringToMinor("150.00")).toBe(15000);
  });

  it("returns no locale grouping (CSV-safe)", () => {
    expect(minorToDecimalString(123456789)).toBe("1234567.89");
  });

  it("strips commas from input", () => {
    expect(decimalStringToMinor("1,234.50")).toBe(123450);
  });

  it("returns NaN on garbage", () => {
    expect(Number.isNaN(decimalStringToMinor("garbage"))).toBe(true);
    expect(Number.isNaN(decimalStringToMinor(""))).toBe(true);
  });

  it("accepts a leading sign", () => {
    expect(decimalStringToMinor("-12.34")).toBe(-1234);
    expect(decimalStringToMinor("+12.34")).toBe(1234);
  });
});

describe("formatGridMinor", () => {
  it("prints a dash for zero, so a column of nothing reads as nothing", () => {
    expect(formatGridMinor(0)).toBe("–");
  });

  it("keeps cents by default", () => {
    expect(formatGridMinor(332_908)).toBe("3,329.08");
  });

  it("drops cents when asked, rounding rather than truncating", () => {
    expect(formatGridMinor(332_908, { showDecimals: false })).toBe("3,329");
    expect(formatGridMinor(332_958, { showDecimals: false })).toBe("3,330");
  });

  it("dashes zero whether or not cents are shown", () => {
    expect(formatGridMinor(0, { showDecimals: false })).toBe("–");
  });

  it("keeps negatives intact", () => {
    expect(formatGridMinor(-1_234)).toBe("-12.34");
    expect(formatGridMinor(-1_234, { showDecimals: false })).toBe("-12");
  });
});

describe("formatGridMinor near zero", () => {
  it("never renders a signed zero", () => {
    // One cent with decimals hidden rounds to zero; Intl would print "-0".
    expect(formatGridMinor(-1, { showDecimals: false })).toBe("0");
    expect(formatGridMinor(-49, { showDecimals: false })).toBe("0");
  });

  it("still shows a real rounded amount, sign and all", () => {
    expect(formatGridMinor(-51, { showDecimals: false })).toBe("-1");
  });

  it("keeps the dash for an actual zero", () => {
    expect(formatGridMinor(0, { showDecimals: false })).toBe("–");
  });
});
