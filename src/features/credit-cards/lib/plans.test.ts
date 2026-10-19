import { planSchema, type RepaymentPlan } from "./models";
import { planEntryFor, planProgress, planProjection, planStatus, suggestPlanLink } from "./plans";
import { activityKind } from "./derive/types";
import { row, setup, snapshot } from "./fixtures/testKit";

function context() {
  const test = setup({ purchaseAprBps: null });
  const purchase = row({ id: "purchase", date: "2026-09-01", amount: -104729, categoryId: "tech" });
  const conversion = row({ id: "conversion", date: "2026-09-01", amount: 104729, payeeName: "EPP CONVERSION" });
  const instalment = row({ id: "instalment", date: "2026-10-02", amount: -17454, payeeName: "EPP 1/6" });
  const fee = row({ id: "fee", date: "2026-09-01", amount: -500 });
  const refund = row({ id: "refund", date: "2026-09-20", amount: 1000, categoryId: "tech" });
  const source = snapshot([purchase, conversion, instalment, fee, refund], { from: "2026-09-01", to: "2027-04-30" });
  const plan = planSchema.parse({
    id: "plan", cardId: test.cardId, revision: 1, name: "Laptop", recordedAs: "card-instalments", originalAmountMinor: 104729,
    startDate: "2026-09-01", scheduleKind: "fixed", firstDueDate: "2026-10-02", instalmentCount: 6, instalmentMinor: 17454,
    minimumPercentBps: 500, minimumFloorMinor: 1,
  });
  return { ...test, purchase, conversion, instalment, fee, refund, source, plan };
}

const withTerms = (plan: RepaymentPlan, patch: Partial<RepaymentPlan>) => ({ ...plan, ...patch });

it("calculates exact expected principal with a final rounding adjustment, never creating Actual payments", () => {
  const { card, plan } = context();
  const result = planProjection(plan, card());
  expect(result.rows.map((entry) => entry.amountMinor)).toEqual([17454, 17454, 17454, 17454, 17454, 17459]);
  if (result.calculated) expect(result.totalMinor).toBe(plan.originalAmountMinor);
});

it("uses the shared minimum rule with a final deadline and restores month-end after February", () => {
  const { card, plan } = context();
  const result = planProjection(withTerms(plan, {
    scheduleKind: "minimum-deadline", firstDueDate: "2027-01-31", instalmentCount: 3, instalmentMinor: null, originalAmountMinor: 10000, minimumFloorMinor: 0,
  }), card());
  expect(result.rows.map((entry) => entry.date)).toEqual(["2027-01-31", "2027-02-28", "2027-03-31"]);
  expect(result.rows.map((entry) => entry.amountMinor)).toEqual([500, 475, 9025]);
});

it("avoids adding monthly fees twice and records balance-only and promotional plans without a schedule", () => {
  const { card, plan } = context();
  const included = planProjection(withTerms(plan, { instalmentMinor: 17954, monthlyFeeMinor: 500 }), card());
  const separate = planProjection(withTerms(plan, { monthlyFeeMinor: 500, includesCosts: false }), card());
  expect(included.rows.map((entry) => entry.amountMinor)).toEqual(separate.rows.map((entry) => entry.amountMinor));
  expect(planProjection(withTerms(plan, { scheduleKind: null, firstDueDate: null, instalmentCount: null, instalmentMinor: null }), card()).calculated).toBe(false);
  expect(planProjection(withTerms(plan, { scheduleKind: "promotional" }), card()).calculated).toBe(false);
});

it("reconciles nonzero-rate totals on the card's day-count basis (PL-15)", () => {
  const { card, plan } = context();
  const terms = withTerms(plan, { aprBps: 1800, upfrontFeeMinor: 1000, monthlyFeeMinor: 300, includesCosts: false });
  const result = planProjection(terms, card());
  if (!result.calculated) throw new Error("not calculated");
  expect(result.totalMinor).toBe(result.principalMinor + result.interestMinor + result.upfrontFeeMinor + result.monthlyFeesMinor);
  const at360 = planProjection(terms, { ...card(), interestModel: "daily-simple-360" });
  if (!at360.calculated) throw new Error("not calculated");
  expect(at360.interestMinor).toBeGreaterThan(result.interestMinor);
  expect(at360.reason).toContain("Actual/360");
});

