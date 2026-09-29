import { AU_PROFILE } from "./__fixtures__/profiles";
import { checkProfileSupport, validateProfile, type CalculationProfile, type ProfileAxis } from "./profile";


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
    ["a charge day with charge-at-repayment", { chargeFrequency: "at-repayment" }, ["chargeFrequency", "chargeDay"]],
    ["a charge day of 32", { chargeDay: 32 }, ["chargeDay"]],
  ])("refuses %s, naming the axes", (_label, change, axes) => {
    expect(axesOf({ ...AU_PROFILE, ...change })).toContainEqual(axes);
  });

  it.each<[string, Partial<CalculationProfile>]>([
    ["monthly allocation charged quarterly (well-defined: three twelfths)", { dayCount: "monthly-30-360-actual-day-allocation", chargeFrequency: "quarterly" }],
    ["Actual/360 with fortnightly repayments", { dayCount: "actual-360" }],
    ["Actual/360 with semi-annual quoting", { dayCount: "actual-360", rateQuote: "nominal-compounded-semiannual" }],
    ["a split derivation paid semi-monthly", { repaymentDerivation: "split-monthly", repaymentFrequency: "semi-monthly" }],
  ])("does not call %s invalid", (_label, change) => {
    expect(validateProfile({ ...AU_PROFILE, ...change })).toEqual({ ok: true });
  });
  it("reports well-defined but unimplemented combinations as unsupported, not invalid", () => {
    const unsupported = (change: Partial<CalculationProfile>) => {
      const r = checkProfileSupport({ ...AU_PROFILE, ...change });
      return r.ok ? [] : r.conflicts.map((c) => c.axes);
    };
    expect(unsupported({ repaymentDerivation: "split-monthly", repaymentFrequency: "semi-monthly" })).toEqual([["repaymentDerivation", "repaymentFrequency"]]);
    expect(unsupported({ rounding: { ...AU_PROFILE.rounding, intermediateScale: { mode: "fixed", places: 31 } } })).toEqual([["rounding.intermediateScale"]]);
    expect(checkProfileSupport(AU_PROFILE)).toEqual({ ok: true });
  });

  it("reports every conflict, not just the first", () => {
    const r = validateProfile({ ...AU_PROFILE, repaymentFrequency: "monthly", capitalization: "daily" });
    expect(r.ok ? 0 : r.conflicts.length).toBe(2);
  });
});
