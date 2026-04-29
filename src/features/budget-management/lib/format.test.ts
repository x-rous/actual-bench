import {
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
