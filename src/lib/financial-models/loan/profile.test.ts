import { AU_PROFILE } from "./__fixtures__/profiles";
import { validateProfile, type CalculationProfile, type ProfileAxis } from "./profile";


const axesOf = (p: CalculationProfile) => {
  const r = validateProfile(p);
  return r.ok ? [] : r.conflicts.map((c) => c.axes);
};

describe("profile consistency", () => {
  it("accepts a consistent profile", () => {
    expect(validateProfile(AU_PROFILE)).toEqual({ ok: true });
  });

  it("keeps axes independent: day count and rate quote change nothing else", () => {
    for (const dayCount of ["actual-actual-calendar", "actual-360"] as const) {
      for (const rateQuote of ["nominal-compounded-monthly", "nominal-compounded-semiannual", "annual-effective"] as const) {
        expect(validateProfile({ ...AU_PROFILE, dayCount, rateQuote })).toEqual({ ok: true });
      }
    }
  });

  it.each<[string, Partial<CalculationProfile>, ProfileAxis[]]>([
    ["pro-rata derivation with monthly repayments", { repaymentFrequency: "monthly" }, ["repaymentDerivation", "repaymentFrequency"]],
    ["split derivation with quarterly repayments", { repaymentDerivation: "split-monthly", repaymentFrequency: "quarterly" }, ["repaymentDerivation", "repaymentFrequency"]],
    ["annuity with custom dates", { repaymentDerivation: "annuity-at-payment-frequency", repaymentFrequency: "custom-dated" }, ["repaymentDerivation", "repaymentFrequency"]],
    ["constant principal with an annuity payment", { amortization: "constant-principal", repaymentDerivation: "annuity-at-payment-frequency" }, ["amortization", "repaymentDerivation"]],
    ["daily simple accrual capitalized daily", { capitalization: "daily" }, ["accrual", "capitalization"]],
    ["daily compounding capitalized at charge", { accrual: "daily-compounded" }, ["accrual", "capitalization"]],
    ["per-period accrual capitalized daily", { accrual: "per-period", capitalization: "daily" }, ["accrual", "capitalization"]],
    ["monthly allocation charged quarterly", { dayCount: "monthly-30-360-actual-day-allocation", chargeFrequency: "quarterly" }, ["dayCount", "chargeFrequency"]],
    ["30/360 accrued daily", { dayCount: "30u-360" }, ["dayCount", "accrual"]],
    ["a charge day with charge-at-repayment", { chargeFrequency: "at-repayment" }, ["chargeFrequency", "chargeDay"]],
    ["a charge day of 32", { chargeDay: 32 }, ["chargeDay"]],
  ])("refuses %s, naming the axes", (_label, change, axes) => {
    expect(axesOf({ ...AU_PROFILE, ...change })).toContainEqual(axes);
  });

  it("refuses a fixed intermediate scale beyond the working scale", () => {
    const p = { ...AU_PROFILE, rounding: { ...AU_PROFILE.rounding, intermediateScale: { mode: "fixed" as const, places: 31 } } };
    expect(axesOf(p)).toEqual([["rounding.intermediateScale"]]);
  });

  it("reports every conflict, not just the first", () => {
    const r = validateProfile({ ...AU_PROFILE, repaymentFrequency: "monthly", capitalization: "daily" });
    expect(r.ok ? 0 : r.conflicts.length).toBe(2);
  });
});
