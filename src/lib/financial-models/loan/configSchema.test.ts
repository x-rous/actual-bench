import { DEBT_CONFIG_FORMAT, parseDebtConfig } from "./configSchema";
import { AU_PROFILE } from "./__fixtures__/profiles";

function validConfig(): Record<string, unknown> {
  return {
    format: DEBT_CONFIG_FORMAT,
    version: 1,
    terms: {
      openingDate: "2024-01-01",
      openingPrincipalMinor: 50_000_000,
      maturityDate: "2054-01-01",
      contractualTermMonths: 360,
      amortizationTermMonths: 360,
      contractualPaymentMinor: null,
      creditLimitMinor: null,
      firstPaymentDate: "2024-01-12",
      firstInterestChargeDate: "2024-02-01",
    },
    profile: structuredClone(AU_PROFILE),
    phases: [{ kind: "interest-only", from: "2024-01-01", to: "2026-01-01", recastAtEnd: "on-contract-date" }],
    components: [
      { economicKind: "principal", label: "Principal", destination: "transfer", categoryId: null, amountRule: "calculated", fixedAmountMinor: null, order: 0 },
      { economicKind: "fee", label: "Account fee", destination: "category", categoryId: "cat-fees", amountRule: "fixed", fixedAmountMinor: 1000, order: 1 },
    ],
    revolving: null,
  };
}

const withProfile = (change: Record<string, unknown>) => {
  const c = validConfig();
  c.profile = { ...(c.profile as object), ...change };
  return c;
};

describe("parseDebtConfig", () => {
  it("accepts a valid v1 config, as an object or a JSON string", () => {
    expect(parseDebtConfig(validConfig())).toMatchObject({ ok: true, config: { version: 1 } });
    expect(parseDebtConfig(JSON.stringify(validConfig())).ok).toBe(true);
  });

  it("returns unsupported-config for a future version instead of throwing", () => {
    expect(parseDebtConfig({ ...validConfig(), version: 2 })).toMatchObject({ ok: false, code: "unsupported-config" });
    expect(parseDebtConfig({ ...validConfig(), format: "rd084.debt-config-next" })).toMatchObject({ ok: false, code: "unsupported-config" });
  });

  it("returns unsupported-config for an identifier this build does not know", () => {
    const result = parseDebtConfig(withProfile({ dayCount: "30e-360-isda" }));
    expect(result).toMatchObject({ ok: false, code: "unsupported-config" });
    expect(result.ok ? [] : result.issues[0]).toMatch(/^profile\.dayCount/);
    expect(parseDebtConfig(withProfile({ rateQuote: "nominal-compounded-daily" }))).toMatchObject({ ok: false, code: "unsupported-config" });
  });

  it("returns unsupported-config for a known but unselectable convention", () => {
    expect(parseDebtConfig(withProfile({ dayCount: "msrb-g33-30-360", accrual: "per-period" }))).toMatchObject({
      ok: false,
      code: "unsupported-config",
      issues: ["profile.dayCount: msrb-g33-30-360 is not available in this build"],
    });
    expect(parseDebtConfig(withProfile({ dayCount: "monthly-30-360-actual-day-allocation" }))).toMatchObject({ ok: false, code: "unsupported-config" });
  });

  it("returns invalid-config for structural problems", () => {
    const missing = validConfig();
    delete (missing.terms as Record<string, unknown>).openingDate;
    expect(parseDebtConfig(missing)).toMatchObject({ ok: false, code: "invalid-config" });
    expect(parseDebtConfig({ ...validConfig(), extra: true })).toMatchObject({ ok: false, code: "invalid-config" });
    expect(parseDebtConfig(withProfile({ chargeDay: 1.5 }))).toMatchObject({ ok: false, code: "invalid-config" });
    expect(parseDebtConfig("{not json")).toMatchObject({ ok: false, code: "invalid-config" });
    expect(parseDebtConfig(null)).toMatchObject({ ok: false, code: "invalid-config" });
    const badDate = validConfig();
    (badDate.terms as Record<string, unknown>).openingDate = "2023-02-29";
    expect(parseDebtConfig(badDate)).toMatchObject({ ok: false, code: "invalid-config" });
  });

  it("returns unsupported-config for a well-defined combination this build does not implement", () => {
    const result = parseDebtConfig(withProfile({ repaymentDerivation: "split-monthly", repaymentFrequency: "semi-monthly" }));
    expect(result).toMatchObject({ ok: false, code: "unsupported-config" });
  });

  it("returns inconsistent-profile with the conflicting axes", () => {
    const result = parseDebtConfig(withProfile({ repaymentFrequency: "monthly" }));
    expect(result).toMatchObject({ ok: false, code: "inconsistent-profile" });
    expect(result.ok || result.code !== "inconsistent-profile" ? null : result.conflicts[0].axes).toEqual(["repaymentDerivation", "repaymentFrequency"]);
  });

  it("carries the economic kind on each component, separate from any category", () => {
    const result = parseDebtConfig(validConfig());
    expect(result.ok && result.config.components.map((c) => [c.economicKind, c.categoryId])).toEqual([
      ["principal", null],
      ["fee", "cat-fees"],
    ]);
    const unknownKind = validConfig();
    (unknownKind.components as Record<string, unknown>[])[0].economicKind = "cashback";
    expect(parseDebtConfig(unknownKind)).toMatchObject({ ok: false, code: "unsupported-config" });
  });

  it("accepts only the three revolving payment models", () => {
    const c = validConfig();
    c.revolving = { paymentModel: "percent-of-balance", percentOfBalanceBps: 200, minimumFloorMinor: 2500 };
    expect(parseDebtConfig(c).ok).toBe(true);
    c.revolving = { paymentModel: "minimum-due", percentOfBalanceBps: null, minimumFloorMinor: null };
    expect(parseDebtConfig(c)).toMatchObject({ ok: false, code: "unsupported-config" });
  });

  it("never throws on hostile input", () => {
    for (const input of [undefined, 42, [], "[]", "null", { format: DEBT_CONFIG_FORMAT }, { format: DEBT_CONFIG_FORMAT, version: 1 }]) {
      expect(() => parseDebtConfig(input)).not.toThrow();
      expect(parseDebtConfig(input).ok).toBe(false);
    }
  });
});
