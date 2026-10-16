import { cardSchema, repaymentPlanSchema, statementSchema, type PlanLink, type Workspace } from "./models";
import type { ActivityRow, ActivitySnapshot } from "./activity";
import { settlements, repaymentLedger } from "./repayments";
import { statementOutcome } from "./paymentSummary";
import { paymentEffects } from "./paymentEffects";
import { statementChargeBreakdown, planDebtBreakdown } from "./planReporting";
import { planHealth, planProjection, planSchedule, refundEvidenceSignature, suggestPlanLink } from "./plans";
import { statementReview } from "./statements";

export function planScenario() {
  const card = cardSchema.parse({ id: "card", budgetSyncId: "budget", revision: 1, accountId: "account", nickname: "Plan scenario", issuer: "", last4: "", creditLimitMinor: 500000, purchaseAprBps: 2400, bankTimeZone: "UTC", status: "active", closingDay: 8, interestCategoryId: "interest", feeCategoryId: "fees", dueRule: { kind: "day-of-month", day: 2 } });
  const rows: ActivityRow[] = [];
  const links: PlanLink[] = [];
  const add = (id: string, date: string, amountMinor: number, planId?: string, role?: PlanLink["role"], instalment: number | null = null, cleared = true, payment = false) => {
    rows.push({ id, date, amountMinor, accountId: "account", label: id, notes: `Scenario ${id}`, fingerprint: id, cleared, transferId: payment ? `${id}-peer` : null, transferKnown: true, categoryId: null, categoryName: null, parentId: null });
    if (planId && role) links.push({ planId, transactionId: id, fingerprint: id, role, instalment });
  };
  add("original-a", "2026-06-10", -120000);
  add("conversion-a", "2026-06-10", 120000, "a", "conversion-credit");
  add("fee-a", "2026-06-10", -1200, "a", "plan-fee");
  add("a1", "2026-07-08", -20000, "a", "instalment-billed", 1);
  add("pay-july", "2026-08-02", 21200, undefined, undefined, null, true, true);
  add("a2", "2026-08-08", -20000, "a", "instalment-billed", 2);
  add("original-b", "2026-08-12", -100000);
  add("conversion-b", "2026-08-12", 100000, "b", "conversion-credit");
  add("fee-b", "2026-08-12", -3000, "b", "plan-fee");
  add("pay-august", "2026-09-02", 20000, undefined, undefined, null, true, true);
  add("a3", "2026-09-08", -20000, "a", "instalment-billed", 3);
  add("b1", "2026-09-08", -33333, "b", "instalment-billed", 1);
  add("b-fee1", "2026-09-08", -500, "b", "plan-fee");
  add("refund-b", "2026-09-20", 10000, "b", "refund");
  add("pay-september", "2026-10-02", 46833, undefined, undefined, null, true, true);
  add("a4", "2026-10-08", -20000, "a", "instalment-billed", 4);
  add("b2", "2026-10-08", -33333, "b", "instalment-billed", 2);
  add("b-fee2", "2026-10-08", -500, "b", "plan-fee");
  add("pending-pay", "2026-10-14", 2500, undefined, undefined, null, false, true);
  add("pending-buy", "2026-10-15", -4500, undefined, undefined, null, false);
  const plan = (id: string, amountMinor: number, startDate: string, firstDueDate: string, monthlyMinor: number, months: number, upfrontFeeMinor: number, monthlyFeeMinor: number) => repaymentPlanSchema.parse({ id, cardId: card.id, transactionId: `original-${id}`, fingerprint: `original-${id}`, revision: 1, arrangement: "fixed", status: "active", amountMinor, startDate, firstDueDate, monthlyMinor, months, aprBps: 0, upfrontFeeMinor, monthlyFeeMinor, includesCosts: id === "a", minimumPercentBps: 500, minimumFloorMinor: 10000, expiryDate: null, afterAprBps: null, conditions: "" });
  const plans = [plan("a", 120000, "2026-06-10", "2026-08-02", 20000, 6, 1200, 0), plan("b", 100000, "2026-08-12", "2026-10-02", 33333, 3, 3000, 500)];
  const statements = [0, 21200, 20000, 56833, 53833].map((officialBalanceMinor, index) => statementSchema.parse({ id: `s${index}`, cardId: card.id, revision: 1, periodStart: `2026-${String(index + 5).padStart(2, "0")}-09`, closingDate: `2026-${String(index + 6).padStart(2, "0")}-08`, dueDate: `2026-${String(index + 7).padStart(2, "0")}-02`, officialBalanceMinor, minimumDueMinor: index ? 10000 : 0, openingBalanceMinor: index ? undefined : 0, lifecycle: "finalized", verification: "verified", coverage: "complete", openingAnchor: !index, bankConfirmed: true }));
  const snapshot: ActivitySnapshot = { accountId: "account", from: "2026-05-01", to: "2026-10-15", fetchedAt: "2026-10-15", signature: "scenario", rows, counterparts: [], issues: [] };
  const workspace: Workspace = { cards: [card], statements, plans, planLinks: links, memberships: [], allocations: [], classifications: [] };
  // Explicit cycle ownership is what the verified review represents, including cutoff postings.
  workspace.memberships = rows.flatMap((row) => {
    const index = row.date <= "2026-07-08" ? 1 : row.date <= "2026-08-08" ? 2 : row.date <= "2026-09-08" ? 3 : row.date <= "2026-10-08" ? 4 : -1;
    return index < 0 ? [] : [{ statementId: statements[index].id, cardId: card.id, transactionId: row.id, fingerprint: row.fingerprint, decision: "included" as const, provenance: "manual" as const, bankPostingDate: null, reason: "Confirmed cycle membership" }];
  });
  return { card, workspace, snapshot, plans, statements };
}

