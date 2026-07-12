import { convertMinorUnits, invertRate, isValidRate } from "./fxMath";
import { FxError } from "./errors";

describe("convertMinorUnits", () => {
  it("converts AED→AUD minor units, rounding only the final amount", () => {
    // 1,000.00 AED (100000 minor) × 0.41025 = 41025.0 → 41025 minor.
    expect(convertMinorUnits(100000, "0.41025")).toBe(41025);
    // Rounds half-up on the final amount only.
    expect(convertMinorUnits(12345, "0.4162")).toBe(Math.round(12345 * 0.4162));
  });

  it("preserves the source sign", () => {
    expect(convertMinorUnits(-100000, "0.41025")).toBe(-41025);
  });

  it("stays exact for large amounts a float would lose", () => {
    // 999,999,999,999 minor × 1.000000000001 — BigInt keeps this exact.
    expect(convertMinorUnits(999999999999, "1.000000000001")).toBe(1000000000000);
  });

  it("rejects non-integer minor units and malformed rates", () => {
    expect(() => convertMinorUnits(1.5, "1")).toThrow(FxError);
    expect(() => convertMinorUnits(100, "abc")).toThrow(FxError);
  });
});

describe("invertRate", () => {
  it("inverts to a trimmed high-precision decimal", () => {
    expect(invertRate("0.5")).toBe("2");
    expect(invertRate("2")).toBe("0.5");
    // 1/0.4162 ≈ 2.402690...
    expect(invertRate("0.4162").startsWith("2.40269")).toBe(true);
  });

  it("rejects a zero rate", () => {
    expect(() => invertRate("0")).toThrow(FxError);
  });
});

describe("isValidRate", () => {
  it("accepts positive decimals, rejects zero/negative/garbage", () => {
    expect(isValidRate("0.4162")).toBe(true);
    expect(isValidRate("0")).toBe(false);
    expect(isValidRate("-1")).toBe(false);
    expect(isValidRate("1,5")).toBe(false);
  });
});
