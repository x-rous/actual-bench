import { loadFamily } from "./__fixtures__/harness";
import { dec, mul, round, toDecString, toPlainString } from "../money/kernel";
import { effectiveAnnualRate, periodicRate, rateOn, rateSegments, type RatePeriod } from "./rates";

/*
 * Periodic rates are checked against Python's `decimal` at 100 digits,
 * rounded half-even to 30 places; the j2 case also against the York
 * University fixture (loan/__fixtures__/canada-j2).
 */

const RATES: RatePeriod[] = [
  { accrualEffectiveFrom: "2024-01-01", annualRateDecimal: "0.0600" },
  { accrualEffectiveFrom: "2024-03-15", annualRateDecimal: "0.0625" },
  { accrualEffectiveFrom: "2024-07-01", annualRateDecimal: "0.0590", rateFloorDecimal: "0.0600" },
];

describe("effective-dated rate lookup", () => {
  it("returns the latest row effective on or before the date", () => {
    const at = (d: string) => {
      const r = rateOn(RATES, d);
      return r.ok ? toPlainString(r.rate) : r.code;
    };
    expect(at("2024-01-01")).toBe("0.06");
    expect(at("2024-03-14")).toBe("0.06");
    expect(at("2024-03-15")).toBe("0.0625");
    expect(at("2030-01-01")).toBe("0.06"); // 0.0590 held up by its 0.0600 floor
  });

  it("returns a blocking rate gap before the first row", () => {
    expect(rateOn(RATES, "2023-12-31")).toEqual({ ok: false, code: "rate-gap", date: "2023-12-31" });
    expect(rateOn([], "2024-01-01")).toEqual({ ok: false, code: "rate-gap", date: "2024-01-01" });
  });

  it("applies a cap", () => {
    const capped = rateOn([{ accrualEffectiveFrom: "2024-01-01", annualRateDecimal: "0.09", rateCapDecimal: "0.075" }], "2024-02-01");
    expect(capped.ok && toPlainString(capped.rate)).toBe("0.075");
  });

  it("splits a span at each change and blocks a span that starts in a gap", () => {
    const split = rateSegments(RATES, "2024-03-01", "2024-04-01");
    expect(split.ok && split.segments.map((s) => [s.from, s.to, toPlainString(s.rate)])).toEqual([
      ["2024-03-01", "2024-03-15", "0.06"],
      ["2024-03-15", "2024-04-01", "0.0625"],
    ]);
    expect(rateSegments(RATES, "2023-12-20", "2024-01-10")).toEqual({ ok: false, code: "rate-gap", date: "2023-12-20" });
    const unsorted = rateSegments([RATES[2], RATES[0], RATES[1]], "2024-01-01", "2024-01-02");
    expect(unsorted.ok && unsorted.segments).toHaveLength(1);
  });

  it("refuses two rows on one date and malformed rows", () => {
    expect(() => rateOn([RATES[0], { ...RATES[0], annualRateDecimal: "0.07" }], "2024-02-01")).toThrow(/Two rates/);
    expect(() => rateOn([{ accrualEffectiveFrom: "2024-02-30", annualRateDecimal: "0.06" }], "2024-03-01")).toThrow(RangeError);
    expect(() => rateOn([{ accrualEffectiveFrom: "2024-02-01", annualRateDecimal: "6%" }], "2024-03-01")).toThrow(RangeError);
  });
});

describe("quoted-rate conventions", () => {
  const r = dec("0.06");

  it("nominal simple periodic divides by the payment count", () => {
    expect(toDecString(periodicRate("nominal-simple-periodic", r, 12, 6))).toBe("0.005000");
    expect(toDecString(periodicRate("nominal-simple-periodic", r, 26, 10))).toBe("0.0023076923");
  });

  it("compounded quotes convert to the payment frequency", () => {
    expect(toDecString(periodicRate("nominal-compounded-monthly", r, 12))).toBe("0.005000000000000000000000000000");
    expect(toDecString(periodicRate("nominal-compounded-monthly", r, 26))).toBe("0.002304593739038188592481910884");
    expect(toDecString(periodicRate("nominal-compounded-semiannual", r, 12))).toBe("0.004938622031196978410834166088");
    expect(toDecString(periodicRate("nominal-compounded-semiannual", r, 52))).toBe("0.001137523498927151617683774913");
    expect(toDecString(periodicRate("annual-effective", r, 12))).toBe("0.004867550565343037541198945588");
  });

  it("j2 matches the York University reference to every printed digit", () => {
    const [fixture] = loadFamily("canada-j2");
    const input = fixture.input as { annualRate: string; paymentsPerYear: number };
    const monthly = periodicRate("nominal-compounded-semiannual", dec(input.annualRate), input.paymentsPerYear);
    expect(toDecString(round(mul(monthly, dec("100")), 6, "half-up"))).toBe(fixture.expected[0].periodic_rate_pct_6dp);
    expect(toPlainString(effectiveAnnualRate("nominal-compounded-semiannual", dec(input.annualRate)))).toBe("0.0609");
  });

  it("differs from dividing the quoted rate (the mistake FR-037 forbids)", () => {
    const j2 = periodicRate("nominal-compounded-semiannual", r, 12, 10);
    const naive = periodicRate("nominal-simple-periodic", r, 12, 10);
    expect(toDecString(j2)).not.toBe(toDecString(naive));
  });

  it("computes effective annual rates exactly", () => {
    expect(toPlainString(effectiveAnnualRate("nominal-compounded-monthly", r, 12))).toBe("0.061677811864");
    expect(toPlainString(effectiveAnnualRate("annual-effective", r))).toBe("0.06");
  });

  it("gives identical digits on every run and refuses bad frequencies", () => {
    const runs = Array.from({ length: 3 }, () => toDecString(periodicRate("nominal-compounded-monthly", r, 52)));
    expect(new Set(runs).size).toBe(1);
    expect(() => periodicRate("nominal-simple-periodic", r, 0)).toThrow(RangeError);
    expect(() => periodicRate("nominal-daily" as never, r, 12)).toThrow(RangeError);
  });
});