it("reconciles all five cycles while excluding conversion offsets from settlement dates and payment effects", () => {
  const { card, workspace, snapshot, statements } = planScenario();
  for (const statement of statements) expect(statementReview(statement, workspace, snapshot).varianceMinor).toBe(0);
  const payments = settlements(card, workspace, snapshot, "2026-10-15");
  expect(payments[2]).toMatchObject({ confirmedPaidDate: "2026-09-02", confirmedCreditMinor: 0, fullByDue: true });
  expect(payments[3]).toMatchObject({ confirmedPaidDate: "2026-10-02", confirmedPaidMinor: 46833, confirmedCreditMinor: 10000 });
  expect(paymentEffects(card, workspace, snapshot, payments, "2026-10-15").get("pay-august")?.label).toBe("Completes statement");
  expect(statementOutcome(statements[4], payments[4], "2026-10-15", true)).toMatchObject({ label: "Part payment pending", timing: "538.33 due · part pending" });
  expect(repaymentLedger(card, workspace, snapshot, "2026-10-15").origins.find((entry) => entry.id === "original-b")?.remainingMinor).toBe(0);
});
it("separates plan flows and debt from future commitments, without allocating pending payments", () => {
  const { card, workspace, snapshot, statements } = planScenario();
  expect(statementChargeBreakdown(card, statements[4], workspace, snapshot)).toMatchObject({ newChargesMinor: 0, planChargesMinor: 53333, planFeesMinor: 500, otherCostsMinor: 500 });
  expect(statementChargeBreakdown(card, statements[1], workspace, snapshot)).toMatchObject({ newChargesMinor: 120000, planChargesMinor: 20000 });
  expect(planDebtBreakdown(card, workspace, snapshot, -55833, "2026-10-15")).toMatchObject({ known: true, planMinor: 53333, otherMinor: 500, pendingOtherMinor: 4500, pendingCreditMinor: 2500, differenceMinor: 0, futureMinor: 73834 });
});
it("keeps mixed-bucket repayments unallocated and reconciles the recorded total", () => {
  const { card, workspace, snapshot } = planScenario();
  const mixed = { ...snapshot, rows: snapshot.rows.map((row) => row.id === "pending-buy" ? { ...row, cleared: true, date: "2026-10-13" } : row.id === "pending-pay" ? { ...row, cleared: true } : row) };
  expect(planDebtBreakdown(card, workspace, mixed, -55833, "2026-10-15")).toMatchObject({ planMinor: 53333, otherMinor: 5000, unallocatedMinor: 2500, differenceMinor: 0 });
});
it("shows consistently inclusive expected totals and only revises unbilled expectations after explicit refund confirmation", () => {
  const { card, workspace, snapshot, plans } = planScenario();
  const plan = plans[1], links = workspace.planLinks!.filter((link) => link.planId === plan.id);
  expect(planProjection(plan, card).rows.map((row) => row.amountMinor)).toEqual([36833, 33833, 33834]);
  expect(planHealth(plan, workspace, snapshot, "2026-10-15").reasons).toEqual([]);
  const revised = { ...plan, refundReview: { treatment: "revised" as const, signature: refundEvidenceSignature(links), remaining: [{ index: 3, date: "2026-12-02", amountMinor: 23834 }] } };
  expect(planHealth(revised, workspace, snapshot, "2026-10-15").reasons).toEqual([]);
  expect(planSchedule(revised, card, links).map((row) => row.amountMinor)).toEqual([36833, 33833, 23834]);
  expect(planSchedule(revised, card, links.filter((link) => link.role !== "refund")).at(-1)?.amountMinor).toBe(33834);
  expect(suggestPlanLink(snapshot.rows.find((row) => row.id === "b2")!, plan, card, links.filter((link) => link.transactionId !== "b2"))).toMatchObject({ role: "combined-instalment", instalment: 2 });
});
