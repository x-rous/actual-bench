import { cardInputSchema } from "./models";
import { simulate } from "@/lib/financial-models/loan/projection";
import { AU_PROFILE } from "@/lib/financial-models/loan/__fixtures__/profiles";
import type { LoanModelSnapshot, SimulationRequest } from "@/lib/financial-models/loan/model";
import { cardBalance, cardFacility, calculateCardDebt, cardModel, projectCardMinimums, projectedCycleDates } from "./financialAdapter";

const model: LoanModelSnapshot = {
  debtId: "card", revision: 1, currency: { code: "", minorDigits: 2 }, behaviorClass: "revolving-credit", lenderPattern: "separate-interest",
  terms: { openingDate: "2026-10-04", openingPrincipalMinor: 285000, maturityDate: null, contractualTermMonths: null, amortizationTermMonths: null, contractualPaymentMinor: null, creditLimitMinor: 2500000, firstPaymentDate: null, firstInterestChargeDate: "2026-11-04" },
  profile: { ...AU_PROFILE, amortization: "revolving", repaymentFrequency: "monthly", repaymentDerivation: "contractual-fixed", chargeDay: 4 },
  rates: [{ accrualEffectiveFrom: "2026-10-04", annualRateDecimal: "0.3499" }],
  phases: [], offsets: [], components: [], paymentRecasts: [], assumptions: [],
  revolving: { paymentModel: "fixed-scheduled", percentOfBalanceBps: null, minimumFloorMinor: null },
};
const request: SimulationRequest = {
  model, anchor: { date: "2026-10-04", principalMinor: 285000, accruedInterestMinor: 0, source: "statement" },
  events: [{ kind: "draw", date: "2026-10-10", amountMinor: 130000, ref: { source: "actual", id: "purchase" } }, { kind: "repayment", date: "2026-10-15", amountMinor: 60000, ref: { source: "actual", id: "payment" } }],
  to: "2026-10-29",
};

it("preserves integer balance signs including card credit and refuses invalid precision", () => {
  expect(cardBalance(-3150.01)).toEqual({ signedBalanceMinor: -315001, debtMinor: 315001, creditMinor: 0 });
  expect(cardBalance(250)).toEqual({ signedBalanceMinor: 25000, debtMinor: 0, creditMinor: 25000 });
  expect(() => cardBalance(0.001)).toThrow();
  expect(() => cardBalance(Infinity)).toThrow();
  expect(cardFacility(model, -315000)).toEqual({ limitMinor: 2500000, drawnMinor: 315000, availableMinor: 2185000 });
  expect(cardFacility(model, 25000).drawnMinor).toBe(0);
});

it("uses the Loans & Debt engine for supported revolving inputs without generated payments", () => {
  const result = calculateCardDebt(request);
  expect(result).toEqual(simulate({ ...request, options: { generateScheduledRepayments: false, applyAssumptions: false } }));
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(JSON.stringify(result));
  expect(result.closing.principalMinor).toBe(355000);
  expect(result.closing.accruedInterestMinor).toBeGreaterThan(0);
  expect(result.events.filter((event) => event.type === "repayment")).toHaveLength(1);
});

it("passes unsupported profiles through and does not guess term-loan or credit-anchor behavior", () => {
  const unsupported = calculateCardDebt({ ...request, model: { ...model, profile: { ...model.profile, dayCount: "unimplemented" as LoanModelSnapshot["profile"]["dayCount"] } } });
  expect(unsupported.ok).toBe(false);
  expect(() => calculateCardDebt({ ...request, model: { ...model, behaviorClass: "term-loan" } })).toThrow("revolving");
  expect(() => calculateCardDebt({ ...request, anchor: { ...request.anchor, principalMinor: -100 } })).toThrow();
});

const card = { ...cardInputSchema.parse({ budgetSyncId: "budget", accountId: "card", creditLimitMinor: null, purchaseAprBps: 2400, status: "active", bankTimeZone: "UTC", closingDay: 31, interestModel: "daily-simple-365" }), id: "c", revision: 1 };
it("capitalizes at the upcoming closing day, then accrues interest on that higher balance", () => {
  const model = cardModel(card, "2026-10-10", 766000);
  expect(model.terms.firstInterestChargeDate).toBe("2026-10-31");
  const result = calculateCardDebt({ model, anchor: { date: "2026-10-10", principalMinor: 766000, accruedInterestMinor: 0, source: "current-actual-balance" }, events: [], to: "2026-11-09" });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("Illustration blocked");
  expect(result.events.find((event) => event.type === "interest-charge")?.date).toBe("2026-10-31");
  const total = result.closing.accruedInterestMinor + result.events.reduce((sum, event) => sum + event.interestMinor, 0);
  expect(total).toBeGreaterThan(15110); // Constant-base simple interest for 30 days is 151.10.
});
it("clamps short months and skips the already closed anchor day", () => {
  expect(cardModel(card, "2026-02-01", 10000).terms.firstInterestChargeDate).toBe("2026-02-28");
  expect(cardModel(card, "2026-02-28", 10000).terms.firstInterestChargeDate).toBe("2026-03-31");
});
it("accumulates capitalized interest over a year and reduces it when repayments occur", () => {
  const model = cardModel(card, "2026-10-10", 766000);
  const request = { model, anchor: { date: "2026-10-10", principalMinor: 766000, accruedInterestMinor: 0, source: "current-actual-balance" as const }, events: [], to: "2027-10-10" };
  const unpaid = calculateCardDebt(request);
  const paid = calculateCardDebt({ ...request, events: [{ kind: "repayment", date: "2026-10-20", amountMinor: 20000, ref: { source: "actual", id: "payment" } }] });
  if (!unpaid.ok || !paid.ok) throw new Error("Illustration blocked");
  const interest = (result: typeof unpaid) => result.closing.accruedInterestMinor + result.events.reduce((sum, event) => sum + event.interestMinor, 0);
  expect(interest(unpaid)).toBeGreaterThan(183840); // One year at 24% without compounding.
  expect(interest(paid)).toBeLessThan(interest(unpaid));
});

