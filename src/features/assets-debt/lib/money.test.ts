import { parseDebtConfig } from "@/lib/financial-models/loan/configSchema";
import { SIMULATOR_DEFAULT_PROFILE as DEFAULT_PROFILE, simulationToModel } from "./simulatorModel";
import { sim } from "./simulatorTestKit";
import { bpsToFraction, formatMinor, fractionToBps, fractionToPercent, minorToMajorText, parseFactor, parseMajorToMinor, percentToFraction } from "./money";
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
    expect(bpsToFraction(2550)).toBe("0.255");
    expect(fractionToBps("0.255")).toBe(2550);
    expect(fractionToBps("0.00001")).toBeNull();
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
      const profile = { ...DEFAULT_PROFILE, ...preset.profile, presetId: preset.id };
      const built = simulationToModel(sim({ profile }));
      expect(built.ok).toBe(true);
      if (!built.ok) continue;
      const config = { format: "rd084.debt-config", version: 1, terms: built.model.terms, profile: built.model.profile, phases: [], components: [], paymentRecasts: [], revolving: null };
      expect(parseDebtConfig(config).ok).toBe(true);
    }
  });
});