it("honours inclusive monthly contract costs and rejects inconsistent terms", () => {
  const { card, plan } = context();
  const projection = planProjection(withTerms(plan, { originalAmountMinor: 120000, instalmentMinor: 22000, aprBps: 1800 }), card());
  if (!projection.calculated) throw new Error("not calculated");
  expect(projection.rows.map((entry) => entry.amountMinor)).toEqual(Array(6).fill(22000));
  expect(projection).toMatchObject({ principalMinor: 120000, interestMinor: 12000, totalMinor: 132000 });
  expect(planProjection(withTerms(plan, { originalAmountMinor: 120000, instalmentMinor: 10000 }), card()).calculated).toBe(false);
  expect(planSchema.safeParse({ ...plan, firstDueDate: plan.startDate }).success).toBe(false);
  expect(planSchema.safeParse({ ...plan, instalmentMinor: 500, monthlyFeeMinor: 500 }).success).toBe(false);
  expect(planSchema.safeParse({ ...plan, scheduleKind: null }).success).toBe(false);
});

it("enforces one plan per entry, sign rules, the fit check and atomic saves (PL-13)", () => {
  const { store, plan, source, conversion, purchase, instalment, workspace, card } = context();
  const original = planEntryFor(plan.id, purchase, "original");
  const convert = planEntryFor(plan.id, conversion, "conversion");
  expect(() => store.getState().savePlan("budget", null, source, withTerms(plan, { originalAmountMinor: 200000 }), [original])).toThrow("exceeds");
  expect(() => store.getState().savePlan("budget", null, source, plan, [convert, convert])).toThrow("once");
  expect(() => store.getState().savePlan("budget", null, source, plan, [{ ...convert, role: "instalment", instalmentNumber: 1 }])).toThrow("charge");
  expect(workspace().plans).toEqual([]);
  store.getState().savePlan("budget", null, source, plan, [original, convert, planEntryFor(plan.id, instalment, "instalment", 1)]);
  expect(activityKind(source.rows[1], card(), workspace(), source)).toBe("instalment");
  expect(planProgress(workspace().plans[0], card(), workspace(), source).billedCount).toBe(1);
  expect(() => store.getState().savePlan("budget", 9, source, plan, [])).toThrow("This record changed");
  const other = withTerms(plan, { id: "other", name: "Phone" });
  expect(() => store.getState().savePlan("budget", null, source, other, [{ ...convert, planId: "other" }])).toThrow("another plan");
  store.getState().undo("budget");
  expect(workspace().plans).toEqual([]);
});

it("says an instalment was not seen five days after its due date, and Finished keeps balances visible", () => {
  const { store, plan, source, workspace, card } = context();
  store.getState().savePlan("budget", null, source, plan, []);
  expect(planStatus(workspace().plans[0], card(), workspace(), source, "2026-10-08")).toMatchObject({ key: "instalment-not-seen", check: true, label: "Oct instalment not seen" });
  expect(planStatus(withTerms(workspace().plans[0], { status: "completed" }), card(), workspace(), source, "2026-10-08").key).toBe("finished");
});

it("suggests entries from the cached schedule by amount and period", () => {
  const { plan, source, workspace, card, instalment, refund } = context();
  expect(suggestPlanLink(instalment, plan, card(), workspace(), source)).toMatchObject({ role: "instalment", instalmentNumber: 1 });
  expect(suggestPlanLink(refund, plan, card(), workspace(), source)).toBeNull();
  expect(suggestPlanLink(row({ id: "named", date: "2026-09-20", amount: 1000, payeeName: "Laptop refund", categoryId: "tech" }), plan, card(), workspace(), source))
    .toMatchObject({ role: "refund" });
});

it("suggests a fee only when it names the plan or matches the plan's own fee", () => {
  const { plan, source, workspace, card } = context();
  const vat = row({ id: "vat", date: "2026-09-13", amount: -9, payeeName: "FOREIGN TRANSACTION FEE" });
  expect(activityKind(vat, card(), workspace(), source)).toBe("fee");
  expect(suggestPlanLink(vat, plan, card(), workspace(), source)).toBeNull();
  const named = row({ id: "named-fee", date: "2026-09-13", amount: -2500, payeeName: "LAPTOP LATE FEE" });
  expect(suggestPlanLink(named, plan, card(), workspace(), source)).toMatchObject({ role: "cost" });
  const withFee = { ...plan, monthlyFeeMinor: 9 };
  expect(suggestPlanLink(vat, withFee, card(), workspace(), source)).toMatchObject({ role: "cost", reason: "Matches the plan's fee" });
});
