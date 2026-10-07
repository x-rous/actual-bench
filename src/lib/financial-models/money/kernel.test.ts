import {
  add,
  cmp,
  dec,
  decInt,
  div,
  fromMinor,
  MONEY_KERNEL_VERSION,
  mul,
  nthRoot,
  powInt,
  rescale,
  sub,
  toDecString,
  toMinor,
  toPlainString,
  WORKING_SCALE,
  type Dec,
} from "./kernel";

/*
 * Expected values here are written out by hand or, for irrational roots and
 * long powers, taken from Python's `decimal` module at 80 significant digits
 * (floor-quantized for roots). None is produced by this kernel.
 */

const s = (d: Dec) => toDecString(d);

describe("money kernel identity", () => {
  it("declares its version and working scale", () => {
    expect(MONEY_KERNEL_VERSION).toBe("money-kernel@1");
    expect(WORKING_SCALE).toBe(30);
  });
});

describe("dec()", () => {
  it("parses decimal strings exactly, keeping the written scale", () => {
    expect(dec("0.0449")).toEqual({ int: BigInt(449), scale: 4 });
    expect(dec("-12.5")).toEqual({ int: BigInt(-125), scale: 1 });
    expect(dec("100")).toEqual({ int: BigInt(100), scale: 0 });
    expect(dec(" 7.00 ")).toEqual({ int: BigInt(700), scale: 2 });
  });

  it.each(["", "1.", ".5", "1e5", "0x10", "--1", "1,000", "NaN"])("rejects %j", (bad) => {
    expect(() => dec(bad)).toThrow(RangeError);
  });

  it("refuses a JavaScript number", () => {
    expect(() => dec(0.1 as unknown as string)).toThrow(TypeError);
  });

  it("decInt accepts safe integers only", () => {
    expect(decInt(42)).toEqual({ int: BigInt(42), scale: 0 });
    expect(() => decInt(1.5)).toThrow(RangeError);
    expect(() => decInt(Number.MAX_SAFE_INTEGER + 1)).toThrow(RangeError);
  });
});

describe("add / sub", () => {
  it("is exact across different scales", () => {
    expect(s(add(dec("0.1"), dec("0.2")))).toBe("0.3");
    expect(s(add(dec("1.005"), dec("2")))).toBe("3.005");
    expect(s(sub(dec("1"), dec("0.0001")))).toBe("0.9999");
  });

  it("preserves signs", () => {
    expect(s(add(dec("-1.25"), dec("0.75")))).toBe("-0.50");
    expect(s(sub(dec("-1.25"), dec("-1.25")))).toBe("0.00");
  });

  it("stays exact far beyond the safe-integer range", () => {
    const big = dec("123456789012345678901234567890.123456789");
    expect(s(add(big, big))).toBe("246913578024691357802469135780.246913578");
  });
});

describe("mul", () => {
  it("is exact by default", () => {
    expect(s(mul(dec("1.1"), dec("1.1")))).toBe("1.21");
    expect(s(mul(dec("-0.05"), dec("400000")))).toBe("-20000.00");
  });

  it("rounds only when given a scale and a mode together", () => {
    expect(s(mul(dec("1.005"), dec("1"), 2, "half-up"))).toBe("1.01");
    expect(s(mul(dec("1.005"), dec("1"), 2, "half-even"))).toBe("1.00");
    expect(() => mul(dec("1"), dec("1"), 2)).toThrow(RangeError);
    expect(() => mul(dec("1"), dec("1"), undefined, "down")).toThrow(RangeError);
  });
});

describe("div", () => {
  it("rounds once at the requested scale", () => {
    expect(s(div(dec("1"), dec("3"), 5, "half-even"))).toBe("0.33333");
    expect(s(div(dec("2"), dec("3"), 5, "half-even"))).toBe("0.66667");
    expect(s(div(dec("2"), dec("3"), 5, "down"))).toBe("0.66666");
    expect(s(div(dec("-2"), dec("3"), 5, "half-up"))).toBe("-0.66667");
  });

  it("handles divisors with more decimals than the result", () => {
    expect(s(div(dec("100"), dec("0.001"), 0, "down"))).toBe("100000");
    expect(s(div(dec("0.000001"), dec("0.5"), 3, "half-up"))).toBe("0.000");
  });

  it("gives exactly 1/365 of a year's interest to 30 places", () => {
    // 600000 × 0.045 / 365 = 73.972602739726027397260273972602739...
    const daily = div(mul(dec("600000"), dec("0.045")), decInt(365), WORKING_SCALE, "half-even");
    expect(s(daily)).toBe("73.972602739726027397260273972603");
  });

  it("refuses division by zero", () => {
    expect(() => div(dec("1"), dec("0.00"), 2, "down")).toThrow(RangeError);
  });
});

