import { addMonths, parseIsoDate } from "@/lib/financial-models/calendar/dates";
import { simulate } from "@/lib/financial-models/loan/projection";
import { revolvingPayment } from "@/lib/financial-models/loan/revolving";
import type { Anchor } from "@/lib/financial-models/loan/model";
import { cardModel } from "./financialAdapter";
import { sumMinor } from "./statements";
import type { Card, PlanLink, RepaymentPlan, Workspace } from "./models";
import type { ActivityRow, ActivitySnapshot } from "./activity";

export const arrangementLabels = { fixed: "Fixed instalments", "minimum-deadline": "Minimum + deadline", promotional: "Promotional rate", deferred: "Deferred interest", revolving: "Ordinary revolving" };
export const roleLabels = { "conversion-credit": "Conversion credit", "instalment-billed": "Instalment billed", "plan-fee": "Plan fee", refund: "Refund linked to original purchase" };
export type ExpectedInstalment = { index: number; date: string; amountMinor: number; principalMinor: number; interestMinor: number; feeMinor: number; final: boolean };

/** Pure expectations using the shared daily engine and minimum-payment primitive. No Actual events or balance writes. */
export function planProjection(plan: RepaymentPlan, card: Card) {
  if (!["fixed", "minimum-deadline"].includes(plan.arrangement)) return { calculated: false as const, rows: [] as ExpectedInstalment[], reason: "Not calculated" };
  // Inclusive fixed amounts describe a contract total, not a guessed amortization rate.
  if (plan.arrangement === "fixed" && plan.includesCosts) {
    const monthlyFeesMinor = sumMinor(Array.from({ length: plan.months }, () => plan.monthlyFeeMinor));
    const contractualMinor = sumMinor(Array.from({ length: plan.months }, () => plan.monthlyMinor ?? 0));
    const difference = contractualMinor - plan.amountMinor - monthlyFeesMinor;
    if (difference < -plan.months) return { calculated: false as const, rows: [] as ExpectedInstalment[], reason: "The monthly amounts do not cover the converted principal and included fees. Correct the amount, instalment or term." };
    const financeMinor = Math.max(0, difference);
    let principalLeft = plan.amountMinor, financeLeft = financeMinor;
    const rows: ExpectedInstalment[] = [];
    for (let index = 0; index < plan.months; index++) {
      const final = index === plan.months - 1;
      const interestMinor = final ? financeLeft : Math.min((plan.monthlyMinor ?? 0) - plan.monthlyFeeMinor, Math.ceil(financeLeft / (plan.months - index)));
      const principalMinor = final ? principalLeft : Math.min(principalLeft, (plan.monthlyMinor ?? 0) - plan.monthlyFeeMinor - interestMinor);
      const feeMinor = sumMinor([plan.monthlyFeeMinor, index === 0 ? plan.upfrontFeeMinor : 0]);
      rows.push({ index: index + 1, date: addMonths(plan.firstDueDate, index, parseIsoDate(plan.firstDueDate).day), amountMinor: sumMinor([principalMinor, interestMinor, feeMinor]), principalMinor, interestMinor, feeMinor, final });
      principalLeft -= principalMinor; financeLeft -= interestMinor;
    }
    return { calculated: true as const, unusualFinal: false, insufficientInterest: false, warning: null, rows, principalMinor: plan.amountMinor, interestMinor: financeMinor, upfrontFeeMinor: plan.upfrontFeeMinor, monthlyFeesMinor, totalMinor: sumMinor(rows.map((entry) => entry.amountMinor)), reason: "Fixed inclusive contract: the monthly amount and term determine total finance cost. Recorded APR does not add a second interest charge. Upfront fee is separate; the final amount adjusts minor rounding only." };
  }
  const rows: ExpectedInstalment[] = [];
  const model = cardModel({ ...card, purchaseAprBps: plan.aprBps, interestModel: "daily-simple-365", closingDay: parseIsoDate(plan.firstDueDate).day }, plan.startDate, plan.amountMinor);
  model.terms.creditLimitMinor = null;
  model.terms.firstInterestChargeDate = plan.firstDueDate;
  model.profile.negativeAmortizationAllowed = true;
  let anchor: Anchor = { date: plan.startDate, principalMinor: plan.amountMinor, accruedInterestMinor: 0, source: "expected-plan-only" };
  let interestMinor = 0;
  let unusualFinal = false;
  let insufficientInterest = false;
  for (let index = 0; index < plan.months; index++) {
    const date = addMonths(plan.firstDueDate, index, parseIsoDate(plan.firstDueDate).day);
    const preview = simulate({ model, anchor, events: [], to: date, options: { generateScheduledRepayments: false, applyAssumptions: false } });
    if (!preview.ok) return { calculated: false as const, rows: [], reason: preview.blocked.map((entry) => entry.message).join(" ") };
    const interest = sumMinor([...preview.events.map((entry) => entry.interestMinor), preview.closing.accruedInterestMinor]) - (anchor.accruedInterestMinor ?? 0);
    const debt = sumMinor([preview.closing.principalMinor, preview.closing.accruedInterestMinor]);
    const minimum = revolvingPayment({ paymentModel: "percent-of-balance", percentOfBalanceBps: plan.minimumPercentBps, minimumFloorMinor: plan.minimumFloorMinor }, { balanceMinor: debt, lastChargeMinor: interest, contractualPaymentMinor: null, minorDigits: 2, mode: "half-up" });
    const contractual = plan.arrangement === "fixed" ? plan.includesCosts ? Math.max(0, (plan.monthlyMinor ?? 0) - plan.monthlyFeeMinor) : sumMinor([plan.monthlyMinor ?? 0, interest]) : minimum.ok ? minimum.minor : 0;
    const final = index === plan.months - 1;
    const payment = final ? debt : Math.min(debt, contractual);
    if (plan.arrangement === "fixed" && final && Math.abs(debt - contractual) > plan.months) unusualFinal = true;
    if (!final && contractual < interest) insufficientInterest = true;
    if (debt === 0 && plan.monthlyFeeMinor === 0) break;
    const applied = simulate({ model, anchor, events: payment > 0 ? [{ kind: "repayment", date, amountMinor: payment, ref: { source: "assumption", id: `${plan.id}:${index}` } }] : [], to: date, options: { generateScheduledRepayments: false, applyAssumptions: false } });
    if (!applied.ok) return { calculated: false as const, rows: [], reason: applied.blocked.map((entry) => entry.message).join(" ") };
    const fee = sumMinor([plan.monthlyFeeMinor, index === 0 ? plan.upfrontFeeMinor : 0]);
    rows.push({ index: index + 1, date, amountMinor: sumMinor([payment, fee]), principalMinor: Math.max(0, payment - interest), interestMinor: interest, feeMinor: fee, final });
    interestMinor = sumMinor([interestMinor, interest]);
    anchor = { ...applied.closing, source: "expected-plan-only" };
  }
  return { calculated: true as const, unusualFinal, insufficientInterest, warning: unusualFinal ? "The entered amount, term, rate and monthly instalment do not agree. Review the final amount; it is more than a rounding adjustment." : insufficientInterest ? "The monthly amount does not cover accrued interest; the debt grows." : null, rows, principalMinor: plan.amountMinor, interestMinor, upfrontFeeMinor: plan.upfrontFeeMinor, monthlyFeesMinor: sumMinor(rows.map((entry) => entry.feeMinor)) - plan.upfrontFeeMinor, totalMinor: sumMinor(rows.map((entry) => entry.amountMinor)), reason: plan.arrangement === "minimum-deadline" ? "Daily simple Actual/365 minimum estimate; fees are separate and the final payment clears the remainder. Unpaid billed interest can capitalize in this illustration." : plan.includesCosts ? "Daily simple Actual/365 estimate (unpaid billed interest can capitalize); monthly amount includes interest and monthly fees. Upfront fee is shown separately on the first due date." : "Daily simple Actual/365 estimate (unpaid billed interest can capitalize); interest and fees are added to the principal instalment. Final payment clears the estimated remainder." };
}
export function planForTransaction(workspace: Workspace, transactionId: string) {
  return workspace.plans?.find((plan) => plan.transactionId === transactionId) ?? workspace.plans?.find((plan) => workspace.planLinks?.some((link) => link.transactionId === transactionId && link.planId === plan.id));
}
export function currentPlanLink(workspace: Workspace, row: ActivityRow): PlanLink | undefined {
  return workspace.planLinks?.find((link) => link.transactionId === row.id && link.fingerprint === row.fingerprint);
}
export function planHealth(plan: RepaymentPlan, workspace: Workspace, snapshot: ActivitySnapshot, today: string, available = true) {
  const source = snapshot.rows.find((row) => row.id === plan.transactionId);
  const reasons: string[] = [];
  if (!available) reasons.push("Actual activity is unavailable");
  if (!source || source.fingerprint !== plan.fingerprint) reasons.push("Original transaction changed or is unavailable");
  const links = workspace.planLinks?.filter((link) => link.planId === plan.id) ?? [];
  if (links.some((link) => !snapshot.rows.some((row) => row.id === link.transactionId && row.fingerprint === link.fingerprint))) reasons.push("A linked Actual posting changed or is unavailable");
  if (links.some((link) => link.role === "refund")) reasons.push("A refund is linked; confirm how the bank treats this plan");
  if (plan.status === "active" && available && ["fixed", "minimum-deadline"].includes(plan.arrangement)) {
    const dueDay = parseIsoDate(plan.firstDueDate).day;
    const schedule = planProjection(plan, workspace.cards.find((entry) => entry.id === plan.cardId)!);
    if (!schedule.calculated) reasons.push(`Plan terms need review: ${schedule.reason}`);
    const missing = schedule.rows.filter((entry) => entry.amountMinor > 0).map((entry) => ({ index: entry.index, date: addMonths(plan.firstDueDate, entry.index - 1, dueDay) })).filter((entry) => entry.date < today && entry.date >= snapshot.from && entry.date <= snapshot.to && !links.some((link) => link.role === "instalment-billed" && link.instalment === entry.index && snapshot.rows.some((row) => row.id === link.transactionId && row.fingerprint === link.fingerprint)));
    if (missing.length) reasons.push(`${missing.length} past expected instalments have no linked bank posting`);
  }
  return { status: reasons.length ? "Needs review" : plan.status === "completed" ? "Completed" : plan.status === "cancelled" ? "Cancelled" : "Active", reasons };
}
