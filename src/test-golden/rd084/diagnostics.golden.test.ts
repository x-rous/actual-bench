import { diagnoseConventions } from "@/lib/financial-models/loan/diagnostics";
import { dailySchedule, oracleEveryNDays, oracleMonthly } from "@/test-oracles/rd084/schedules";
import { BASE_PROFILE, model } from "./builders";

/*
 * T064: given a lender balance produced under Actual/360 (by the independent
 * oracle), the diagnostic run on a model configured as Actual/365 Fixed ranks
 * Actual/360 closest, and changes no configuration.
 */

it("identifies the convention that fits a statement better, without changing configuration", () => {
  const until = "2024-06-15";
  const lender = dailySchedule({
    anchorDate: "2024-01-15", principal: "400000.00", convention: "actual-360", rates: [{ from: "2024-01-15", annualRate: "0.0612" }],
    charges: oracleMonthly("2024-02-15", 5, 15), scheduled: oracleEveryNDays("2024-01-29", 14, until).map((date) => ({ date, amount: "1200.00" })),
    order: { scheduled: "before", other: "before", offsets: "before" }, dayScale: null, dayMode: "half-up", postingMode: "half-up", until,
  });
  const observed = { date: until, principalMinor: lender.at(-1)!.balance };

  const m = model({
    principalMinor: 40000000, openingDate: "2024-01-15", firstPaymentDate: "2024-01-29", contractualTermMonths: 360, contractualPaymentMinor: 120000, firstInterestChargeDate: "2024-02-15",
    rates: [{ accrualEffectiveFrom: "2024-01-15", annualRateDecimal: "0.0612" }],
    profile: { ...BASE_PROFILE, accrual: "daily-simple", chargeFrequency: "monthly", chargeDay: 15, repaymentFrequency: "fortnightly", repaymentDerivation: "contractual-fixed" },
  });
  const before = JSON.stringify(m);
  const candidates = diagnoseConventions({ model: m, anchor: { date: "2024-01-15", principalMinor: 40000000, accruedInterestMinor: 0, source: "opening" }, events: [], to: until }, observed);

  expect(candidates[0]).toMatchObject({ variant: { dayCount: "actual-360" }, differenceMinor: 0 });
  const current = candidates.find((c) => c.isCurrent)!;
  expect(current.variant.dayCount).toBe("actual-365-fixed");
  expect(Math.abs(current.differenceMinor!)).toBeGreaterThan(0);
  expect(JSON.stringify(m)).toBe(before);
  expect(candidates.every((c) => !("profile" in c) && !("config" in c))).toBe(true);
});
