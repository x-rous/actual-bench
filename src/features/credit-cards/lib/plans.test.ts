import { createCreditCardStore } from "./memory";
import { activityKind, type ActivityRow, type ActivitySnapshot } from "./activity";
import { repaymentPlanSchema } from "./models";
import { planHealth, planProjection } from "./plans";
const charge = (id: string, amountMinor: number, date = "2026-09-01"): ActivityRow => ({ id, amountMinor, date, accountId: "account", label: id, fingerprint: id, cleared: true, transferId: null, transferKnown: true, categoryId: null, categoryName: null, notes: null, parentId: null });
function setup() {
  const store = createCreditCardStore();
  const card = store.getState().register({ budgetSyncId: "budget", accountId: "account", nickname: "Card", issuer: "", last4: "", creditLimitMinor: null, purchaseAprBps: null, status: "active", bankTimeZone: "UTC" });
  const row = charge("purchase", -104729);
  const snapshot: ActivitySnapshot = { accountId: "account", from: "2026-09-01", to: "2027-04-30", rows: [row, charge("conversion", 104729), charge("instalment", -17454, "2026-10-02"), charge("fee", -500), charge("refund", 1000)], counterparts: [], issues: [], fetchedAt: "2026-10-14", signature: "test" };
  store.getState().classify("budget", card.id, 1, snapshot, { cardId: card.id, transactionId: row.id, fingerprint: row.fingerprint, kind: "purchase", reason: "Confirmed purchase" });
  const plan = repaymentPlanSchema.parse({ id: "plan", cardId: card.id, transactionId: row.id, fingerprint: row.fingerprint, revision: 1, arrangement: "fixed", status: "active", amountMinor: 104729, startDate: "2026-09-01", firstDueDate: "2026-10-02", months: 6, monthlyMinor: 17454, aprBps: 0, upfrontFeeMinor: 0, monthlyFeeMinor: 0, includesCosts: true, minimumPercentBps: 500, minimumFloorMinor: 10000, expiryDate: null, afterAprBps: null, conditions: "" });
  return { store, card: store.getState().workspaces.budget.cards[0], plan, snapshot };
}
it("calculates exact expected principal with a final rounding adjustment, never creating Actual payments", () => {
  const { card, plan } = setup();
  const result = planProjection(plan, card);
  expect(result.calculated).toBe(true);
  expect(result.rows.map((row) => row.amountMinor)).toEqual([17454, 17454, 17454, 17454, 17454, 17459]);
  if (result.calculated) expect(result.totalMinor).toBe(plan.amountMinor);
});
it("uses the shared minimum rule with a final deadline and restores month-end after February", () => {
  const { card, plan } = setup();
  const result = planProjection({ ...plan, arrangement: "minimum-deadline", firstDueDate: "2027-01-31", months: 3, amountMinor: 10000, minimumFloorMinor: 0 }, card);
  expect(result.rows.map((row) => row.date)).toEqual(["2027-01-31", "2027-02-28", "2027-03-31"]);
  expect(result.rows.map((row) => row.amountMinor)).toEqual([500, 475, 9025]);
});
it("avoids adding monthly fees twice when included and records unsupported arrangements without a schedule", () => {
  const { card, plan } = setup();
  const included = planProjection({ ...plan, monthlyMinor: 17954, monthlyFeeMinor: 500 }, card);
  const separate = planProjection({ ...plan, monthlyFeeMinor: 500, includesCosts: false }, card);
  expect(included.rows.map((row) => row.amountMinor)).toEqual(separate.rows.map((row) => row.amountMinor));
  for (const arrangement of ["promotional", "deferred", "revolving"] as const) expect(planProjection({ ...plan, arrangement }, card)).toMatchObject({ calculated: false, rows: [], reason: "Not calculated" });
});
it("enforces unique posting ownership, sign rules, source fingerprints, partial amounts and atomic rejection", () => {
  const { store, card, plan, snapshot } = setup();
  const link = { planId: plan.id, transactionId: "conversion", fingerprint: "conversion", role: "conversion-credit", instalment: null };
  expect(() => store.getState().savePlan("budget", card.id, card.revision, snapshot, { ...plan, amountMinor: 200000 }, [])).toThrow("fit");
  expect(() => store.getState().savePlan("budget", card.id, card.revision, snapshot, plan, [link, link])).toThrow("once");
  expect(() => store.getState().savePlan("budget", card.id, card.revision, snapshot, plan, [{ ...link, role: "instalment-billed", instalment: 1 }])).toThrow("direction");
  store.getState().savePlan("budget", card.id, card.revision, snapshot, { ...plan, amountMinor: 50000 }, [link]);
  const saved = store.getState().workspaces.budget;
  expect(saved.plans).toHaveLength(1);
  expect(saved.plans![0].amountMinor).toBe(50000);
  expect(activityKind(snapshot.rows[1], saved.cards[0], saved, snapshot)).toBe("other-credit");
  expect(saved.allocations).toEqual([]);
  expect(() => store.getState().savePlan("budget", card.id, card.revision, snapshot, plan, [])).toThrow("changed");
  store.getState().undo("budget");
  expect(store.getState().workspaces.budget.plans).toEqual([]);
});
it("surfaces missing instalments/refund/stale postings without silently completing or cancelling a plan", () => {
  const { store, card, plan, snapshot } = setup();
  store.getState().savePlan("budget", card.id, card.revision, snapshot, plan, [{ planId: plan.id, transactionId: "refund", fingerprint: "refund", role: "refund", instalment: null }]);
  const workspace = store.getState().workspaces.budget;
  expect(planHealth(plan, workspace, snapshot, "2026-11-01")).toMatchObject({ status: "Needs review", reasons: expect.arrayContaining([expect.stringContaining("refund"), expect.stringContaining("past expected")]) });
  expect(workspace.plans![0].status).toBe("active");
  expect(planHealth({ ...plan, status: "completed" }, workspace, snapshot, "2026-11-01").status).toBe("Needs review");
});
it("reconciles nonzero-rate expected totals, including interest and separate fees", () => {
  const { card, plan } = setup();
  const result = planProjection({ ...plan, aprBps: 1800, upfrontFeeMinor: 1000, monthlyFeeMinor: 300, includesCosts: false }, card);
  expect(result.calculated).toBe(true);
  if (!result.calculated) return;
  expect(result.interestMinor).toBeGreaterThan(0);
  expect(result.totalMinor).toBe(result.principalMinor + result.interestMinor + result.upfrontFeeMinor + result.monthlyFeesMinor);
  expect(result.totalMinor).toBe(result.rows.reduce((total, entry) => total + entry.amountMinor, 0));
  expect(result.rows.at(-1)?.final).toBe(true);
});
it("rejects posting ownership conflicts and retains confirmed terminal plan status", () => {
  const { store, card, plan, snapshot } = setup();
  const link = { planId: plan.id, transactionId: "fee", fingerprint: "fee", role: "plan-fee", instalment: null };
  store.getState().savePlan("budget", card.id, card.revision, snapshot, plan, [link]);
  const row = charge("second", -10000);
  const nextSnapshot = { ...snapshot, rows: [...snapshot.rows, row] };
  let workspace = store.getState().workspaces.budget;
  store.getState().classify("budget", card.id, workspace.cards[0].revision, nextSnapshot, { cardId: card.id, transactionId: row.id, fingerprint: row.fingerprint, kind: "purchase", reason: "Second purchase" });
  workspace = store.getState().workspaces.budget;
  const nextPlan = { ...plan, id: "second-plan", transactionId: row.id, fingerprint: row.fingerprint, amountMinor: 10000 };
  expect(() => store.getState().savePlan("budget", card.id, workspace.cards[0].revision, nextSnapshot, nextPlan, [{ ...link, planId: nextPlan.id }])).toThrow("belongs to another plan");
  expect(store.getState().workspaces.budget.plans).toHaveLength(1);
  store.getState().savePlan("budget", card.id, workspace.cards[0].revision, nextSnapshot, { ...workspace.plans![0], status: "completed" }, [link]);
  workspace = store.getState().workspaces.budget;
  store.getState().savePlan("budget", card.id, workspace.cards[0].revision, nextSnapshot, { ...workspace.plans![0], status: "active" }, [link]);
  expect(store.getState().workspaces.budget.plans![0].status).toBe("active");
});