describe("cmp", () => {
  it("compares values, not representations", () => {
    expect(cmp(dec("1.0"), dec("1"))).toBe(0);
    expect(cmp(dec("0.1"), dec("0.09999"))).toBe(1);
    expect(cmp(dec("-0.1"), dec("0"))).toBe(-1);
  });
});

describe("powInt", () => {
  it("is exact when the scale allows it", () => {
    expect(s(powInt(dec("1.03"), 2, 4))).toBe("1.0609");
    expect(s(powInt(dec("1.1"), 3, 3))).toBe("1.331");
    expect(s(powInt(dec("5"), 0, 0))).toBe("1");
  });

  it("rounds the exact power once", () => {
    expect(s(powInt(dec("1.005"), 12, 10))).toBe("1.0616778119");
    expect(s(powInt(dec("1.005"), -12, 10))).toBe("0.9419053397");
    expect(s(powInt(dec("2"), -2, 2))).toBe("0.25");
  });

  it("gives identical digits on every run", () => {
    const runs = Array.from({ length: 5 }, () => s(powInt(dec("1.00375"), 360, WORKING_SCALE)));
    expect(new Set(runs).size).toBe(1);
  });
});

describe("nthRoot", () => {
  it("returns exact roots exactly", () => {
    expect(s(nthRoot(dec("27"), 3, 0))).toBe("3");
    expect(s(nthRoot(dec("1.0609"), 2, 4))).toBe("1.0300");
    expect(s(nthRoot(dec("0"), 5, 3))).toBe("0.000");
  });

  it("truncates irrational roots at the requested scale", () => {
    expect(s(nthRoot(dec("2"), 2, 30))).toBe("1.414213562373095048801688724209");
    expect(s(nthRoot(dec("10"), 3, 20))).toBe("2.15443469003188372175");
    // The Canadian semi-annual factor: 1.03^(1/6).
    expect(s(nthRoot(dec("1.03"), 6, 30))).toBe("1.004938622031196978410834166088");
  });

  it("brackets the true root: x^n <= a < (x + ulp)^n", () => {
    for (const [a, n] of [["1.0609", 13], ["7.5", 7], ["0.000123", 4], ["123456.789", 26]] as const) {
      const x = nthRoot(dec(a), n, 25);
      const next = add(x, { int: BigInt(1), scale: 25 });
      expect(cmp(powInt(x, n, 200, "down"), dec(a))).toBeLessThanOrEqual(0);
      expect(cmp(powInt(next, n, 200, "down"), dec(a))).toBe(1);
    }
  });

  it("gives identical digits on every run", () => {
    const runs = Array.from({ length: 5 }, () => s(nthRoot(dec("1.0609"), 26, WORKING_SCALE)));
    expect(new Set(runs).size).toBe(1);
  });

  it("refuses negative radicands and bad degrees", () => {
    expect(() => nthRoot(dec("-8"), 3, 2)).toThrow(RangeError);
    expect(() => nthRoot(dec("8"), 0, 2)).toThrow(RangeError);
    expect(() => nthRoot(dec("8"), 1.5, 2)).toThrow(RangeError);
  });
});

describe("minor units", () => {
  it("round-trips integers exactly", () => {
    for (const minor of [0, 1, -1, 123456, -987654321, Number.MAX_SAFE_INTEGER, -Number.MAX_SAFE_INTEGER]) {
      expect(toMinor(fromMinor(minor, 2), 2, "down")).toBe(minor);
      expect(toMinor(fromMinor(minor, 0), 0, "half-even")).toBe(minor);
    }
  });

  it("converts to minor units with the configured mode", () => {
    expect(toMinor(dec("1.005"), 2, "half-even")).toBe(100);
    expect(toMinor(dec("1.005"), 2, "half-up")).toBe(101);
    expect(toMinor(dec("-1.005"), 2, "half-up")).toBe(-101);
    expect(toMinor(dec("73.972602739726"), 2, "half-up")).toBe(7397);
    expect(toMinor(dec("1234.5"), 0, "half-even")).toBe(1234);
  });

  it("refuses unsafe or fractional inputs and out-of-range results", () => {
    expect(() => fromMinor(1.5, 2)).toThrow(RangeError);
    expect(() => fromMinor(Number.MAX_SAFE_INTEGER + 2, 2)).toThrow(RangeError);
    expect(() => toMinor(dec("90071992547409.92"), 2, "down")).toThrow(RangeError);
    expect(() => toMinor(dec("-90071992547409.92"), 2, "down")).toThrow(RangeError);
  });
});

describe("string forms", () => {
  it("prints at scale or trimmed", () => {
    expect(toDecString(dec("-0.0100"))).toBe("-0.0100");
    expect(toPlainString(dec("-0.0100"))).toBe("-0.01");
    expect(toPlainString(dec("5.000"))).toBe("5");
    expect(toPlainString(dec("-0.000"))).toBe("0");
    expect(toDecString(rescale(dec("1.5"), 4))).toBe("1.5000");
    expect(() => rescale(dec("1.55"), 1)).toThrow(RangeError);
  });
});