it("projects minimum payments through the shared engine and reports a bounded horizon", () => {
  const configured = { ...card, minimumPercentBps: 500, minimumFloorMinor: 2500, dueRule: { kind: "day-of-month" as const, value: 1 } };
  const result = projectCardMinimums(configured, "2026-10-10", 100000);
  expect(result?.ok).toBe(true);
  if (!result?.ok) throw new Error("Minimum projection blocked");
  expect(result.payoffDate).not.toBeNull();
  expect(result.interestMinor).toBeGreaterThan(0);
  expect(result.balancePoints.at(-1)?.value).toBe(0);
  expect(result.interestPoints.at(-1)?.value).toBe(result.interestMinor);
  const zero = projectCardMinimums({ ...configured, purchaseAprBps: 0 }, "2026-10-10", 100000);
  expect(zero?.ok && zero.interestMinor).toBe(0);
  const growing = projectCardMinimums({ ...configured, minimumPercentBps: 100, minimumFloorMinor: 0 }, "2026-10-10", 100000);
  expect(growing?.ok && growing.payoffDate).toBeNull();
  expect(projectCardMinimums({ ...configured, purchaseAprBps: null }, "2026-10-10", 100000)).toBeNull();
});

 it("settles residual interest after a temporary zero posted balance", () => {
  const result = projectCardMinimums({ ...card, minimumPercentBps: 200, minimumFloorMinor: 2500, dueRule: { kind: "day-of-month", value: 1 } }, "2026-10-11", 123000);
  if (!result?.ok) throw new Error("Projection blocked");
  expect(result.payoffDate).toBe("2043-01-31");
  expect(result.interestMinor).toBe(360717);
  expect(result.accruedInterestMinor).toBe(0);
  expect(result.balancePoints.at(-1)).toMatchObject({ date: result.payoffDate, value: 0 });
  expect(result.interestPoints.at(-1)).toMatchObject({ date: result.payoffDate, value: result.interestMinor });
});

it("recomputes month-end and days-after-close dues independently for every cycle", () => {
  const configured = { ...card, closingDay: 1, dueRule: { kind: "day-of-month" as const, value: 31 } };
  expect(projectedCycleDates(configured, "2027-01-02", "2027-04-30").map((cycle) => cycle.dueDate)).toEqual(["2027-02-28", "2027-03-31", "2027-04-30"]);
  expect(projectedCycleDates(configured, "2028-01-02", "2028-03-31").map((cycle) => cycle.dueDate)).toEqual(["2028-02-29", "2028-03-31"]);
  expect(projectedCycleDates({ ...card, dueRule: { kind: "days-after-close", value: 25 } }, "2027-01-01", "2027-03-31").map((cycle) => cycle.dueDate)).toEqual(["2027-02-25", "2027-03-25", "2027-04-25"]);
});

it("stops at the first cycle a minimum does not cover the interest, instead of running 30 years (CA-14)", () => {
  const result = projectCardMinimums({ ...card, minimumPercentBps: 100, minimumFloorMinor: 0, dueRule: { kind: "day-of-month", value: 1 } }, "2026-10-11", 100000);
  if (!result?.ok) throw new Error("Projection blocked");
  expect(result).toMatchObject({ neverPaysOff: true, payoffDate: null, interestMinor: null, insufficientInterestPayments: true });
  expect(result.balancePoints.at(-1)!.date < "2027-01-01").toBe(true);
  const slow = projectCardMinimums({ ...card, purchaseAprBps: 0, minimumPercentBps: 100, minimumFloorMinor: 0, dueRule: { kind: "day-of-month", value: 1 } }, "2026-10-11", 100000);
  expect(slow?.ok && slow.payoffDate).toBeNull();
  expect(slow?.ok && slow.insufficientInterestPayments).toBe(false);
});

 it("schedules actual simulated repayments on independently calculated dues", () => {
  const result = projectCardMinimums({ ...card, closingDay: 1, purchaseAprBps: 0, minimumPercentBps: 200, minimumFloorMinor: 2500, dueRule: { kind: "day-of-month", value: 31 } }, "2027-01-02", 10000);
  if (!result?.ok) throw new Error("Projection blocked");
  const payments = result.balancePoints.filter((point) => point.breakdown.some((item) => item.label === "Repayments since previous observation" && item.value > 0));
  expect(payments.map((point) => point.date)).toEqual(["2027-02-28", "2027-03-31", "2027-04-30", "2027-05-31"]);
});

 it("flags zero minimum repayments as insufficient when interest still accrues", () => {
  const result = projectCardMinimums({ ...card, minimumPercentBps: 0, minimumFloorMinor: 0, dueRule: { kind: "day-of-month", value: 1 } }, "2026-10-11", 10000);
  expect(result?.ok && result.insufficientInterestPayments).toBe(true);
});
