import { loadFamily } from "./__fixtures__/harness";
import { dec, fromMinor, mul, decInt, toDecString, toMinor } from "../money/kernel";
import { periodicRate } from "./rates";
import { constantPrincipalInstallment, datedCashflowLevelPayment, deriveRepayment, levelPayment } from "./repayment";

/*
 * Expected payments are from Python's `decimal` (100 digits, half-up to
 * cents), the well-known US figure for $200,000 at 6% over 30 years, and the
 * York University j2 fixture. None comes from this module.
 */

const cents = { minorDigits: 2, mode: "half-up" as const };

describe("level payment", () => {
  it("matches a standard US mortgage: $200,000, 6%/12, 360 payments → $1,199.10", () => {
    expect(toMinor(levelPayment(dec("200000"), periodicRate("nominal-simple-periodic", dec("0.06"), 12), 360), 2, "half-up")).toBe(119910);
  });

  it("uses P ÷ n at a zero rate", () => {
    expect(toMinor(levelPayment(dec("120000"), dec("0"), 360), 2, "half-up")).toBe(33333);
    expect(toDecString(levelPayment(dec("1200"), dec("0"), 12, 2))).toBe("100.00");
  });

  it("reproduces the York University j2 fixture ($639.81)", () => {
    const [fixture] = loadFamily("canada-j2");
    const input = fixture.input as { annualRate: string; paymentsPerYear: number; principal: string; payments: number };
    const r = periodicRate("nominal-compounded-semiannual", dec(input.annualRate), input.paymentsPerYear);
    expect(String(toMinor(levelPayment(dec(input.principal), r, input.payments), 2, "half-up"))).toBe(fixture.expected[0].payment_minor);
  });

  it("refuses a negative rate and a bad payment count", () => {
    expect(() => levelPayment(dec("1000"), dec("-0.01"), 12)).toThrow(RangeError);
    expect(() => levelPayment(dec("1000"), dec("0.01"), 0)).toThrow(RangeError);
  });
});

describe("constant principal", () => {
  it("is the original principal over the principal periods", () => {
    expect(toDecString(constantPrincipalInstallment(dec("100000"), 240, 6))).toBe("416.666667");
    expect(toMinor(constantPrincipalInstallment(dec("100000"), 240), 2, "half-up")).toBe(41667);
  });
});

describe("repayment derivation (never conflated)", () => {
  // $500,000 at 6% simple monthly over 25 years: $3,221.51 a month.
  const monthly = fromMinor(
    deriveRepayment({ method: "annuity-at-payment-frequency", principal: dec("500000"), periodicRate: periodicRate("nominal-simple-periodic", dec("0.06"), 12), payments: 300 }, cents).minor,
    2
  );

  it("derives the monthly base", () => {
    expect(toDecString(monthly)).toBe("3221.51");
  });

  it.each([
    ["monthly-equivalent-pro-rata", "fortnightly", 148685], // × 12 ÷ 26
    ["split-monthly", "fortnightly", 161076], //                ÷ 2
    ["monthly-equivalent-pro-rata", "weekly", 74343], //         × 12 ÷ 52
    ["split-monthly", "weekly", 80538], //                       ÷ 4
  ] as const)("%s %s → %i", (method, frequency, minor) => {
    expect(deriveRepayment({ method, monthlyPayment: monthly, frequency }, cents).minor).toBe(minor);
  });

  it("gives different yearly totals for ×12÷26 and ÷2", () => {
    const proRata = deriveRepayment({ method: "monthly-equivalent-pro-rata", monthlyPayment: monthly, frequency: "fortnightly" }, cents);
    const split = deriveRepayment({ method: "split-monthly", monthlyPayment: monthly, frequency: "fortnightly" }, cents);
    const yearly = (minor: number) => toMinor(mul(fromMinor(minor, 2), decInt(26)), 2, "down");
    expect(yearly(proRata.minor)).toBe(3865810); //   ≈ 12 monthly payments
    expect(yearly(split.minor)).toBe(4187976); //     ≈ 13 monthly payments
    expect(yearly(split.minor) - yearly(proRata.minor)).toBeGreaterThan(300000);
  });

  it("differs from an annuity computed at the fortnightly rate", () => {
    const annuity = deriveRepayment(
      { method: "annuity-at-payment-frequency", principal: dec("500000"), periodicRate: periodicRate("nominal-simple-periodic", dec("0.06"), 26), payments: 650 },
      cents
    );
    expect(annuity.minor).toBe(148599);
    expect(annuity.minor).not.toBe(148685);
  });

  it("solves a constant payment over unequal dated accrual factors", () => {
    // B1 = 1,000 × 1.1 − P; B2 = B1 × 1.2 − P; B2 = 0 gives P = 600.
    expect(toDecString(datedCashflowLevelPayment(dec("1000"), [dec("0.1"), dec("0.2")]))).toBe("600.000000000000000000000000000000");
    expect(deriveRepayment({ method: "dated-cashflow-annuity", principal: dec("1000"), periodAccrualFractions: [dec("0.1"), dec("0.2")] }, cents)).toMatchObject({ method: "dated-cashflow-annuity", minor: 60000 });
  });

  it("takes contractual and lender-provided amounts as given, labelled by method", () => {
    expect(deriveRepayment({ method: "contractual-fixed", amount: dec("1500") }, cents)).toMatchObject({ method: "contractual-fixed", minor: 150000 });
    expect(deriveRepayment({ method: "lender-provided", amount: dec("1487.33") }, cents)).toMatchObject({ method: "lender-provided", minor: 148733 });
    expect(() => deriveRepayment({ method: "lender-provided", amount: dec("-1") }, cents)).toThrow(RangeError);
    expect(() => deriveRepayment({ method: "guess" } as never, cents)).toThrow(RangeError);
  });

  it("rounds by the configured payment rounding mode", () => {
    const input = { method: "monthly-equivalent-pro-rata" as const, monthlyPayment: dec("1000.00"), frequency: "fortnightly" as const };
    // 1000 × 12 ÷ 26 = 461.538…
    expect(deriveRepayment(input, { minorDigits: 2, mode: "down" }).minor).toBe(46153);
    expect(deriveRepayment(input, { minorDigits: 2, mode: "up" }).minor).toBe(46154);
    expect(deriveRepayment(input, { minorDigits: 0, mode: "half-even" }).minor).toBe(462);
  });
});
