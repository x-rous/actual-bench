import { configBusinessDays, configLenderStatement, configProgressive, DEBT_CONFIG_FORMAT, debtConfigVersionFor, parseDebtConfig } from "./configSchema";
import { AU_PROFILE } from "./__fixtures__/profiles";

/** A per-period progressive principal loan, config v4 (feedback #399). */
function v4(over: Record<string, unknown> = {}, profile: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    format: DEBT_CONFIG_FORMAT,
    version: 4,
    terms: { openingDate: "2026-09-30", openingPrincipalMinor: 203_353_10, maturityDate: null, contractualTermMonths: 276, amortizationTermMonths: 276, contractualPaymentMinor: null, creditLimitMinor: null, firstPaymentDate: "2026-10-30", firstInterestChargeDate: null },
    profile: { ...structuredClone(AU_PROFILE), amortization: "progressive-principal", accrual: "per-period", chargeFrequency: "at-repayment", chargeDay: null, capitalization: "at-charge", repaymentFrequency: "monthly", repaymentDerivation: "annuity-at-payment-frequency", recast: "never", negativeAmortizationAllowed: false, ...profile },
    phases: [],
    components: [],
    paymentRecasts: [],
    revolving: null,
    businessDays: null,
    lenderStatement: null,
    progressive: { growthPerRepaymentDecimal: "0.0034592411" },
    ...over,
  };
}

describe("rd084.debt-config v4: progressive principal", () => {
  it("parses a progressive loan and reads its growth", () => {
    const parsed = parseDebtConfig(JSON.stringify(v4()));
    if (!parsed.ok) throw new Error(parsed.issues.join("; "));
    expect(configProgressive(parsed.config)).toEqual({ growthPerRepaymentDecimal: "0.0034592411" });
  });

  it("keeps the v3 business-day and lender-statement settings", () => {
    const parsed = parseDebtConfig(v4({
      profile: { ...(v4().profile as object), accrual: "daily-simple" },
      businessDays: { adjustment: "following", nonBusinessWeekdays: [6, 7], holidays: ["2026-12-25"] },
      lenderStatement: { interestAllocation: "accrued-to-due-date" },
    }));
    if (!parsed.ok) throw new Error(parsed.issues.join("; "));
    expect(configBusinessDays(parsed.config)).toMatchObject({ adjustment: "following", holidays: ["2026-12-25"] });
    expect(configLenderStatement(parsed.config)).toEqual({ interestAllocation: "accrued-to-due-date" });
    // The v3 rule still applies from v4 on: "none" is stored as null.
    expect(parseDebtConfig(v4({ businessDays: { adjustment: "none", nonBusinessWeekdays: [6, 7], holidays: [] } }))).toMatchObject({ ok: false, code: "invalid-config" });
  });

  it("refuses progressive principal in a v3 config as a newer identifier", () => {
    const v3 = v4({ version: 3 });
    delete v3.progressive;
    expect(parseDebtConfig(v3)).toMatchObject({ ok: false, code: "unsupported-config" });
  });

  it.each([
    ["no growth", v4({ progressive: null })],
    ["a growth on another method", v4({}, { amortization: "level-payment" })],
    ["a contract repayment amount", v4({ terms: { ...(v4().terms as object), contractualPaymentMinor: 1_051_44 } })],
    ["a recalculation once a year", v4({}, { recast: "annual" })],
    ["a repayment amount rule", v4({}, { repaymentDerivation: "contractual-fixed" })],
    ["negative amortization", v4({}, { negativeAmortizationAllowed: true })],
  ])("refuses %s", (_name, config) => {
    expect(parseDebtConfig(config)).toMatchObject({ ok: false, code: "inconsistent-profile" });
  });

  it.each(["0.051", "1", "-0.001", "0.0000000000001", "abc"])("refuses the growth %j", (growth) => {
    expect(parseDebtConfig(v4({ progressive: { growthPerRepaymentDecimal: growth } })).ok).toBe(false);
  });

  it("accepts contract recast dates and zero growth", () => {
    expect(parseDebtConfig(v4({ paymentRecasts: [{ date: "2027-01-31", note: null }] }, { recast: "on-contract-date" })).ok).toBe(true);
    expect(parseDebtConfig(v4({ progressive: { growthPerRepaymentDecimal: "0" } })).ok).toBe(true);
  });

  it("saves at v4 only for progressive principal", () => {
    expect(debtConfigVersionFor("annuity-at-payment-frequency", { progressive: { growthPerRepaymentDecimal: "0.003" } })).toBe(4);
    expect(debtConfigVersionFor("annuity-at-payment-frequency", { progressive: null })).toBe(1);
    expect(debtConfigVersionFor("annuity-at-payment-frequency", { lenderStatement: { interestAllocation: "accrued-to-due-date" } })).toBe(3);
  });
});