it("honours inclusive monthly contract costs instead of overriding the final instalment", () => {
  const { card, plan } = setup();
  const projection = planProjection({ ...plan, amountMinor: 120000, monthlyMinor: 22000, aprBps: 1800 }, card);
  expect(projection.calculated).toBe(true);
  if (!projection.calculated) return;
  expect(projection.rows.map((row) => row.amountMinor)).toEqual(Array(6).fill(22000));
  expect(projection).toMatchObject({ principalMinor: 120000, interestMinor: 12000, totalMinor: 132000 });
  expect(planProjection({ ...plan, amountMinor: 120000, monthlyMinor: 10000 }, card).calculated).toBe(false);
  expect(repaymentPlanSchema.safeParse({ ...plan, firstDueDate: plan.startDate }).success).toBe(false);
  expect(repaymentPlanSchema.safeParse({ ...plan, monthlyMinor: 500, monthlyFeeMinor: 500 }).success).toBe(false);
});

it("allows orphaned plan metadata to be removed with source postings untouched and undo available", () => {
  const { store, card, plan, snapshot } = setup();
  store.getState().savePlan("budget", card.id, card.revision, snapshot, plan, [{ planId: plan.id, transactionId: "conversion", fingerprint: "conversion", role: "conversion-credit", instalment: null }]);
  const saved = store.getState().workspaces.budget;
  const missing = { ...snapshot, rows: [] };
  expect(planHealth(saved.plans![0], saved, missing, "2026-11-01").status).toBe("Needs review");
  expect(() => store.getState().deletePlan("budget", plan.id, 99, saved.cards[0].revision)).toThrow("changed");
  store.getState().deletePlan("budget", plan.id, saved.plans![0].revision, saved.cards[0].revision);
  expect(store.getState().workspaces.budget.plans).toEqual([]);
  expect(store.getState().workspaces.budget.planLinks).toEqual([]);
  expect(snapshot.rows).toHaveLength(5);
  store.getState().undo("budget");
  expect(store.getState().workspaces.budget.plans).toHaveLength(1);
  expect(store.getState().workspaces.budget.planLinks).toHaveLength(1);
});

