import { directory, saveInput, tempDebtDb } from "@/lib/assets-debt/testing/debtFixtures";
import { resetAppDbForTests } from "@/lib/app-db/connection";
import { createDebtConfiguration } from "@/lib/assets-debt/services/debtConfigService";
import { applyPreset, DEFAULT_PROFILE, newDebtState, stateFromDetail, toSaveInput } from "./editorModel";
import { formatMinor, fractionToPercent, minorToMajorText, parseFactor, parseMajorToMinor, percentToFraction } from "./money";
import { DAY_COUNT_OPTIONS, PROFILE_PRESETS, REPAYMENT_FREQUENCY_OPTIONS, PER_RATE_RECAST_OPTIONS } from "./vocabulary";

describe("exact money and rate conversion", () => {
  it("parses amounts to integer minor units without floating point", () => {
    expect(parseMajorToMinor("400,000.50", 2)).toEqual({ ok: true, value: 40_000_050 });
    expect(parseMajorToMinor("0.1", 2)).toEqual({ ok: true, value: 10 });
    expect(parseMajorToMinor("30000000", 0)).toEqual({ ok: true, value: 30_000_000 });
    expect(parseMajorToMinor("", 2)).toEqual({ ok: true, value: null });
    expect(parseMajorToMinor("1.005", 2).ok).toBe(false);
    expect(parseMajorToMinor("-5", 2).ok).toBe(false);
    expect(parseMajorToMinor("1e3", 2).ok).toBe(false);
    expect(minorToMajorText(5, 2)).toBe("0.05");
    expect(formatMinor(40_000_050, 2, "AUD")).toBe("400,000.50 AUD");
    expect(formatMinor(-1234, 0, "JPY")).toBe("-1,234 JPY");
  });

  it("converts percentages to stored fractions exactly and back", () => {
    expect(percentToFraction("6.12")).toEqual({ ok: true, value: "0.0612" });
    expect(percentToFraction("0.1")).toEqual({ ok: true, value: "0.001" });
    expect(percentToFraction("0")).toEqual({ ok: true, value: "0" });
    expect(percentToFraction("-1").ok).toBe(false);
    expect(fractionToPercent("0.0612")).toBe("6.12");
    expect(parseFactor("1.0750")).toEqual({ ok: true, value: "1.075" });
    expect(parseFactor("0").ok).toBe(false);
  });
});

describe("support surface (configuration v1)", () => {
  it("offers the three selectable day counts, keeps the monthly allocation gated, and never shows MSRB or 30U/360", () => {
    expect(DAY_COUNT_OPTIONS.filter((o) => !o.disabled).map((o) => o.value)).toEqual(["actual-365-fixed", "actual-actual-calendar", "actual-360"]);
    expect(DAY_COUNT_OPTIONS.find((o) => o.value === "monthly-30-360-actual-day-allocation")?.disabled).toBe(true);
    expect(JSON.stringify(DAY_COUNT_OPTIONS)).not.toMatch(/msrb|30u/i);
  });

  it("gates generated semi-monthly and custom-dated schedules, and offers only per-rate recast overrides that make sense", () => {
    expect(REPAYMENT_FREQUENCY_OPTIONS.filter((o) => o.disabled).map((o) => o.value)).toEqual(["semi-monthly", "custom-dated"]);
    expect(PER_RATE_RECAST_OPTIONS.map((o) => o.value)).toEqual(["", "on-rate-change", "never", "lender-provided"]);
    expect(DEFAULT_PROFILE.interestOnlyRepayment).toBe("charged-interest-outstanding");
  });

  it("presets fill explicit profile fields, never name a lender, and every preset is a valid v1 profile", () => {
    for (const preset of PROFILE_PRESETS) {
      expect(`${preset.label} ${preset.description}`).not.toMatch(/bank|lender|ANZ|Westpac|Chase|Wells|CommBank|NAB|RBC|TD/i);
      const profile = applyPreset(DEFAULT_PROFILE, preset.id);
      expect(profile.presetId).toBe(preset.id);
      const state = { ...newDebtState("b"), profile, status: "draft" as const, name: "x", terms: { ...newDebtState("b").terms, openingDate: "2024-01-01", openingPrincipal: "1000" } };
      state.rates = [{ ...state.rates[0], accrualEffectiveFrom: "2024-01-01", ratePercent: "5" }];
      expect(toSaveInput(state).ok).toBe(true);
    }
  });
});

describe("editor state round trip", () => {
  afterEach(() => resetAppDbForTests());

  it("a saved debt loads into the editor and saves back to the same configuration", () => {
    const db = tempDebtDb();
    const input = saveInput({
      rates: [{ ...saveInput().rates[0], paymentCap: { kind: "previous-payment-factor", factor: "1.075" }, rateCapDecimal: "0.1" }],
      offsets: [{ actualAccountId: "acc-offset", effectiveFrom: "2024-01-01", effectiveTo: null, offsetPercentageBps: 2550, balanceBasis: "cleared", capMinor: 500_000 }],
    });
    const detail = createDebtConfiguration(db, input, directory());
    const state = stateFromDetail(detail)!;
    expect(state.rates[0]).toMatchObject({ ratePercent: "6.12", capKind: "previous-payment-factor", capFactor: "1.075", rateCapPercent: "10" });
    expect(state.offsets[0]).toMatchObject({ percent: "25.5", cap: "5000.00", balanceBasis: "cleared" });
    const back = toSaveInput(state);
    if (!back.ok) throw new Error(JSON.stringify(back.issues));
    expect(back.input.rates[0]).toMatchObject({ annualRateDecimal: "0.0612", paymentCap: { kind: "previous-payment-factor", factor: "1.075" }, rateCapDecimal: "0.1" });
    expect(back.input.offsets[0]).toMatchObject({ offsetPercentageBps: 2550, capMinor: 500_000 });
    expect(back.input.config).toEqual(JSON.parse(detail.debt.currentConfigJson));
  });

  it("reports unparseable input by field instead of sending it", () => {
    const state = newDebtState("b");
    state.terms.openingPrincipal = "lots";
    state.rates[0].ratePercent = "-2";
    const result = toSaveInput(state);
    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.issues.map((i) => i.field)).toEqual(expect.arrayContaining(["config.terms.openingPrincipalMinor", "rates.0.annualRateDecimal", "config.terms.openingDate"]));
  });
});
