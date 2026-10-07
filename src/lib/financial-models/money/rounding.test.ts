import { dec, toDecString } from "./kernel";
import { divRoundInt, round, ROUNDING_MODES, type RoundingMode } from "./rounding";

/*
 * Every mode × sign × position relative to the half boundary, written out by
 * hand. Rows are [input, half-up, half-even, up, down] rounded to 0 places.
 */
const TABLE: [string, string, string, string, string][] = [
  ["2.5", "3", "2", "3", "2"],
  ["3.5", "4", "4", "4", "3"],
  ["2.4999", "2", "2", "3", "2"],
  ["2.5001", "3", "3", "3", "2"],
  ["2.0", "2", "2", "2", "2"],
  ["0.5", "1", "0", "1", "0"],
  ["0.0", "0", "0", "0", "0"],
  ["-2.5", "-3", "-2", "-3", "-2"],
  ["-3.5", "-4", "-4", "-4", "-3"],
  ["-2.4999", "-2", "-2", "-3", "-2"],
  ["-2.5001", "-3", "-3", "-3", "-2"],
  ["-0.5", "-1", "0", "-1", "0"],
];

describe("round() mode table", () => {
  const modes: RoundingMode[] = ["half-up", "half-even", "up", "down"];

  it("covers every mode", () => {
    expect([...ROUNDING_MODES].sort()).toEqual([...modes].sort());
  });

  it.each(TABLE)("%s → half-up %s, half-even %s, up %s, down %s", (input, ...expected) => {
    modes.forEach((mode, i) => {
      expect(toDecString(round(dec(input), 0, mode))).toBe(expected[i]);
    });
  });

  it("is symmetric about zero in every mode", () => {
    for (const [input] of TABLE) {
      for (const mode of modes) {
        const positive = round(dec(input.replace(/^-/, "")), 0, mode).int;
        const negative = round(dec(input.startsWith("-") ? input : `-${input}`), 0, mode).int;
        expect(negative).toBe(-positive);
      }
    }
  });
});

describe("round() at currency precision", () => {
  it("rounds half-cent boundaries by mode", () => {
    expect(toDecString(round(dec("10.125"), 2, "half-up"))).toBe("10.13");
    expect(toDecString(round(dec("10.125"), 2, "half-even"))).toBe("10.12");
    expect(toDecString(round(dec("10.135"), 2, "half-even"))).toBe("10.14");
    expect(toDecString(round(dec("-10.125"), 2, "half-even"))).toBe("-10.12");
  });

  it("rounds a zero-decimal currency (unit 1) to whole units", () => {
    expect(toDecString(round(dec("1234.5"), 0, "half-up"))).toBe("1235");
    expect(toDecString(round(dec("1234.5"), 0, "half-even"))).toBe("1234");
    expect(toDecString(round(dec("1234.01"), 0, "up"))).toBe("1235");
    expect(toDecString(round(dec("1234.99"), 0, "down"))).toBe("1234");
  });

  it("never rounds when no digits are dropped", () => {
    expect(toDecString(round(dec("1.5"), 3, "down"))).toBe("1.500");
    expect(toDecString(round(dec("1.25"), 2, "up"))).toBe("1.25");
  });

  it("refuses a bad scale", () => {
    expect(() => round(dec("1.5"), -1, "down")).toThrow(RangeError);
    expect(() => round(dec("1.5"), 0.5, "down")).toThrow(RangeError);
  });
});

describe("divRoundInt", () => {
  it("handles signs of either operand", () => {
    expect(divRoundInt(BigInt(7), BigInt(-2), "half-up")).toBe(BigInt(-4));
    expect(divRoundInt(BigInt(-7), BigInt(-2), "half-even")).toBe(BigInt(4));
    expect(divRoundInt(BigInt(-7), BigInt(2), "down")).toBe(BigInt(-3));
  });

  it("refuses an unknown mode and a zero divisor", () => {
    expect(() => divRoundInt(BigInt(1), BigInt(3), "ceiling" as RoundingMode)).toThrow(RangeError);
    expect(() => divRoundInt(BigInt(1), BigInt(0), "down")).toThrow(RangeError);
  });
});