it("does not require bank postings for zero-value expectations after early payoff", () => {
  const { card, plan, snapshot } = setup();
  const early = { ...plan, arrangement: "minimum-deadline" as const, minimumPercentBps: 10000, minimumFloorMinor: 0 };
  const projection = planProjection(early, card);
  expect(projection.rows).toHaveLength(1);
  const workspace = { cards: [card], statements: [], memberships: [], classifications: [], allocations: [], plans: [early], planLinks: [{ planId: early.id, transactionId: "instalment", fingerprint: "instalment", role: "instalment-billed" as const, instalment: 1 }] };
  expect(planHealth(early, workspace, snapshot, "2027-04-01").reasons).toEqual([]);
});

it("keeps tiny inclusive instalments level while conserving principal and finance cost", () => {
  const { card, plan } = setup();
  const result = planProjection({ ...plan, amountMinor: 1, monthlyMinor: 1, months: 6 }, card);
  expect(result.calculated).toBe(true);
  if (!result.calculated) return;
  expect(result.rows.map((row) => row.amountMinor)).toEqual([1, 1, 1, 1, 1, 1]);
  expect(result.rows.reduce((total, row) => total + row.principalMinor, 0)).toBe(1);
  expect(result.rows.reduce((total, row) => total + row.interestMinor, 0)).toBe(5);
});
